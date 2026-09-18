import { functionErrorResponse, requestCorrelationId, requireAsteraActor } from '../../_account-projection';
import {
  couponCodeDigest,
  immediateCreditAmount,
  loadCouponProjection,
  parseRewardItems,
  rewardDescription,
  rewardSummary,
  validateCouponForActor,
  type CouponProgramEnv,
} from '../../_coupon-program';

type PagesContext = { request: Request; env: CouponProgramEnv };

export async function onRequest(context: PagesContext): Promise<Response> {
  const requestId = requestCorrelationId(context.request);
  try {
    if (context.request.method !== 'POST') {
      return Response.json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'POSTを使用してください。', correlation_id: requestId } }, { status: 405 });
    }
    const actor = await requireAsteraActor(context.request, context.env);
    const body = await context.request.json().catch(() => null) as { code?: unknown } | null;
    const digest = await couponCodeDigest(context.env, body?.code);
    const projection = await validateCouponForActor(context.env.ASTERA_DB, actor, await loadCouponProjection(context.env.ASTERA_DB, digest));
    const items = parseRewardItems(projection.items_json);
    return Response.json({
      valid: true,
      campaign_id: projection.campaign_id,
      reward_package_id: projection.reward_package_id,
      reward_version: projection.reward_version,
      title: projection.campaign_name || projection.reward_name || 'クーポン',
      description: projection.campaign_purpose || rewardDescription(items),
      credit_amount: immediateCreditAmount(items),
      reward_summary: rewardSummary(items),
      expires_at: projection.expires_at,
      confirmation_required: true,
    }, { headers: { 'Cache-Control': 'no-store', 'X-Correlation-ID': requestId } });
  } catch (error) {
    return functionErrorResponse(error, requestId);
  }
}
