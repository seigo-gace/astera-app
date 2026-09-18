import {
  FunctionHttpError,
  type AsteraActorProjection,
  type AsteraFunctionEnv,
  type D1Database,
} from './_account-projection';

export type RewardProgramEnv = AsteraFunctionEnv & {
  ADMINI_API_ORIGIN?: string;
  ADMINI_INTERNAL_TOKEN?: string;
};

export type CreditGrantItem = {
  type: 'credit_grant';
  amount: number;
  label?: string;
};

export type CreditScheduleItem = {
  type: 'credit_schedule';
  amount: number;
  grants: number;
  cadence_months?: number;
  label?: string;
};

export type EntitlementItem = {
  type: 'access_tier' | 'feature' | 'seat_limit' | 'benefit';
  key: string;
  value: unknown;
  duration_days?: number;
  label?: string;
};

export type RewardItem = CreditGrantItem | CreditScheduleItem | EntitlementItem;

export type CouponProjection = {
  code_digest: string;
  masked_hint: string;
  code_status: string;
  code_redemption_limit: number;
  code_redeemed_count: number;
  bound_user_id: string | null;
  campaign_id: string;
  campaign_status: string;
  distribution_mode: 'UNIQUE' | 'SHARED' | 'ACCOUNT_BOUND';
  starts_at: string | null;
  expires_at: string | null;
  total_limit: number | null;
  per_account_limit: number;
  campaign_redeemed_count: number;
  reward_package_id: string;
  reward_version: number;
  reward_status: string;
  items_json: string;
};

export type ReferralPolicyRow = {
  status: 'active' | 'paused';
  referred_reward_credit: number;
  milestones_json: string;
  minimum_account_age_hours: number;
  minimum_completed_jobs: number;
  policy_version: number;
};

export type ReferralMilestone = {
  threshold: 1 | 3 | 5 | 10;
  cumulative_credit: number;
};

const DEFAULT_REFERRAL_MILESTONES: readonly ReferralMilestone[] = [
  { threshold: 1, cumulative_credit: 10_000 },
  { threshold: 3, cumulative_credit: 30_000 },
  { threshold: 5, cumulative_credit: 60_000 },
  { threshold: 10, cumulative_credit: 150_000 },
] as const;

function requiredSecret(env: RewardProgramEnv): string {
  const value = env.BETTER_AUTH_SECRET?.trim();
  if (!value || value.length < 32) {
    throw new FunctionHttpError(503, 'COUPON_DIGEST_SECRET_UNAVAILABLE', 'Coupon検証用Secretを利用できません。');
  }
  return value;
}

export function normalizeRewardCode(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.normalize('NFKC').trim().toUpperCase().replace(/[\s-]+/g, '');
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return toHex(new Uint8Array(digest));
}

async function hmacHex(keyBytes: ArrayBuffer, value: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return toHex(new Uint8Array(signature));
}

async function codeDigestKey(env: RewardProgramEnv): Promise<ArrayBuffer> {
  const secret = requiredSecret(env);
  return crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`astera:reward-code:v1:${secret}`),
  );
}

export async function rewardCodeDigest(env: RewardProgramEnv, rawCode: unknown): Promise<string> {
  const normalized = normalizeRewardCode(rawCode);
  if (normalized.length < 6 || normalized.length > 64 || !/^[A-Z0-9]+$/.test(normalized)) {
    throw new FunctionHttpError(400, 'INVALID', 'コードを確認してください。');
  }
  return hmacHex(await codeDigestKey(env), normalized);
}

export function maskedRewardCode(rawCode: string): string {
  const normalized = normalizeRewardCode(rawCode);
  if (normalized.length <= 4) return '••••';
  return `${normalized.slice(0, 2)}••••${normalized.slice(-2)}`;
}

