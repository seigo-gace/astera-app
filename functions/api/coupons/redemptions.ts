import {
  functionErrorResponse,
  requestCorrelationId,
  requireAsteraActor,
} from '../../_account-projection';
import type { RewardProgramEnv } from '../../_reward-programs';

type PagesContext = { request: Request; env: RewardProgramEnv };

type RedemptionHistoryRow = {
  id: string;
  campaign_id: string;
  reward_package_id: string;
  state: string;
  created_at: string;
  applied_at: string | null;
};

export async function onRequest(context: PagesContext): Promise<Response> {
  const requestId = requestCorrelationId(context.request);
  try {
    if (context.request.method !== 'GET') {
      return Response.json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'GETを使用してください。', correlation_id: requestId } }, { status: 405 });
    }
    const actor = await requireAsteraActor(context.request, context.env);
    const rows = await context.env.ASTERA_DB.prepare(
      `SELECT id, campaign_id, reward_package_id, state, created_at, applied_at
       FROM coupon_redemptions
       WHERE user_id=?1 AND tenant_id=?2
       ORDER BY created_at DESC
       LIMIT 50`,
    ).bind(actor.user.id, actor.profile.tenant_id).all<RedemptionHistoryRow>();
    return Response.json({ redemptions: rows.results ?? [] }, {
      headers: { 'Cache-Control': 'no-store', 'X-Correlation-ID': requestId },
    });
  } catch (error) {
    return functionErrorResponse(error, requestId);
  }
}
