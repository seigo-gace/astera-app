import {
  FunctionHttpError,
  type AsteraActorProjection,
  type CreditRow,
  type SessionUser,
  type UserProfileRow,
} from './_account-projection';
import { adminiSignedRequest, type AdminiSignatureEnv } from './_admini-signature';
import {
  grantCredit,
  loadReferralPolicy,
  parseReferralMilestones,
  requestFingerprint,
  sha256Hex,
  type RewardProgramEnv,
} from './_reward-programs';

export type ReferralEnv = RewardProgramEnv & AdminiSignatureEnv;

type ReferralRow = {
  id: string;
  referrer_user_id: string;
  referred_user_id: string;
  state: 'pending' | 'qualified' | 'rewarded' | 'rejected' | 'fraud_hold';
  risk_level: 'low' | 'medium' | 'high';
  created_at: string;
};

type RiskObservation = {
  network_hash: string | null;
  device_hash: string | null;
  observed_at: string;
  expires_at: string;
};

async function keyedHash(env: ReferralEnv, purpose: string, value: string | null): Promise<string | null> {
  if (!value) return null;
  const secret = env.BETTER_AUTH_SECRET?.trim();
  if (!secret) return null;
  return sha256Hex(`${purpose}:${secret}:${value}`);
}

export async function observeReferralActor(env: ReferralEnv, request: Request, userId: string): Promise<void> {
  const involved = await env.ASTERA_DB.prepare(
    `SELECT 1 AS found FROM referral_codes WHERE user_id=?1
     UNION ALL SELECT 1 FROM referrals WHERE referrer_user_id=?1 OR referred_user_id=?1 LIMIT 1`,
  ).bind(userId).first<{ found: number }>();
  if (!involved) return;
  const ip = request.headers.get('CF-Connecting-IP')?.trim() || null;
  const device = [
    request.headers.get('User-Agent')?.trim() ?? '',
    request.headers.get('Sec-CH-UA-Platform')?.trim() ?? '',
    request.headers.get('Sec-CH-UA-Mobile')?.trim() ?? '',
  ].join('|');
  const networkHash = await keyedHash(env, 'referral-network-v1', ip);
  const deviceHash = await keyedHash(env, 'referral-device-v1', device || null);
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  await env.ASTERA_DB.prepare(
    `INSERT INTO referral_risk_observations (user_id,network_hash,device_hash,observed_at,expires_at)
     VALUES (?1,?2,?3,?4,?5)
     ON CONFLICT(user_id) DO UPDATE SET network_hash=excluded.network_hash,device_hash=excluded.device_hash,
       observed_at=excluded.observed_at,expires_at=excluded.expires_at`,
  ).bind(userId, networkHash, deviceHash, now, expiresAt).run();
  await env.ASTERA_DB.prepare(`DELETE FROM referral_risk_observations WHERE expires_at<=?1`).bind(now).run();
}

async function actorForUser(env: ReferralEnv, userId: string): Promise<AsteraActorProjection> {
  const profile = await env.ASTERA_DB.prepare(
    `SELECT user_id,tenant_id,nickname,account_status,ui_language,created_at,updated_at FROM user_profiles WHERE user_id=?1 LIMIT 1`,
  ).bind(userId).first<UserProfileRow>();
  if (!profile || profile.account_status !== 'active') throw new FunctionHttpError(409, 'REFERRAL_ACCOUNT_NOT_ACTIVE', '紹介対象Accountが有効ではありません。');
  const credit = await env.ASTERA_DB.prepare(
    `SELECT id,tenant_id,available_balance,reserved_balance,version,updated_at FROM credit_accounts WHERE tenant_id=?1 LIMIT 1`,
  ).bind(profile.tenant_id).first<CreditRow>();
  if (!credit) throw new FunctionHttpError(503, 'REFERRAL_CREDIT_ACCOUNT_MISSING', '紹介RewardのCredit Accountを確認できません。');
  const authUser = await env.ASTERA_DB.prepare(`SELECT id,email FROM "user" WHERE id=?1 LIMIT 1`).bind(userId).first<{ id: string; email: string }>();
  const user: SessionUser = { id: userId, email: authUser?.email ?? '' };
  return { user, session: undefined, profile, credit };
}

