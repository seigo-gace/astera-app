import {
  functionErrorResponse,
  requestCorrelationId,
  requireAsteraActor,
  type AsteraFunctionEnv,
} from '../../_account-projection';
import { proxyBillingRequest, type BillingProxyEnv } from '../../_billing-service-proxy';

type Env = AsteraFunctionEnv & BillingProxyEnv;
type PagesContext = { request: Request; env: Env };

export async function onRequestPost(context: PagesContext): Promise<Response> {
  const requestId = requestCorrelationId(context.request);
  try {
    const actor = await requireAsteraActor(context.request, context.env);
    const rawBody = await context.request.text();
    return await proxyBillingRequest(
      context.env,
      'POST',
      '/api/storage/checkout-intents',
      context.request,
      actor,
      requestId,
      rawBody,
    );
  } catch (error) {
    return functionErrorResponse(error, requestId);
  }
}

export function onRequest(context: PagesContext): Promise<Response> {
  if (context.request.method !== 'POST') {
    return Promise.resolve(Response.json(
      { error: { code: 'METHOD_NOT_ALLOWED', message: 'POSTのみ対応しています。' } },
      { status: 405, headers: { Allow: 'POST' } },
    ));
  }
  return onRequestPost(context);
}
