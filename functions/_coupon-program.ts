import { FunctionHttpError, type AsteraActorProjection, type AsteraFunctionEnv, type D1Database } from './_account-projection';

export type CouponProgramEnv = AsteraFunctionEnv;

export type RewardItem =
  | { type: 'credit_grant'; amount: number; label?: string }
  | { type: 'credit_schedule'; amount: number; grants: number; cadence_months?: number; label?: string }
  | { type: 'access_tier' | 'feature' | 'seat_limit' | 'benefit'; key: string; value: unknown; duration_days?: number; label?: string };

export type CouponProjection = {
  code_digest: string;
  masked_hint: string;
  code_status: string;
  code_redemption_limit: number;
  code_redeemed_count: number;
  bound_user_id: string | null;
  campaign_id: string;
  campaign_name: string;
  campaign_purpose: string;
  campaign_status: string;
  distribution_mode: 'UNIQUE' | 'SHARED' | 'ACCOUNT_BOUND';
  starts_at: string | null;
  expires_at: string | null;
  total_limit: number | null;
  per_account_limit: number;
  campaign_redeemed_count: number;
  reward_package_id: string;
  reward_name: string;
  reward_version: number;
  reward_status: string;
  items_json: string;
};

function requiredSecret(env: CouponProgramEnv): string {
  const value = env.BETTER_AUTH_SECRET?.trim();
  if (!value || value.length < 32) throw new FunctionHttpError(503, 'COUPON_DIGEST_SECRET_UNAVAILABLE', 'Coupon検証用Secretを利用できません。');
  return value;
}

export function normalizeCouponCode(raw: unknown): string {
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

export async function couponCodeDigest(env: CouponProgramEnv, rawCode: unknown): Promise<string> {
  const normalized = normalizeCouponCode(rawCode);
  if (normalized.length < 6 || normalized.length > 64 || !/^[A-Z0-9]+$/.test(normalized)) throw new FunctionHttpError(400, 'INVALID', 'コードを確認してください。');
  const keyBytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`astera:coupon-code:v1:${requiredSecret(env)}`));
  return hmacHex(keyBytes, normalized);
}

export function maskedCouponCode(rawCode: string): string {
  const normalized = normalizeCouponCode(rawCode);
  if (normalized.length <= 4) return '••••';
  return `${normalized.slice(0, 2)}••••${normalized.slice(-2)}`;
}

export function parseRewardItems(raw: string): RewardItem[] {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new FunctionHttpError(500, 'REWARD_PACKAGE_INVALID', 'Reward定義を読み込めませんでした。'); }
  if (!Array.isArray(value) || value.length === 0) throw new FunctionHttpError(500, 'REWARD_PACKAGE_EMPTY', 'Reward定義が空です。');
  const items: RewardItem[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new FunctionHttpError(500, 'REWARD_ITEM_INVALID', 'Reward定義が不正です。');
    const item = candidate as Record<string, unknown>;
    const type = item.type;
    if (type === 'credit_grant') {
      const amount = Number(item.amount);
      if (!Number.isSafeInteger(amount) || amount <= 0) throw new FunctionHttpError(500, 'REWARD_CREDIT_INVALID', 'Credit Reward定義が不正です。');
      items.push({ type, amount, label: typeof item.label === 'string' ? item.label : undefined });
      continue;
    }
    if (type === 'credit_schedule') {
      const amount = Number(item.amount); const grants = Number(item.grants); const cadence = item.cadence_months === undefined ? 1 : Number(item.cadence_months);
      if (!Number.isSafeInteger(amount) || amount <= 0 || !Number.isSafeInteger(grants) || grants <= 0 || !Number.isSafeInteger(cadence) || cadence <= 0) throw new FunctionHttpError(500, 'REWARD_SCHEDULE_INVALID', '月次Credit Reward定義が不正です。');
      items.push({ type, amount, grants, cadence_months: cadence, label: typeof item.label === 'string' ? item.label : undefined });
      continue;
    }
    if (type === 'access_tier' || type === 'feature' || type === 'seat_limit' || type === 'benefit') {
      const key = typeof item.key === 'string' ? item.key.trim() : ''; const duration = item.duration_days === undefined ? undefined : Number(item.duration_days);
      if (!key || (duration !== undefined && (!Number.isSafeInteger(duration) || duration <= 0))) throw new FunctionHttpError(500, 'REWARD_ENTITLEMENT_INVALID', '利用権Reward定義が不正です。');
      items.push({ type, key, value: item.value ?? true, duration_days: duration, label: typeof item.label === 'string' ? item.label : undefined });
      continue;
    }
    throw new FunctionHttpError(500, 'REWARD_ITEM_TYPE_UNSUPPORTED', '未対応のReward定義です。');
  }
  return items;
}

