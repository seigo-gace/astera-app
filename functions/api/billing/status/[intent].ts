import {
  FunctionHttpError,
  functionErrorResponse,
  requestCorrelationId,
  requireAsteraActor,
  type AsteraFunctionEnv,
} from '../../../_account-projection';
import { proxyBillingRequest, type BillingProxyEnv } from '../../../_billing-service-proxy';

type Env = AsteraFunctionEnv & BillingProxyEnv;
type PagesContext = { request: Request; env: Env; params: { intent?: string } };

export async function onRequestGet(context: PagesContext): Promise<Response> {
  const requestId = requestCorrelationId(context.request);
  try {
    const actor = await requireAsteraActor(context.request, context.env);
    const intentId = context.params.intent?.trim();
    if (!intentId) throw new FunctionHttpError(400, 'INTENT_ID_REQUIRED', 'Billing Intent IDが必要です。');
    return await proxyBillingRequest(
      context.env,
      'GET',
      `/api/billing/status/${encodeURIComponent(intentId)}`,
      context.request,
      actor,
      requestId,
    );
  } catch (error) {
    return functionErrorResponse(error, requestId);
  }
}

export function onRequest(context: PagesContext): Promise<Response> {
  if (context.request.method !== 'GET') {
    return Promise.resolve(Response.json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'GETのみ対応しています。' } }, { status: 405 }));
  }
  return onRequestGet(context);
}