async function observation(env: ReferralEnv, userId: string): Promise<RiskObservation | null> {
  return env.ASTERA_DB.prepare(
    `SELECT network_hash,device_hash,observed_at,expires_at FROM referral_risk_observations
     WHERE user_id=?1 AND expires_at>?2 LIMIT 1`,
  ).bind(userId, new Date().toISOString()).first<RiskObservation>();
}

async function completedJobs(env: ReferralEnv, userId: string): Promise<number> {
  const row = await env.ASTERA_DB.prepare(
    `SELECT COUNT(*) AS count FROM app_jobs WHERE user_id=?1 AND state IN ('completed','partially_completed')`,
  ).bind(userId).first<{ count: number }>();
  return Number(row?.count ?? 0);
}

async function qualifyReferral(env: ReferralEnv, referral: ReferralRow): Promise<'pending' | 'qualified' | 'fraud_hold' | 'rejected' | 'rewarded'> {
  const policy = await loadReferralPolicy(env.ASTERA_DB);
  if (policy.status !== 'active') return 'pending';
  const referredProfile = await env.ASTERA_DB.prepare(
    `SELECT created_at,account_status FROM user_profiles WHERE user_id=?1 LIMIT 1`,
  ).bind(referral.referred_user_id).first<{ created_at: string; account_status: string }>();
  if (!referredProfile || referredProfile.account_status !== 'active') return 'pending';
  const accountAgeHours = (Date.now() - Date.parse(referredProfile.created_at)) / 3_600_000;
  if (!Number.isFinite(accountAgeHours) || accountAgeHours < Number(policy.minimum_account_age_hours)) return 'pending';
  if (await completedJobs(env, referral.referred_user_id) < Number(policy.minimum_completed_jobs)) return 'pending';

  const [referrerObservation, referredObservation] = await Promise.all([
    observation(env, referral.referrer_user_id),
    observation(env, referral.referred_user_id),
  ]);
  const timingMinutes = Math.abs(Date.parse(referral.created_at) - Date.parse(referredProfile.created_at)) / 60_000;
  const signals = [
    { name: 'network', matched: Boolean(referrerObservation?.network_hash && referrerObservation.network_hash === referredObservation?.network_hash), confidence: 'medium' },
    { name: 'device', matched: Boolean(referrerObservation?.device_hash && referrerObservation.device_hash === referredObservation?.device_hash), confidence: 'medium' },
    { name: 'timing', matched: Number.isFinite(timingMinutes) && timingMinutes <= 30, confidence: 'medium' },
    { name: 'usage', matched: false, confidence: 'low' },
  ] as const;

  let risk: { decision: 'allow' | 'observe' | 'hold' | 'reject'; riskLevel: 'low' | 'medium' | 'high' };
  try {
    risk = await adminiSignedRequest(env, '/internal/v1/rewards/referral/risk', {
      referral_id: referral.id,
      referrer_user_id: referral.referrer_user_id,
      referred_user_id: referral.referred_user_id,
      signals,
      now: new Date().toISOString(),
    });
  } catch {
    return 'pending';
  }
  if (risk.decision === 'observe') {
    await env.ASTERA_DB.prepare(`UPDATE referrals SET risk_level='medium',updated_at=?1 WHERE id=?2 AND state='pending'`).bind(new Date().toISOString(), referral.id).run();
    return 'pending';
  }
  if (risk.decision === 'hold') {
    await env.ASTERA_DB.prepare(`UPDATE referrals SET state='fraud_hold',risk_level='high',updated_at=?1 WHERE id=?2`).bind(new Date().toISOString(), referral.id).run();
    return 'fraud_hold';
  }
  if (risk.decision === 'reject') {
    await env.ASTERA_DB.prepare(`UPDATE referrals SET state='rejected',risk_level='high',qualification_reason='risk_rejected',updated_at=?1 WHERE id=?2`).bind(new Date().toISOString(), referral.id).run();
    return 'rejected';
  }

  const now = new Date().toISOString();
  await env.ASTERA_DB.prepare(
    `UPDATE referrals SET state='qualified',risk_level='low',qualification_reason='age_usage_risk_pass',qualified_at=?1,updated_at=?1 WHERE id=?2 AND state='pending'`,
  ).bind(now, referral.id).run();

  const referredActor = await actorForUser(env, referral.referred_user_id);
  const referredFingerprint = await requestFingerprint([referral.id, referral.referred_user_id, policy.referred_reward_credit, policy.policy_version]);
  await grantCredit(env.ASTERA_DB, referredActor, Number(policy.referred_reward_credit), {
    idempotencyKey: `referral_referred:${referral.id}`,
    referenceType: 'referral_reward',
    referenceId: `${referral.id}:referred`,
    fingerprint: referredFingerprint,
  });

  const countRow = await env.ASTERA_DB.prepare(
    `SELECT COUNT(*) AS count FROM referrals WHERE referrer_user_id=?1 AND state IN ('qualified','rewarded')`,
  ).bind(referral.referrer_user_id).first<{ count: number }>();
  const count = Number(countRow?.count ?? 0);
  const milestones = parseReferralMilestones(policy.milestones_json);
  let previousCumulative = 0;
  const referrerActor = await actorForUser(env, referral.referrer_user_id);
  for (const milestone of milestones) {
    if (count < milestone.threshold) break;
    const existing = await env.ASTERA_DB.prepare(
      `SELECT state FROM referral_milestone_grants WHERE referrer_user_id=?1 AND threshold=?2 LIMIT 1`,
    ).bind(referral.referrer_user_id, milestone.threshold).first<{ state: string }>();
    const delta = milestone.cumulative_credit - previousCumulative;
    previousCumulative = milestone.cumulative_credit;
    if (existing?.state === 'applied' || delta <= 0) continue;
    const grantId = existing ? `referral-milestone:${referral.referrer_user_id}:${milestone.threshold}` : crypto.randomUUID();
    await env.ASTERA_DB.prepare(
      `INSERT INTO referral_milestone_grants
       (id,referrer_user_id,threshold,cumulative_credit,delta_credit,state,created_at,updated_at)
       VALUES (?1,?2,?3,?4,?5,'pending',?6,?6)
       ON CONFLICT(referrer_user_id,threshold) DO UPDATE SET updated_at=excluded.updated_at`,
    ).bind(grantId, referral.referrer_user_id, milestone.threshold, milestone.cumulative_credit, delta, now).run();
    try {
      const fingerprint = await requestFingerprint([referral.referrer_user_id, milestone.threshold, milestone.cumulative_credit, delta, policy.policy_version]);
      const transactionId = await grantCredit(env.ASTERA_DB, referrerActor, delta, {
        idempotencyKey: `referral_milestone:${referral.referrer_user_id}:${milestone.threshold}`,
        referenceType: 'referral_reward',
        referenceId: `milestone:${referral.referrer_user_id}:${milestone.threshold}`,
        fingerprint,
      });
      await env.ASTERA_DB.prepare(
        `UPDATE referral_milestone_grants SET state='applied',ledger_transaction_id=?1,updated_at=?2 WHERE referrer_user_id=?3 AND threshold=?4`,
      ).bind(transactionId, new Date().toISOString(), referral.referrer_user_id, milestone.threshold).run();
    } catch {
      await env.ASTERA_DB.prepare(
        `UPDATE referral_milestone_grants SET state='reconcile_required',updated_at=?1 WHERE referrer_user_id=?2 AND threshold=?3`,
      ).bind(new Date().toISOString(), referral.referrer_user_id, milestone.threshold).run();
      throw new FunctionHttpError(503, 'REFERRAL_MILESTONE_RECONCILE_REQUIRED', '紹介Rewardの状態確認が必要です。');
    }
  }

  await env.ASTERA_DB.prepare(
    `UPDATE referrals SET state='rewarded',rewarded_at=?1,updated_at=?1 WHERE id=?2 AND state='qualified'`,
  ).bind(new Date().toISOString(), referral.id).run();
  return 'rewarded';
}

export async function evaluateRelatedReferrals(env: ReferralEnv, request: Request, actor: AsteraActorProjection): Promise<void> {
  await observeReferralActor(env, request, actor.user.id);
  const rows = await env.ASTERA_DB.prepare(
    `SELECT id,referrer_user_id,referred_user_id,state,risk_level,created_at
     FROM referrals
     WHERE (referrer_user_id=?1 OR referred_user_id=?1) AND state='pending'
     ORDER BY created_at ASC LIMIT 20`,
  ).bind(actor.user.id).all<ReferralRow>();
  for (const referral of rows.results ?? []) await qualifyReferral(env, referral);
}
