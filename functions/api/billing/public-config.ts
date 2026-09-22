import { functionErrorResponse, requestCorrelationId, requireFreshAsteraActor, type AsteraFunctionEnv } from '../../_account-projection';
import { proxyBillingRequest, type BillingProxyEnv } from '../../_billing-service-proxy';

type Env = AsteraFunctionEnv & BillingProxyEnv;
type PagesContext = { request: Request; env: Env };

export async function onRequestGet(context: PagesContext): Promise<Response> {
  const requestId = requestCorrelationId(context.request);
  try {
    const actor = await requireFreshAsteraActor(context.request, context.env);
    return await proxyBillingRequest(context.env, 'GET', '/api/billing/public-config', context.request, actor, requestId);
  } catch (error) {
    return functionErrorResponse(error, requestId);
  }
}
export function onRequest(context: PagesContext): Promise<Response> {
  if (context.request.method !== 'GET') return Promise.resolve(Response.json({ error: { code: 'METHOD_NOT_ALLOWED' } }, { status: 405 }));
  return onRequestGet(context);
}
