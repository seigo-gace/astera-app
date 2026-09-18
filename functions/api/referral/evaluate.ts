import {
  functionErrorResponse,
  requestCorrelationId,
  requireAsteraActor,
} from '../../_account-projection';
import { evaluateRelatedReferrals, type ReferralEnv } from '../../_referral-program';

type PagesContext = { request: Request; env: ReferralEnv };

export async function onRequest(context: PagesContext): Promise<Response> {
  const requestId = requestCorrelationId(context.request);
  try {
    if (context.request.method !== 'POST') {
      return Response.json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'POSTを使用してください。', correlation_id: requestId } }, { status: 405 });
    }
    const actor = await requireAsteraActor(context.request, context.env);
    await evaluateRelatedReferrals(context.env, context.request, actor);
    return Response.json({ evaluated: true }, { headers: { 'Cache-Control': 'no-store', 'X-Correlation-ID': requestId } });
  } catch (error) {
    return functionErrorResponse(error, requestId);
  }
}
