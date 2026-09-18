import type { AsteraActorProjection } from './_account-projection';
import { FunctionHttpError } from './_account-projection';
import { adminiSignedRequest, type AdminiSignatureEnv } from './_admini-signature';
import { grantCredit, requestFingerprint, type RewardProgramEnv } from './_reward-programs';

export type BetaEnv = RewardProgramEnv & AdminiSignatureEnv;

export type BetaPolicyRow = {
  status: 'active' | 'paused';
  monthly_credit: number;
  minimum_commitment_days: number;
  policy_version: number;
  updated_at: string;
};

export type BetaParticipantRow = {
  user_id: string;
  tenant_id: string;
  state: 'commitment_active' | 'active' | 'permanently_exited' | 'blocked';
  joined_at: string;
  commitment_until: string;
  commitment_days_snapshot: number;
  policy_version_snapshot: number;
  telemetry_enabled: number;
  exited_at: string | null;
  exit_reason: string | null;
  updated_at: string;
};

type AdminiConfiguration = {
  policy: { status: string; monthlyCredit: number; minimumCommitmentDays: number; policyVersion: number } | null;
  features: Array<{ featureId: string; title: string; lifecycle: string; version: string; defaultEnabled: boolean; killSwitch: boolean }>;
};

function jstCalendar(date = new Date()): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { year: read('year'), month: read('month'), day: read('day') };
}

export function previousJstMonth(date = new Date()): string {
  const { year, month } = jstCalendar(date);
  const previousMonth = month === 1 ? 12 : month - 1;
  const previousYear = month === 1 ? year - 1 : year;
  return `${previousYear}-${String(previousMonth).padStart(2, '0')}`;
}

function jstMonthStartIso(targetMonth: string): string {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(targetMonth)) throw new FunctionHttpError(400, 'TARGET_MONTH_INVALID', '対象月が不正です。');
  return `${targetMonth}-01T00:00:00+09:00`;
}