export function rewardSummary(items: RewardItem[]): Array<Record<string, unknown>> {
  return items.map((item) => item.type === 'credit_grant'
    ? { type: item.type, amount: item.amount, label: item.label ?? `${item.amount.toLocaleString()} Credit` }
    : item.type === 'credit_schedule'
      ? { type: item.type, amount: item.amount, grants: item.grants, cadence_months: item.cadence_months ?? 1, label: item.label ?? `${item.amount.toLocaleString()} Credit × ${item.grants}回` }
      : { type: item.type, key: item.key, value: item.value, duration_days: item.duration_days ?? null, label: item.label ?? item.key });
}

export function rewardDescription(items: RewardItem[]): string {
  return rewardSummary(items).map((item) => String(item.label ?? '')).filter(Boolean).join(' / ');
}

export function immediateCreditAmount(items: RewardItem[]): number {
  return items.reduce((sum, item) => sum + (item.type === 'credit_grant' || item.type === 'credit_schedule' ? item.amount : 0), 0);
}

export async function loadCouponProjection(db: D1Database, digest: string): Promise<CouponProjection | null> {
  return db.prepare(`SELECT code.code_digest,code.masked_hint,code.status AS code_status,code.redemption_limit AS code_redemption_limit,code.redeemed_count AS code_redeemed_count,code.bound_user_id,campaign.id AS campaign_id,campaign.name AS campaign_name,campaign.purpose AS campaign_purpose,campaign.status AS campaign_status,campaign.distribution_mode,campaign.starts_at,campaign.expires_at,campaign.total_limit,campaign.per_account_limit,campaign.redeemed_count AS campaign_redeemed_count,reward.id AS reward_package_id,reward.name AS reward_name,reward.version AS reward_version,reward.status AS reward_status,reward.items_json FROM coupon_code_projection code JOIN coupon_campaign_projection campaign ON campaign.id=code.campaign_id JOIN reward_package_projection reward ON reward.id=campaign.reward_package_id WHERE code.code_digest=?1 LIMIT 1`).bind(digest).first<CouponProjection>();
}

function parseTime(value: string | null): number | null { if (!value) return null; const parsed = Date.parse(value); return Number.isFinite(parsed) ? parsed : null; }

export async function validateCouponForActor(db: D1Database, actor: AsteraActorProjection, coupon: CouponProjection | null): Promise<CouponProjection> {
  if (!coupon) throw new FunctionHttpError(404, 'INVALID', 'コードを確認してください。');
  const now = Date.now();
  if (coupon.code_status === 'expired' || coupon.campaign_status === 'expired') throw new FunctionHttpError(409, 'EXPIRED', '利用期限が終了しています。');
  if (coupon.code_status !== 'active' || coupon.campaign_status !== 'active' || coupon.reward_status !== 'active') throw new FunctionHttpError(409, 'NOT_ELIGIBLE', 'このコードは現在利用できません。');
  const startsAt = parseTime(coupon.starts_at); const expiresAt = parseTime(coupon.expires_at);
  if (startsAt !== null && now < startsAt) throw new FunctionHttpError(409, 'NOT_ELIGIBLE', 'このコードはまだ利用できません。');
  if (expiresAt !== null && now >= expiresAt) throw new FunctionHttpError(409, 'EXPIRED', '利用期限が終了しています。');
  if (coupon.bound_user_id && coupon.bound_user_id !== actor.user.id) throw new FunctionHttpError(403, 'NOT_ELIGIBLE', 'このアカウントでは利用できません。');
  if (coupon.total_limit !== null && coupon.campaign_redeemed_count >= coupon.total_limit) throw new FunctionHttpError(409, 'LIMIT_REACHED', '利用上限に達しています。');
  if (coupon.code_redeemed_count >= coupon.code_redemption_limit) throw new FunctionHttpError(409, 'USED', 'すでに使用されています。');
  const userCount = await db.prepare(`SELECT COUNT(*) AS count FROM coupon_redemptions WHERE campaign_id=?1 AND user_id=?2 AND state IN ('reserved','applying','applied','reconcile_required')`).bind(coupon.campaign_id, actor.user.id).first<{ count: number }>();
  if (Number(userCount?.count ?? 0) >= coupon.per_account_limit) throw new FunctionHttpError(409, 'USED', 'すでに使用されています。');
  return coupon;
}

export async function requestFingerprint(parts: unknown[]): Promise<string> { return sha256Hex(JSON.stringify(parts)); }

async function existingLedgerTransaction(db: D1Database, idempotencyKey: string): Promise<string | null> {
  const row = await db.prepare('SELECT transaction_id FROM credit_ledger WHERE idempotency_key=?1 LIMIT 1').bind(idempotencyKey).first<{ transaction_id: string }>();
  return row?.transaction_id ?? null;
}

