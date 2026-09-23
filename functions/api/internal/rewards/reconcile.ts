import { FunctionHttpError, functionErrorResponse, requestCorrelationId } from '../../../_account-projection';
import { requireAdminiSignedBody, type AdminiSignatureEnv } from '../../../_admini-signature';
import type { CouponProgramEnv } from '../../../_coupon-program';

type Env = CouponProgramEnv & AdminiSignatureEnv;
type PagesContext = { request: Request; env: Env };
type Payload = { campaign_id?: unknown };

type CampaignRow = {
  id: string;
  name: string;
  purpose: string;
  reward_package_id: string;
  status: string;
  distribution_mode: string;
  starts_at: string | null;
  expires_at: string | null;
  total_limit: number | null;
  per_account_limit: number;
  redeemed_count: number;
  created_at: string;
  updated_at: string;
};

function requiredText(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new FunctionHttpError(400, `${name}_REQUIRED`, `${name}が必要です。`);
  return value.trim();
}

async function rows<T>(context: PagesContext, sql: string, ...bind: unknown[]): Promise<T[]> {
  const result = await context.env.ASTERA_DB.prepare(sql).bind(...bind).all<T>();
  return Array.isArray(result.results) ? result.results : [];
}

export async function onRequest(context: PagesContext): Promise<Response> {
  const requestId = requestCorrelationId(context.request);
  try {
    if (context.request.method !== 'POST') return Response.json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'POSTを使用してください。', correlation_id: requestId } }, { status: 405 });
    const signed = await requireAdminiSignedBody(context.request, context.env);
    const body = signed.parsed as Payload;
    const campaignId = requiredText(body.campaign_id, 'CAMPAIGN_ID');

    const campaign = await context.env.ASTERA_DB.prepare(`SELECT id,name,purpose,reward_package_id,status,distribution_mode,starts_at,expires_at,total_limit,per_account_limit,redeemed_count,created_at,updated_at FROM coupon_campaign_projection WHERE id=?1 LIMIT 1`).bind(campaignId).first<CampaignRow>();
    if (!campaign) throw new FunctionHttpError(404, 'CAMPAIGN_NOT_FOUND', 'App側のCampaign Projectionが見つかりません。');

    const codeSummary = await context.env.ASTERA_DB.prepare(`SELECT COUNT(*) AS total, SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) AS active, SUM(CASE WHEN status='revoked' THEN 1 ELSE 0 END) AS revoked, COALESCE(SUM(redeemed_count),0) AS redeemed FROM coupon_code_projection WHERE campaign_id=?1`).bind(campaignId).first<{ total:number; active:number; revoked:number; redeemed:number }>();
    const redemptionSummary = await context.env.ASTERA_DB.prepare(`SELECT COUNT(*) AS total, SUM(CASE WHEN state='applied' THEN 1 ELSE 0 END) AS applied, SUM(CASE WHEN state='reconcile_required' THEN 1 ELSE 0 END) AS reconcile_required, SUM(CASE WHEN state='failed' THEN 1 ELSE 0 END) AS failed FROM coupon_redemptions WHERE campaign_id=?1`).bind(campaignId).first<{ total:number; applied:number; reconcile_required:number; failed:number }>();

    const redemptions = await rows<Record<string, unknown>>(context, `SELECT id,code_digest,campaign_id,reward_package_id,user_id,tenant_id,redemption_seq,state,client_request_id,error_code,created_at,updated_at,applied_at FROM coupon_redemptions WHERE campaign_id=?1 ORDER BY created_at DESC LIMIT 200`, campaignId);
    const entitlements = await rows<Record<string, unknown>>(context, `SELECT e.id,e.user_id,e.entitlement_type,e.entitlement_key,e.value_json,e.starts_at,e.expires_at,e.status,e.reference_id,e.created_at,e.updated_at FROM reward_entitlements e JOIN coupon_redemptions r ON r.id=e.reference_id WHERE r.campaign_id=?1 AND e.reference_type='coupon_redemption' ORDER BY e.created_at DESC LIMIT 500`, campaignId);
    const schedules = await rows<Record<string, unknown>>(context, `SELECT s.id,s.user_id,s.amount,s.remaining_grants,s.grants_applied,s.cadence_months,s.next_grant_at,s.status,s.reference_id,s.created_at,s.updated_at FROM reward_credit_schedules s JOIN coupon_redemptions r ON s.reference_id LIKE r.id || ':%' WHERE r.campaign_id=?1 AND s.reference_type='coupon_redemption' ORDER BY s.created_at DESC LIMIT 500`, campaignId);
    const ledger = await rows<Record<string, unknown>>(context, `SELECT l.transaction_id,l.kind,l.amount,l.idempotency_key,l.reference_type,l.reference_id,l.created_at FROM credit_ledger l JOIN coupon_redemptions r ON l.reference_id LIKE r.id || ':%' WHERE r.campaign_id=?1 AND l.reference_type='coupon_redemption' ORDER BY l.created_at DESC LIMIT 500`, campaignId);

    return Response.json({
      campaign,
      codes: {
        total: Number(codeSummary?.total ?? 0),
        active: Number(codeSummary?.active ?? 0),
        revoked: Number(codeSummary?.revoked ?? 0),
        redeemed: Number(codeSummary?.redeemed ?? 0),
      },
      redemption_summary: {
        total: Number(redemptionSummary?.total ?? 0),
        applied: Number(redemptionSummary?.applied ?? 0),
        reconcile_required: Number(redemptionSummary?.reconcile_required ?? 0),
        failed: Number(redemptionSummary?.failed ?? 0),
      },
      redemptions,
      entitlements,
      schedules,
      ledger,
      reconciled_at: new Date().toISOString(),
    }, { headers: { 'Cache-Control': 'no-store', 'X-Correlation-ID': requestId } });
  } catch (error) {
    return functionErrorResponse(error, requestId);
  }
}
