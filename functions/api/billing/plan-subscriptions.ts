import { functionErrorResponse, requestCorrelationId, requireFreshAsteraActor, type AsteraFunctionEnv } from '../../_account-projection';
import { proxyBillingRequest, type BillingProxyEnv } from '../../_billing-service-proxy';

type Env = AsteraFunctionEnv & BillingProxyEnv;
type PagesContext = { request: Request; env: Env };

export async function onRequestPost(context: PagesContext): Promise<Response> {
  const requestId = requestCorrelationId(context.request);
  try {
    const actor = await requireFreshAsteraActor(context.request, context.env);
    return await proxyBillingRequest(
      context.env,
      'POST',
      '/api/billing/plan-subscriptions',
      context.request,
      actor,
      requestId,
      await context.request.text(),
    );
  } catch (error) {
    return functionErrorResponse(error, requestId);
  }
}
export function onRequest(context: PagesContext): Promise<Response> {
  if (context.request.method !== 'POST') return Promise.resolve(Response.json({ error: { code: 'METHOD_NOT_ALLOWED' } }, { status: 405 }));
  return onRequestPost(context);
}