export function parseRewardItems(raw: string): RewardItem[] {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new FunctionHttpError(500, 'REWARD_PACKAGE_INVALID', 'Reward定義を読み込めませんでした。');
  }
  if (!Array.isArray(value) || value.length === 0) {
    throw new FunctionHttpError(500, 'REWARD_PACKAGE_EMPTY', 'Reward定義が空です。');
  }
  const items: RewardItem[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new FunctionHttpError(500, 'REWARD_ITEM_INVALID', 'Reward定義が不正です。');
    }
    const item = candidate as Record<string, unknown>;
    const type = item.type;
    if (type === 'credit_grant') {
      const amount = Number(item.amount);
      if (!Number.isSafeInteger(amount) || amount <= 0) throw new FunctionHttpError(500, 'REWARD_CREDIT_INVALID', 'Credit Reward定義が不正です。');
      items.push({ type, amount, label: typeof item.label === 'string' ? item.label : undefined });
      continue;
    }
    if (type === 'credit_schedule') {
      const amount = Number(item.amount);
      const grants = Number(item.grants);
      const cadenceMonths = item.cadence_months === undefined ? 1 : Number(item.cadence_months);
      if (!Number.isSafeInteger(amount) || amount <= 0 || !Number.isSafeInteger(grants) || grants <= 0 || !Number.isSafeInteger(cadenceMonths) || cadenceMonths <= 0) {
        throw new FunctionHttpError(500, 'REWARD_SCHEDULE_INVALID', '月次Credit Reward定義が不正です。');
      }
      items.push({ type, amount, grants, cadence_months: cadenceMonths, label: typeof item.label === 'string' ? item.label : undefined });
      continue;
    }
    if (type === 'access_tier' || type === 'feature' || type === 'seat_limit' || type === 'benefit') {
      const key = typeof item.key === 'string' ? item.key.trim() : '';
      const durationDays = item.duration_days === undefined ? undefined : Number(item.duration_days);
      if (!key || (durationDays !== undefined && (!Number.isSafeInteger(durationDays) || durationDays <= 0))) {
        throw new FunctionHttpError(500, 'REWARD_ENTITLEMENT_INVALID', '利用権Reward定義が不正です。');
      }
      items.push({ type, key, value: item.value ?? true, duration_days: durationDays, label: typeof item.label === 'string' ? item.label : undefined });
      continue;
    }
    throw new FunctionHttpError(500, 'REWARD_ITEM_TYPE_UNSUPPORTED', '未対応のReward定義です。');
  }
  return items;
}

export function rewardSummary(items: RewardItem[]): Array<Record<string, unknown>> {
  return items.map((item) => {
    if (item.type === 'credit_grant') return { type: item.type, amount: item.amount, label: item.label ?? `${item.amount.toLocaleString()} Credit` };
    if (item.type === 'credit_schedule') return { type: item.type, amount: item.amount, grants: item.grants, cadence_months: item.cadence_months ?? 1, label: item.label ?? `${item.amount.toLocaleString()} Credit × ${item.grants}回` };
    return { type: item.type, key: item.key, value: item.value, duration_days: item.duration_days ?? null, label: item.label ?? item.key };
  });
}

export async function loadCouponProjection(db: D1Database, digest: string): Promise<CouponProjection | null> {
  return db.prepare(
    `SELECT
       code.code_digest,
       code.masked_hint,
       code.status AS code_status,
       code.redemption_limit AS code_redemption_limit,
       code.redeemed_count AS code_redeemed_count,
       code.bound_user_id,
       campaign.id AS campaign_id,
       campaign.status AS campaign_status,
       campaign.distribution_mode,
       campaign.starts_at,
       campaign.expires_at,
       campaign.total_limit,
       campaign.per_account_limit,
       campaign.redeemed_count AS campaign_redeemed_count,
       reward.id AS reward_package_id,
       reward.version AS reward_version,
       reward.status AS reward_status,
       reward.items_json
     FROM coupon_code_projection code
     JOIN coupon_campaign_projection campaign ON campaign.id = code.campaign_id
     JOIN reward_package_projection reward ON reward.id = campaign.reward_package_id
     WHERE code.code_digest = ?1
     LIMIT 1`,
  ).bind(digest).first<CouponProjection>();
}

