import { functionErrorResponse, requestCorrelationId, requireAsteraActor } from '../../_account-projection';
import type { CouponProgramEnv } from '../../_coupon-program';

type PagesContext = { request: Request; env: CouponProgramEnv };
type RedemptionHistoryRow = { id:string; campaign_id:string; campaign_name:string; reward_package_id:string; state:string; created_at:string; applied_at:string|null };

export async function onRequest(context: PagesContext): Promise<Response> {
  const requestId=requestCorrelationId(context.request);
  try {
    if(context.request.method!=='GET') return Response.json({error:{code:'METHOD_NOT_ALLOWED',message:'GETを使用してください。',correlation_id:requestId}},{status:405});
    const actor=await requireAsteraActor(context.request,context.env);
    const rows=await context.env.ASTERA_DB.prepare(`SELECT r.id,r.campaign_id,c.name AS campaign_name,r.reward_package_id,r.state,r.created_at,r.applied_at FROM coupon_redemptions r JOIN coupon_campaign_projection c ON c.id=r.campaign_id WHERE r.user_id=?1 AND r.tenant_id=?2 ORDER BY r.created_at DESC LIMIT 50`).bind(actor.user.id,actor.profile.tenant_id).all<RedemptionHistoryRow>();
    return Response.json({redemptions:rows.results??[]},{headers:{'Cache-Control':'no-store','X-Correlation-ID':requestId}});
  } catch(error){return functionErrorResponse(error,requestId);}
}
