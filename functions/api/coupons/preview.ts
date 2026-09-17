import {
  functionErrorResponse,
  requestCorrelationId,
  requireAsteraActor,
} from '../../_account-projection';
import {
  loadCouponProjection,
  parseRewardItems,
  rewardCodeDigest,
  rewardSummary,
  validateCouponForActor,
  type RewardProgramEnv,
} from '../../_reward-programs';

type PagesContext = { request: Request; env: RewardProgramEnv };

export async function onRequest(context: PagesContext): Promise<Response> {
  const requestId = requestCorrelationId(context.request);
  try {
    if (context.request.method !== 'POST') {
      return Response.json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'POSTを使用してください。', correlation_id: requestId } }, { status: 405 });
    }
    const actor = await requireAsteraActor(context.request, context.env);
    const body = await context.request.json().catch(() => null) as { code?: unknown } | null;
    const digest = await rewardCodeDigest(context.env, body?.code);
    const projection = await validateCouponForActor(
      context.env.ASTERA_DB,
      actor,
      await loadCouponProjection(context.env.ASTERA_DB, digest),
    );
    const items = parseRewardItems(projection.items_json);
    return Response.json({
      valid: true,
      campaign_id: projection.campaign_id,
      reward_package_id: projection.reward_package_id,
      reward_version: projection.reward_version,
      reward_summary: rewardSummary(items),
      expires_at: projection.expires_at,
      confirmation_required: true,
    }, { headers: { 'Cache-Control': 'no-store', 'X-Correlation-ID': requestId } });
  } catch (error) {
    return functionErrorResponse(error, requestId);
  }
}
