import {
  FunctionHttpError,
  functionErrorResponse,
  requestCorrelationId,
  requireAsteraActor,
} from '../../_account-projection';
import {
  adminiSurveyStatus,
  betaMonthUsageCount,
  betaParticipant,
  grantQualifiedBetaMonth,
  joinBeta,
  participantHasCompleteMonth,
  previousJstMonth,
  refreshParticipantCommitment,
  syncBetaConfiguration,
  type BetaEnv,
} from '../../_beta-program';

type PagesContext = { request: Request; env: BetaEnv };

type FeatureRow = {
  feature_id: string;
  title: string;
  lifecycle: string;
  version: string;
  default_enabled: number;
  preference_enabled: number | null;
};

async function getStatus(context: PagesContext): Promise<Response> {
  const actor = await requireAsteraActor(context.request, context.env);
  const config = await syncBetaConfiguration(context.env);
  let participant = await betaParticipant(context.env, actor.user.id);
  if (participant) participant = await refreshParticipantCommitment(context.env, participant);
  const features = await context.env.ASTERA_DB.prepare(
    `SELECT f.feature_id,f.title,f.lifecycle,f.version,f.default_enabled,p.enabled AS preference_enabled
     FROM beta_feature_projection f
     LEFT JOIN beta_feature_preferences p ON p.feature_id=f.feature_id AND p.user_id=?1
     WHERE f.lifecycle<>'retired'
     ORDER BY f.title`,
  ).bind(actor.user.id).all<FeatureRow>();

  const targetMonth = previousJstMonth();
  let survey = { submitted: false, serviceException: config.serviceException };
  let usageCount = 0;
  let reward = { qualified: false, granted: false, reason: 'not_participating' };
  let surveyRequired = false;
  if (participant && ['active','commitment_active'].includes(participant.state) && participant.telemetry_enabled) {
    const completeMonth = participantHasCompleteMonth(participant, targetMonth);
    if (completeMonth && !config.serviceException && config.policy.status === 'active') {
      survey = await adminiSurveyStatus(context.env, actor.user.id, targetMonth);
      usageCount = await betaMonthUsageCount(context.env, actor.user.id, targetMonth);
      surveyRequired = !survey.submitted && !survey.serviceException;
      reward = await grantQualifiedBetaMonth(context.env, actor, participant, config.policy, targetMonth, survey.submitted, survey.serviceException);
    }
  }

  return Response.json({
    beta: {
      policy: {
        status: config.policy.status,
        monthly_credit: Number(config.policy.monthly_credit),
        minimum_commitment_days: Number(config.policy.minimum_commitment_days),
        policy_version: Number(config.policy.policy_version),
      },
      participant,
      features: (features.results ?? []).map((feature) => ({
        feature_id: feature.feature_id,
        title: feature.title,
        lifecycle: feature.lifecycle,
        version: feature.version,
        enabled: feature.lifecycle === 'active' && (feature.preference_enabled === null ? feature.default_enabled === 1 : feature.preference_enabled === 1),
        configurable: feature.lifecycle === 'active',
      })),
      target_month: targetMonth,
      survey_required: surveyRequired,
      survey_submitted: survey.submitted,
      usage_count: usageCount,
      service_exception: config.serviceException || survey.serviceException,
      monthly_reward: reward,
    },
  }, { headers: { 'Cache-Control': 'no-store' } });
}

async function mutate(context: PagesContext): Promise<Response> {
  const actor = await requireAsteraActor(context.request, context.env);
  const body = await context.request.json().catch(() => null) as {
    action?: unknown;
    feature_id?: unknown;
    enabled?: unknown;
  } | null;
  const action = typeof body?.action === 'string' ? body.action : '';
  if (action === 'join') {
    const participant = await joinBeta(context.env, actor);
    return Response.json({ participant }, { headers: { 'Cache-Control': 'no-store' } });
  }
  const existing = await betaParticipant(context.env, actor.user.id);
  if (!existing) throw new FunctionHttpError(409, 'BETA_NOT_JOINED', 'βテストへ参加していません。');
  const participant = await refreshParticipantCommitment(context.env, existing);
  if (participant.state === 'permanently_exited' || participant.state === 'blocked') throw new FunctionHttpError(409, 'BETA_INACTIVE', 'βテスト参加は終了しています。');

  if (action === 'exit') {
    if (Date.now() < Date.parse(participant.commitment_until)) {
      throw new FunctionHttpError(409, 'BETA_COMMITMENT_ACTIVE', '最低参加期間中は通常解除できません。', { commitment_until: participant.commitment_until });
    }
    const now = new Date().toISOString();
    await context.env.ASTERA_DB.prepare(
      `UPDATE beta_participants
       SET state='permanently_exited',exited_at=?1,exit_reason='voluntary_exit',updated_at=?1
       WHERE user_id=?2`,
    ).bind(now, actor.user.id).run();
    return Response.json({ state: 'permanently_exited', rejoin_allowed: false }, { headers: { 'Cache-Control': 'no-store' } });
  }

  if (action === 'stop_telemetry') {
    const now = new Date().toISOString();
    await context.env.ASTERA_DB.prepare(
      `UPDATE beta_participants
       SET telemetry_enabled=0,state='permanently_exited',exited_at=?1,exit_reason='telemetry_stopped',updated_at=?1
       WHERE user_id=?2`,
    ).bind(now, actor.user.id).run();
    return Response.json({ state: 'permanently_exited', telemetry_enabled: false, rejoin_allowed: false }, { headers: { 'Cache-Control': 'no-store' } });
  }

  if (action === 'feature') {
    const featureId = typeof body?.feature_id === 'string' ? body.feature_id.trim() : '';
    if (!featureId || typeof body?.enabled !== 'boolean') throw new FunctionHttpError(400, 'BETA_FEATURE_INPUT_INVALID', 'β機能設定が不正です。');
    const feature = await context.env.ASTERA_DB.prepare(
      `SELECT lifecycle FROM beta_feature_projection WHERE feature_id=?1 LIMIT 1`,
    ).bind(featureId).first<{ lifecycle: string }>();
    if (!feature || feature.lifecycle !== 'active') throw new FunctionHttpError(409, 'BETA_FEATURE_NOT_ACTIVE', 'このβ機能は現在変更できません。');
    const now = new Date().toISOString();
    await context.env.ASTERA_DB.prepare(
      `INSERT INTO beta_feature_preferences (user_id,feature_id,enabled,updated_at)
       VALUES (?1,?2,?3,?4)
       ON CONFLICT(user_id,feature_id) DO UPDATE SET enabled=excluded.enabled,updated_at=excluded.updated_at`,
    ).bind(actor.user.id, featureId, body.enabled ? 1 : 0, now).run();
    return Response.json({ feature_id: featureId, enabled: body.enabled }, { headers: { 'Cache-Control': 'no-store' } });
  }

  throw new FunctionHttpError(400, 'BETA_ACTION_INVALID', 'βテスト操作が不正です。');
}

export async function onRequest(context: PagesContext): Promise<Response> {
  const requestId = requestCorrelationId(context.request);
  try {
    if (context.request.method === 'GET') return await getStatus(context);
    if (context.request.method === 'POST') return await mutate(context);
    return Response.json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'GETまたはPOSTを使用してください。', correlation_id: requestId } }, { status: 405 });
  } catch (error) {
    return functionErrorResponse(error, requestId);
  }
}
