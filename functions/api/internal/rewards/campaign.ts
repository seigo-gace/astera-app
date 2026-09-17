import {
  FunctionHttpError,
  functionErrorResponse,
  requestCorrelationId,
} from '../../../_account-projection';
import { requireAdminiSignedBody, type AdminiSignatureEnv } from '../../../_admini-signature';
import {
  maskedRewardCode,
  parseRewardItems,
  rewardCodeDigest,
  sha256Hex,
  type RewardProgramEnv,
} from '../../../_reward-programs';

type Env = RewardProgramEnv & AdminiSignatureEnv;
type PagesContext = { request: Request; env: Env };

type SyncPayload = {
  reward_package?: {
    id?: unknown;
    version?: unknown;
    status?: unknown;
    items?: unknown;
  };
  campaign?: {
    id?: unknown;
    status?: unknown;
    distribution_mode?: unknown;
    starts_at?: unknown;
    expires_at?: unknown;
    total_limit?: unknown;
    per_account_limit?: unknown;
  };
  codes?: Array<{
    id?: unknown;
    raw_code?: unknown;
    bound_user_id?: unknown;
    redemption_limit?: unknown;
  }>;
};

function text(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new FunctionHttpError(400, `${name}_REQUIRED`, `${name}が必要です。`);
  return value.trim();
}

function optionalIso(value: unknown, name: string): string | null {
  if (value == null || value === '') return null;
  const raw = text(value, name);
  if (!Number.isFinite(Date.parse(raw))) throw new FunctionHttpError(400, `${name}_INVALID`, `${name}が不正です。`);
  return new Date(raw).toISOString();
}