function addDaysIso(iso: string, days: number): string {
  const date = new Date(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

export async function syncBetaConfiguration(env: BetaEnv): Promise<{ policy: BetaPolicyRow; serviceException: boolean }> {
  try {
    const config = await adminiSignedRequest<AdminiConfiguration>(env, '/internal/v1/rewards/beta/configuration', {});
    if (!config.policy) throw new Error('BETA_POLICY_MISSING');
    const status = config.policy.status === 'paused' ? 'paused' : 'active';
    const monthlyCredit = Number(config.policy.monthlyCredit);
    const commitmentDays = Number(config.policy.minimumCommitmentDays);
    const policyVersion = Number(config.policy.policyVersion);
    if (!Number.isSafeInteger(monthlyCredit) || monthlyCredit < 0 || !Number.isSafeInteger(commitmentDays) || commitmentDays <= 0 || !Number.isSafeInteger(policyVersion) || policyVersion <= 0) {
      throw new Error('BETA_POLICY_INVALID');
    }
    const now = new Date().toISOString();
    const statements = [env.ASTERA_DB.prepare(
      `INSERT INTO beta_policy_projection (id,status,monthly_credit,minimum_commitment_days,policy_version,updated_at)
       VALUES ('active',?1,?2,?3,?4,?5)
       ON CONFLICT(id) DO UPDATE SET status=excluded.status,monthly_credit=excluded.monthly_credit,
       minimum_commitment_days=excluded.minimum_commitment_days,policy_version=excluded.policy_version,updated_at=excluded.updated_at`,
    ).bind(status, monthlyCredit, commitmentDays, policyVersion, now)];
    for (const feature of config.features) {
      const lifecycle = feature.killSwitch ? 'paused' : feature.lifecycle;
      if (!['draft','active','paused','graduated','retired'].includes(lifecycle)) continue;
      statements.push(env.ASTERA_DB.prepare(
        `INSERT INTO beta_feature_projection (feature_id,title,lifecycle,version,default_enabled,updated_at)
         VALUES (?1,?2,?3,?4,?5,?6)
         ON CONFLICT(feature_id) DO UPDATE SET title=excluded.title,lifecycle=excluded.lifecycle,
         version=excluded.version,default_enabled=excluded.default_enabled,updated_at=excluded.updated_at`,
      ).bind(feature.featureId, feature.title, lifecycle, feature.version, feature.defaultEnabled ? 1 : 0, now));
    }
    const results = await env.ASTERA_DB.batch(statements);
    if (results.some((result) => result.success === false)) throw new Error('BETA_PROJECTION_SYNC_FAILED');
  } catch {
    const cached = await env.ASTERA_DB.prepare(
      `SELECT status,monthly_credit,minimum_commitment_days,policy_version,updated_at FROM beta_policy_projection WHERE id='active' LIMIT 1`,
    ).first<BetaPolicyRow>();
    if (!cached) throw new FunctionHttpError(503, 'BETA_CONFIGURATION_UNAVAILABLE', 'βテスト設定を取得できません。');
    return { policy: cached, serviceException: true };
  }
  const policy = await env.ASTERA_DB.prepare(
    `SELECT status,monthly_credit,minimum_commitment_days,policy_version,updated_at FROM beta_policy_projection WHERE id='active' LIMIT 1`,
  ).first<BetaPolicyRow>();
  if (!policy) throw new FunctionHttpError(503, 'BETA_POLICY_NOT_READY', 'βテスト設定が準備されていません。');
  return { policy, serviceException: false };
}

export async function betaParticipant(env: BetaEnv, userId: string): Promise<BetaParticipantRow | null> {
  return env.ASTERA_DB.prepare(
    `SELECT user_id,tenant_id,state,joined_at,commitment_until,commitment_days_snapshot,policy_version_snapshot,
            telemetry_enabled,exited_at,exit_reason,updated_at
     FROM beta_participants WHERE user_id=?1 LIMIT 1`,
  ).bind(userId).first<BetaParticipantRow>();
}

export function participantHasCompleteMonth(participant: BetaParticipantRow, targetMonth: string): boolean {
  return Date.parse(participant.joined_at) <= Date.parse(jstMonthStartIso(targetMonth));
}

export async function betaMonthUsageCount(env: BetaEnv, userId: string, targetMonth: string): Promise<number> {
  const row = await env.ASTERA_DB.prepare(
    `SELECT COUNT(*) AS count FROM beta_feature_usage_receipts WHERE user_id=?1 AND target_month=?2`,
  ).bind(userId, targetMonth).first<{ count: number }>();
  return Number(row?.count ?? 0);
}

export async function adminiSurveyStatus(env: BetaEnv, userId: string, targetMonth: string): Promise<{ submitted: boolean; serviceException: boolean }> {
  try {
    const result = await adminiSignedRequest<{ submitted: boolean }>(env, '/internal/v1/rewards/beta/survey-status', {
      user_id: userId,
      target_month: targetMonth,
    });
    return { submitted: result.submitted === true, serviceException: false };
  } catch {
    return { submitted: false, serviceException: true };
  }
}

export async function grantQualifiedBetaMonth(
  env: BetaEnv,
  actor: AsteraActorProjection,
  participant: BetaParticipantRow,
  policy: BetaPolicyRow,
  targetMonth: string,
  surveySubmitted: boolean,
  serviceException: boolean,
): Promise<{ qualified: boolean; granted: boolean; reason: string }> {
  if (!['active','commitment_active'].includes(participant.state)) return { qualified: false, granted: false, reason: 'not_participating' };
  if (!participant.telemetry_enabled) return { qualified: false, granted: false, reason: 'telemetry_disabled' };
  if (!participantHasCompleteMonth(participant, targetMonth)) return { qualified: false, granted: false, reason: 'incomplete_month' };
  const usageCount = await betaMonthUsageCount(env, actor.user.id, targetMonth);
  if (usageCount <= 0) return { qualified: false, granted: false, reason: 'no_beta_usage' };
  if (serviceException) return { qualified: false, granted: false, reason: 'service_exception' };
  if (!surveySubmitted) return { qualified: false, granted: false, reason: 'survey_pending' };
  const idempotencyKey = `beta_monthly_reward:${actor.user.id}:${targetMonth}`;
  const existing = await env.ASTERA_DB.prepare(
    `SELECT transaction_id FROM credit_ledger WHERE idempotency_key=?1 LIMIT 1`,
  ).bind(idempotencyKey).first<{ transaction_id: string }>();
  if (existing) return { qualified: true, granted: false, reason: 'already_granted' };
  const fingerprint = await requestFingerprint([actor.user.id, targetMonth, policy.monthly_credit, policy.policy_version]);
  await grantCredit(env.ASTERA_DB, actor, Number(policy.monthly_credit), {
    idempotencyKey,
    referenceType: 'beta_monthly_reward',
    referenceId: `${actor.user.id}:${targetMonth}`,
    fingerprint,
  });
  return { qualified: true, granted: true, reason: 'granted' };
}

export async function joinBeta(env: BetaEnv, actor: AsteraActorProjection): Promise<BetaParticipantRow> {
  const existing = await betaParticipant(env, actor.user.id);
  if (existing) {
    if (existing.state === 'permanently_exited' || existing.state === 'blocked') {
      throw new FunctionHttpError(409, 'BETA_REJOIN_NOT_ALLOWED', '一度終了したβテストには再参加できません。');
    }
    return existing;
  }
  const { policy } = await syncBetaConfiguration(env);
  if (policy.status !== 'active') throw new FunctionHttpError(409, 'BETA_PROGRAM_PAUSED', 'βテストは現在一時停止中です。');
  const joinedAt = new Date().toISOString();
  const commitmentUntil = addDaysIso(joinedAt, Number(policy.minimum_commitment_days));
  const state: BetaParticipantRow['state'] = 'commitment_active';
  const result = await env.ASTERA_DB.prepare(
    `INSERT INTO beta_participants
     (user_id,tenant_id,state,joined_at,commitment_until,commitment_days_snapshot,policy_version_snapshot,telemetry_enabled,updated_at)
     VALUES (?1,?2,?3,?4,?5,?6,?7,1,?4)`,
  ).bind(actor.user.id, actor.profile.tenant_id, state, joinedAt, commitmentUntil, policy.minimum_commitment_days, policy.policy_version).run();
  if (result.success === false) throw new FunctionHttpError(503, 'BETA_JOIN_FAILED', 'βテスト参加を完了できませんでした。');
  const created = await betaParticipant(env, actor.user.id);
  if (!created) throw new FunctionHttpError(503, 'BETA_JOIN_FAILED', 'βテスト参加状態を確認できませんでした。');
  return created;
}

export async function refreshParticipantCommitment(env: BetaEnv, participant: BetaParticipantRow): Promise<BetaParticipantRow> {
  if (participant.state === 'commitment_active' && Date.now() >= Date.parse(participant.commitment_until)) {
    await env.ASTERA_DB.prepare(
      `UPDATE beta_participants SET state='active', updated_at=?1 WHERE user_id=?2 AND state='commitment_active'`,
    ).bind(new Date().toISOString(), participant.user_id).run();
    return (await betaParticipant(env, participant.user_id)) ?? participant;
  }
  return participant;
}