function nowMs(value: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function validateCouponForActor(
  db: D1Database,
  actor: AsteraActorProjection,
  coupon: CouponProjection | null,
): Promise<CouponProjection> {
  if (!coupon) throw new FunctionHttpError(404, 'INVALID', 'コードを確認してください。');
  const now = Date.now();
  if (coupon.code_status === 'expired' || coupon.campaign_status === 'expired') throw new FunctionHttpError(409, 'EXPIRED', '利用期限が終了しています。');
  if (coupon.code_status !== 'active' || coupon.campaign_status !== 'active' || coupon.reward_status !== 'active') throw new FunctionHttpError(409, 'NOT_ELIGIBLE', 'このコードは現在利用できません。');
  const startsAt = nowMs(coupon.starts_at);
  const expiresAt = nowMs(coupon.expires_at);
  if (startsAt !== null && now < startsAt) throw new FunctionHttpError(409, 'NOT_ELIGIBLE', 'このコードはまだ利用できません。');
  if (expiresAt !== null && now >= expiresAt) throw new FunctionHttpError(409, 'EXPIRED', '利用期限が終了しています。');
  if (coupon.bound_user_id && coupon.bound_user_id !== actor.user.id) throw new FunctionHttpError(403, 'NOT_ELIGIBLE', 'このアカウントでは利用できません。');
  if (coupon.total_limit !== null && coupon.campaign_redeemed_count >= coupon.total_limit) throw new FunctionHttpError(409, 'LIMIT_REACHED', '利用上限に達しています。');
  if (coupon.code_redeemed_count >= coupon.code_redemption_limit) throw new FunctionHttpError(409, 'USED', 'すでに使用されています。');

  const userCount = await db.prepare(
    `SELECT COUNT(*) AS count FROM coupon_redemptions
     WHERE campaign_id=?1 AND user_id=?2 AND state IN ('reserved','applying','applied','reconcile_required')`,
  ).bind(coupon.campaign_id, actor.user.id).first<{ count: number }>();
  if (Number(userCount?.count ?? 0) >= coupon.per_account_limit) throw new FunctionHttpError(409, 'USED', 'すでに使用されています。');
  return coupon;
}

export async function requestFingerprint(parts: unknown[]): Promise<string> {
  return sha256Hex(JSON.stringify(parts));
}

async function existingLedgerTransaction(db: D1Database, idempotencyKey: string): Promise<string | null> {
  const row = await db.prepare(
    `SELECT transaction_id FROM credit_ledger WHERE idempotency_key=?1 LIMIT 1`,
  ).bind(idempotencyKey).first<{ transaction_id: string }>();
  return row?.transaction_id ?? null;
}

export async function grantCredit(
  db: D1Database,
  actor: AsteraActorProjection,
  amount: number,
  input: { idempotencyKey: string; referenceType: string; referenceId: string; fingerprint: string },
): Promise<string> {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new FunctionHttpError(500, 'CREDIT_GRANT_INVALID', 'Credit付与量が不正です。');
  const existing = await existingLedgerTransaction(db, input.idempotencyKey);
  if (existing) return existing;
  const transactionId = crypto.randomUUID();
  const now = new Date().toISOString();
  const results = await db.batch([
    db.prepare(
      `UPDATE credit_accounts
       SET available_balance=available_balance+?1, version=version+1, updated_at=?2
       WHERE id=?3
         AND NOT EXISTS (SELECT 1 FROM credit_ledger WHERE idempotency_key=?4)`,
    ).bind(amount, now, actor.credit.id, input.idempotencyKey),
    db.prepare(
      `INSERT OR IGNORE INTO credit_ledger
       (transaction_id, credit_account_id, kind, amount, idempotency_key, reference_type, reference_id, request_fingerprint, created_at)
       VALUES (?1, ?2, 'grant', ?3, ?4, ?5, ?6, ?7, ?8)`,
    ).bind(transactionId, actor.credit.id, amount, input.idempotencyKey, input.referenceType, input.referenceId, input.fingerprint, now),
  ]);
  if (results.some((result) => result.success === false)) throw new FunctionHttpError(503, 'CREDIT_GRANT_FAILED', 'Credit付与を完了できませんでした。');
  return (await existingLedgerTransaction(db, input.idempotencyKey)) ?? transactionId;
}

function addDays(iso: string, days: number): string {
  const date = new Date(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function addMonths(iso: string, months: number): string {
  const date = new Date(iso);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString();
}

export async function applyRewardItems(
  db: D1Database,
  actor: AsteraActorProjection,
  items: RewardItem[],
  input: { referenceType: string; referenceId: string; fingerprint: string },
): Promise<{ creditTransactions: string[]; entitlementIds: string[]; scheduleIds: string[] }> {
  const creditTransactions: string[] = [];
  const entitlementIds: string[] = [];
  const scheduleIds: string[] = [];
  const now = new Date().toISOString();

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item.type === 'credit_grant') {
      creditTransactions.push(await grantCredit(db, actor, item.amount, {
        idempotencyKey: `${input.referenceType}:${input.referenceId}:credit:${index}`,
        referenceType: input.referenceType,
        referenceId: `${input.referenceId}:credit:${index}`,
        fingerprint: input.fingerprint,
      }));
      continue;
    }
    if (item.type === 'credit_schedule') {
      const scheduleId = `${input.referenceType}:${input.referenceId}:schedule:${index}`;
      const firstGrantKey = `${scheduleId}:grant:1`;
      creditTransactions.push(await grantCredit(db, actor, item.amount, {
        idempotencyKey: firstGrantKey,
        referenceType: input.referenceType,
        referenceId: `${input.referenceId}:schedule:${index}:grant:1`,
        fingerprint: input.fingerprint,
      }));
      const remaining = Math.max(0, item.grants - 1);
      const status = remaining === 0 ? 'completed' : 'active';
      const nextGrantAt = remaining === 0 ? null : addMonths(now, item.cadence_months ?? 1);
      await db.prepare(
        `INSERT INTO reward_credit_schedules
         (id, tenant_id, user_id, amount, remaining_grants, cadence_months, next_grant_at, status, reference_type, reference_id, created_at, updated_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?11)
         ON CONFLICT(reference_type, reference_id) DO NOTHING`,
      ).bind(scheduleId, actor.profile.tenant_id, actor.user.id, item.amount, remaining, item.cadence_months ?? 1, nextGrantAt, status, input.referenceType, `${input.referenceId}:schedule:${index}`, now).run();
      scheduleIds.push(scheduleId);
      continue;
    }

    const entitlementId = `${input.referenceType}:${input.referenceId}:entitlement:${index}`;
    const expiresAt = item.duration_days ? addDays(now, item.duration_days) : null;
    await db.prepare(
      `INSERT INTO reward_entitlements
       (id, tenant_id, user_id, entitlement_type, entitlement_key, value_json, starts_at, expires_at, status, reference_type, reference_id, created_at, updated_at)
       VALUES (?1,?2,?3,?4,?5,?6,?7,?8,'active',?9,?10,?11,?11)
       ON CONFLICT(reference_type, reference_id, entitlement_type, entitlement_key)
       DO UPDATE SET value_json=excluded.value_json, expires_at=excluded.expires_at, updated_at=excluded.updated_at`,
    ).bind(entitlementId, actor.profile.tenant_id, actor.user.id, item.type, item.key, JSON.stringify(item.value), now, expiresAt, input.referenceType, input.referenceId, now).run();
    entitlementIds.push(entitlementId);
  }

  return { creditTransactions, entitlementIds, scheduleIds };
}

export function parseReferralMilestones(raw: string | null | undefined): ReferralMilestone[] {
  if (!raw) return [...DEFAULT_REFERRAL_MILESTONES];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [...DEFAULT_REFERRAL_MILESTONES];
    const result = parsed.map((value) => {
      const row = value as Record<string, unknown>;
      return { threshold: Number(row.threshold), cumulative_credit: Number(row.cumulative_credit) };
    }).filter((row): row is ReferralMilestone => [1, 3, 5, 10].includes(row.threshold) && Number.isSafeInteger(row.cumulative_credit) && row.cumulative_credit >= 0)
      .sort((a, b) => a.threshold - b.threshold);
    return result.length === 4 ? result : [...DEFAULT_REFERRAL_MILESTONES];
  } catch {
    return [...DEFAULT_REFERRAL_MILESTONES];
  }
}