export async function grantCredit(db: D1Database, actor: AsteraActorProjection, amount: number, input: { idempotencyKey: string; referenceType: string; referenceId: string; fingerprint: string }): Promise<string> {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new FunctionHttpError(500, 'CREDIT_GRANT_INVALID', 'Credit付与量が不正です。');
  const existing = await existingLedgerTransaction(db, input.idempotencyKey); if (existing) return existing;
  const transactionId = crypto.randomUUID(); const now = new Date().toISOString();
  const results = await db.batch([
    db.prepare(`UPDATE credit_accounts SET available_balance=available_balance+?1,version=version+1,updated_at=?2 WHERE id=?3 AND NOT EXISTS (SELECT 1 FROM credit_ledger WHERE idempotency_key=?4)`).bind(amount, now, actor.credit.id, input.idempotencyKey),
    db.prepare(`INSERT OR IGNORE INTO credit_ledger (transaction_id,credit_account_id,kind,amount,idempotency_key,reference_type,reference_id,request_fingerprint,created_at) VALUES (?1,?2,'grant',?3,?4,?5,?6,?7,?8)`).bind(transactionId, actor.credit.id, amount, input.idempotencyKey, input.referenceType, input.referenceId, input.fingerprint, now),
  ]);
  if (results.some((result) => result.success === false)) throw new FunctionHttpError(503, 'CREDIT_GRANT_FAILED', 'Credit付与を完了できませんでした。');
  return (await existingLedgerTransaction(db, input.idempotencyKey)) ?? transactionId;
}

function addDays(iso: string, days: number): string { const date = new Date(iso); date.setUTCDate(date.getUTCDate()+days); return date.toISOString(); }
function addMonths(iso: string, months: number): string { const date = new Date(iso); date.setUTCMonth(date.getUTCMonth()+months); return date.toISOString(); }

export async function applyCouponRewardItems(db: D1Database, actor: AsteraActorProjection, items: RewardItem[], input: { referenceId: string; fingerprint: string }): Promise<{ creditTransactions: string[]; entitlementIds: string[]; scheduleIds: string[] }> {
  const creditTransactions: string[]=[]; const entitlementIds: string[]=[]; const scheduleIds: string[]=[]; const now=new Date().toISOString();
  for (let index=0; index<items.length; index+=1) {
    const item=items[index];
    if (item.type==='credit_grant') {
      creditTransactions.push(await grantCredit(db,actor,item.amount,{idempotencyKey:`coupon_redemption:${input.referenceId}:credit:${index}`,referenceType:'coupon_redemption',referenceId:`${input.referenceId}:credit:${index}`,fingerprint:input.fingerprint})); continue;
    }
    if (item.type==='credit_schedule') {
      const scheduleId=`coupon_redemption:${input.referenceId}:schedule:${index}`;
      creditTransactions.push(await grantCredit(db,actor,item.amount,{idempotencyKey:`${scheduleId}:grant:1`,referenceType:'coupon_redemption',referenceId:`${input.referenceId}:schedule:${index}:grant:1`,fingerprint:input.fingerprint}));
      const remaining=Math.max(0,item.grants-1); const status=remaining===0?'completed':'active'; const nextGrantAt=remaining===0?null:addMonths(now,item.cadence_months??1);
      await db.prepare(`INSERT INTO reward_credit_schedules (id,tenant_id,user_id,amount,remaining_grants,grants_applied,cadence_months,next_grant_at,status,reference_type,reference_id,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,1,?6,?7,?8,'coupon_redemption',?9,?10,?10) ON CONFLICT(reference_type,reference_id) DO NOTHING`).bind(scheduleId,actor.profile.tenant_id,actor.user.id,item.amount,remaining,item.cadence_months??1,nextGrantAt,status,`${input.referenceId}:schedule:${index}`,now).run();
      scheduleIds.push(scheduleId); continue;
    }
    const entitlementId=`coupon_redemption:${input.referenceId}:entitlement:${index}`; const expiresAt=item.duration_days?addDays(now,item.duration_days):null;
    await db.prepare(`INSERT INTO reward_entitlements (id,tenant_id,user_id,entitlement_type,entitlement_key,value_json,starts_at,expires_at,status,reference_type,reference_id,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,'active','coupon_redemption',?9,?10,?10) ON CONFLICT(reference_type,reference_id,entitlement_type,entitlement_key) DO UPDATE SET value_json=excluded.value_json,expires_at=excluded.expires_at,updated_at=excluded.updated_at`).bind(entitlementId,actor.profile.tenant_id,actor.user.id,item.type,item.key,JSON.stringify(item.value),now,expiresAt,input.referenceId,now).run();
    entitlementIds.push(entitlementId);
  }
  return { creditTransactions, entitlementIds, scheduleIds };
}
