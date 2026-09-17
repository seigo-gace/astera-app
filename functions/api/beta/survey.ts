import {
  FunctionHttpError,
  functionErrorResponse,
  requestCorrelationId,
  requireAsteraActor,
} from '../../_account-projection';
import { adminiSignedRequest } from '../../_admini-signature';
import {
  betaParticipant,
  grantQualifiedBetaMonth,
  participantHasCompleteMonth,
  previousJstMonth,
  refreshParticipantCommitment,
  syncBetaConfiguration,
  type BetaEnv,
} from '../../_beta-program';

type PagesContext = { request: Request; env: BetaEnv };

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function requiredText(value: unknown, code: string, max: number): string {
  if (typeof value !== 'string' || !value.trim()) throw new FunctionHttpError(400, code, '必須項目を入力してください。');
  const normalized = value.trim();
  if (normalized.length > max) throw new FunctionHttpError(400, `${code}_TOO_LONG`, '入力内容が長すぎます。');
  return normalized;
}

function technicalContext(request: Request): Record<string, unknown> {
  const userAgent = request.headers.get('User-Agent')?.slice(0, 500) ?? null;
  const country = request.headers.get('CF-IPCountry')?.slice(0, 8) ?? null;
  return { user_agent: userAgent, country, submitted_via: 'astera_app' };
}

export async function onRequest(context: PagesContext): Promise<Response> {
  const requestId = requestCorrelationId(context.request);
  try {
    if (context.request.method !== 'POST') {
      return Response.json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'POSTを使用してください。', correlation_id: requestId } }, { status: 405 });
    }
    const actor = await requireAsteraActor(context.request, context.env);
    const existing = await betaParticipant(context.env, actor.user.id);
    if (!existing) throw new FunctionHttpError(409, 'BETA_NOT_JOINED', 'βテストへ参加していません。');
    const participant = await refreshParticipantCommitment(context.env, existing);
    if (!['active','commitment_active'].includes(participant.state) || !participant.telemetry_enabled) {
      throw new FunctionHttpError(409, 'BETA_INACTIVE', 'βテスト参加条件を満たしていません。');
    }
    const targetMonth = previousJstMonth();
    if (!participantHasCompleteMonth(participant, targetMonth)) throw new FunctionHttpError(409, 'BETA_MONTH_NOT_ELIGIBLE', 'この月はまだアンケート対象ではありません。');

    const body = await context.request.json().catch(() => null) as {
      target_month?: unknown;
      answers?: unknown;
      improvement_text?: unknown;
      feedback_text?: unknown;
    } | null;
    if (body?.target_month !== targetMonth) throw new FunctionHttpError(400, 'TARGET_MONTH_MISMATCH', '対象月を確認してください。');
    const answers = record(body.answers);
    const improvementText = requiredText(body.improvement_text, 'IMPROVEMENT_REQUIRED', 4000);
    const feedbackText = requiredText(body.feedback_text, 'FEEDBACK_REQUIRED', 8000);
    const submissionId = crypto.randomUUID();
    const submittedAt = new Date().toISOString();

    const accepted = await adminiSignedRequest<{ submissionId?: string; submission_id?: string; targetMonth?: string; acceptedAt?: string }>(
      context.env,
      '/internal/v1/rewards/beta/survey',
      {
        submission_id: submissionId,
        user_id: actor.user.id,
        tenant_id: actor.profile.tenant_id,
        target_month: targetMonth,
        answers,
        improvement_text: improvementText,
        feedback_text: feedbackText,
        technical_context: technicalContext(context.request),
        submitted_at: submittedAt,
      },
    );
    if (!(accepted.submissionId || accepted.submission_id)) throw new FunctionHttpError(503, 'BETA_SURVEY_RECEIPT_MISSING', 'アンケート受領を確認できませんでした。');

    const { policy, serviceException } = await syncBetaConfiguration(context.env);
    const reward = await grantQualifiedBetaMonth(context.env, actor, participant, policy, targetMonth, true, serviceException);
    return Response.json({
      submitted: true,
      target_month: targetMonth,
      accepted_at: accepted.acceptedAt ?? submittedAt,
      monthly_reward: reward,
    }, { headers: { 'Cache-Control': 'no-store', 'X-Correlation-ID': requestId } });
  } catch (error) {
    return functionErrorResponse(error, requestId);
  }
}