export async function loadReferralPolicy(db: D1Database): Promise<ReferralPolicyRow> {
  const row = await db.prepare(
    `SELECT status, referred_reward_credit, milestones_json, minimum_account_age_hours, minimum_completed_jobs, policy_version
     FROM referral_policy_projection WHERE id='active' LIMIT 1`,
  ).first<ReferralPolicyRow>();
  if (!row) {
    return {
      status: 'active',
      referred_reward_credit: 10_000,
      milestones_json: JSON.stringify(DEFAULT_REFERRAL_MILESTONES),
      minimum_account_age_hours: 24,
      minimum_completed_jobs: 1,
      policy_version: 1,
    };
  }
  return row;
}

function randomReferralCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  let value = '';
  for (const byte of bytes) value += alphabet[byte % alphabet.length];
  return value;
}

export async function ensureReferralCode(env: RewardProgramEnv, actor: AsteraActorProjection): Promise<{ rawCode: string | null; hint: string }> {
  const existing = await env.ASTERA_DB.prepare(
    `SELECT masked_hint FROM referral_codes WHERE user_id=?1 AND status='active' LIMIT 1`,
  ).bind(actor.user.id).first<{ masked_hint: string }>();
  if (existing) return { rawCode: null, hint: existing.masked_hint };

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const rawCode = randomReferralCode();
    const digest = await rewardCodeDigest(env, rawCode);
    const now = new Date().toISOString();
    const result = await env.ASTERA_DB.prepare(
      `INSERT OR IGNORE INTO referral_codes (user_id, code_digest, masked_hint, status, created_at, updated_at)
       VALUES (?1,?2,?3,'active',?4,?4)`,
    ).bind(actor.user.id, digest, maskedRewardCode(rawCode), now).run();
    if (result.success !== false) {
      const check = await env.ASTERA_DB.prepare(
        `SELECT code_digest FROM referral_codes WHERE user_id=?1 AND code_digest=?2 LIMIT 1`,
      ).bind(actor.user.id, digest).first<{ code_digest: string }>();
      if (check) return { rawCode, hint: maskedRewardCode(rawCode) };
    }
  }
  throw new FunctionHttpError(503, 'REFERRAL_CODE_GENERATION_FAILED', '紹介コードを発行できませんでした。');
}

export async function adminiRequest<T>(env: RewardProgramEnv, path: string, init: RequestInit = {}): Promise<T> {
  const origin = env.ADMINI_API_ORIGIN?.trim().replace(/\/$/, '');
  const token = env.ADMINI_INTERNAL_TOKEN?.trim();
  if (!origin || !token) throw new FunctionHttpError(503, 'ADMINI_CONNECTION_NOT_CONFIGURED', 'Admini連携が設定されていません。');
  const response = await fetch(`${origin}${path.startsWith('/') ? path : `/${path}`}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  });
  const payload = await response.json().catch(() => null) as T | null;
  if (!response.ok || payload === null) {
    throw new FunctionHttpError(response.status >= 500 ? 503 : response.status, 'ADMINI_REQUEST_FAILED', 'Admini連携を完了できませんでした。', { status: response.status });
  }
  return payload;
}