export async function onRequest(context: PagesContext): Promise<Response> {
  const requestId = requestCorrelationId(context.request);
  try {
    if (context.request.method !== 'POST') {
      return Response.json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'POSTを使用してください。', correlation_id: requestId } }, { status: 405 });
    }
    const signed = await requireAdminiSignedBody(context.request, context.env);
    const body = signed.parsed as SyncPayload;
    const reward = body.reward_package ?? {};
    const campaign = body.campaign ?? {};
    const rewardId = text(reward.id, 'REWARD_PACKAGE_ID');
    const rewardVersion = Number(reward.version);
    if (!Number.isSafeInteger(rewardVersion) || rewardVersion < 1) throw new FunctionHttpError(400, 'REWARD_VERSION_INVALID', 'Reward Versionが不正です。');
    const rewardStatus = text(reward.status, 'REWARD_STATUS');
    if (!['active','retired'].includes(rewardStatus)) throw new FunctionHttpError(400, 'REWARD_STATUS_INVALID', 'Reward状態が不正です。');
    const itemsJson = JSON.stringify(reward.items);
    parseRewardItems(itemsJson);
    const checksum = await sha256Hex(itemsJson);

    const campaignId = text(campaign.id, 'CAMPAIGN_ID');
    const campaignStatus = text(campaign.status, 'CAMPAIGN_STATUS');
    if (!['draft','scheduled','active','paused','exhausted','expired','revoked'].includes(campaignStatus)) throw new FunctionHttpError(400, 'CAMPAIGN_STATUS_INVALID', 'Campaign状態が不正です。');
    const distribution = text(campaign.distribution_mode, 'DISTRIBUTION_MODE');
    if (!['UNIQUE','SHARED','ACCOUNT_BOUND'].includes(distribution)) throw new FunctionHttpError(400, 'DISTRIBUTION_MODE_INVALID', '配布方式が不正です。');
    const totalLimit = campaign.total_limit == null ? null : Number(campaign.total_limit);
    const perAccountLimit = Number(campaign.per_account_limit ?? 1);
    if (totalLimit !== null && (!Number.isSafeInteger(totalLimit) || totalLimit <= 0)) throw new FunctionHttpError(400, 'TOTAL_LIMIT_INVALID', '総利用上限が不正です。');
    if (!Number.isSafeInteger(perAccountLimit) || perAccountLimit <= 0) throw new FunctionHttpError(400, 'PER_ACCOUNT_LIMIT_INVALID', 'Account利用上限が不正です。');
    const startsAt = optionalIso(campaign.starts_at, 'STARTS_AT');
    const expiresAt = optionalIso(campaign.expires_at, 'EXPIRES_AT');
    if (startsAt && expiresAt && Date.parse(startsAt) >= Date.parse(expiresAt)) throw new FunctionHttpError(400, 'CAMPAIGN_RANGE_INVALID', 'Campaign期間が不正です。');

    const codes = body.codes ?? [];
    if (!Array.isArray(codes) || codes.length === 0 || codes.length > 100_000) throw new FunctionHttpError(400, 'CODES_INVALID', 'Coupon Codeが必要です。');
    const now = new Date().toISOString();
    const statements = [
      context.env.ASTERA_DB.prepare(
        `INSERT INTO reward_package_projection (id,version,status,items_json,checksum,created_at,updated_at)
         VALUES (?1,?2,?3,?4,?5,?6,?6)
         ON CONFLICT(id) DO UPDATE SET
           version=excluded.version,status=excluded.status,items_json=excluded.items_json,checksum=excluded.checksum,updated_at=excluded.updated_at`,
      ).bind(rewardId, rewardVersion, rewardStatus, itemsJson, checksum, now),
      context.env.ASTERA_DB.prepare(
        `INSERT INTO coupon_campaign_projection
         (id,reward_package_id,status,distribution_mode,starts_at,expires_at,total_limit,per_account_limit,redeemed_count,created_at,updated_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,0,?9,?9)
         ON CONFLICT(id) DO UPDATE SET
           reward_package_id=excluded.reward_package_id,status=excluded.status,distribution_mode=excluded.distribution_mode,
           starts_at=excluded.starts_at,expires_at=excluded.expires_at,total_limit=excluded.total_limit,
           per_account_limit=excluded.per_account_limit,updated_at=excluded.updated_at`,
      ).bind(campaignId, rewardId, campaignStatus, distribution, startsAt, expiresAt, totalLimit, perAccountLimit, now),
    ];

    const exported: Array<{ id: string; digest: string; masked_hint: string; bound_user_id: string | null }> = [];
    for (const code of codes) {
      const id = text(code.id, 'CODE_ID');
      const raw = text(code.raw_code, 'RAW_CODE');
      const digest = await rewardCodeDigest(context.env, raw);
      const hint = maskedRewardCode(raw);
      const limit = Number(code.redemption_limit ?? 1);
      if (!Number.isSafeInteger(limit) || limit <= 0) throw new FunctionHttpError(400, 'CODE_LIMIT_INVALID', 'Code利用上限が不正です。');
      const boundUser = typeof code.bound_user_id === 'string' && code.bound_user_id.trim() ? code.bound_user_id.trim() : null;
      statements.push(context.env.ASTERA_DB.prepare(
        `INSERT INTO coupon_code_projection
         (code_digest,campaign_id,masked_hint,bound_user_id,status,redemption_limit,redeemed_count,created_at,updated_at)
         VALUES (?1,?2,?3,?4,'active',?5,0,?6,?6)
         ON CONFLICT(code_digest) DO UPDATE SET
           campaign_id=excluded.campaign_id,masked_hint=excluded.masked_hint,bound_user_id=excluded.bound_user_id,
           redemption_limit=excluded.redemption_limit,updated_at=excluded.updated_at`,
      ).bind(digest, campaignId, hint, boundUser, limit, now));
      exported.push({ id, digest, masked_hint: hint, bound_user_id: boundUser });
    }
    const results = await context.env.ASTERA_DB.batch(statements);
    if (results.some((result) => result.success === false)) throw new FunctionHttpError(503, 'COUPON_PROJECTION_SYNC_FAILED', 'Coupon Projection同期を完了できませんでした。');
    return Response.json({ campaign_id: campaignId, reward_package_id: rewardId, codes: exported }, {
      headers: { 'Cache-Control': 'no-store', 'X-Correlation-ID': requestId },
    });
  } catch (error) {
    return functionErrorResponse(error, requestId);
  }
}
