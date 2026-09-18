import type { AsteraActorProjection } from './_account-projection';

export type BillingProxyEnv = {
  BILLING_SERVICE_URL?: string;
  BILLING_APP_SECRET?: string;
};

function billingBase(env: BillingProxyEnv): string | null {
  const raw = env.BILLING_SERVICE_URL?.trim();
  if (!raw) return null;
  return raw.replace(/\/+$/, '');
}

export function billingServiceUnavailableResponse(): Response {
  return Response.json(
    { error: { code: 'BILLING_SERVICE_UNAVAILABLE', message: 'Billing service is not configured.' } },
    { status: 503, headers: { 'Cache-Control': 'no-store' } },
  );
}

function actorHeaders(actor: AsteraActorProjection): Record<string, string> {
  return {
    'x-astera-tenant-id': actor.profile.tenant_id,
    'x-astera-user-id': actor.user.id,
    'x-astera-user-email': actor.user.email ?? '',
  };
}

export async function proxyBillingRequest(
  env: BillingProxyEnv,
  method: string,
  path: string,
  request: Request,
  actor: AsteraActorProjection,
  requestId: string,
  body?: string,
): Promise<Response> {
  const base = billingBase(env);
  if (!base) return billingServiceUnavailableResponse();

  const headers = new Headers({
    Accept: 'application/json',
    ...actorHeaders(actor),
    'X-Request-ID': requestId,
  });
  const idempotency = request.headers.get('Idempotency-Key')?.trim();
  if (idempotency) headers.set('Idempotency-Key', idempotency);
  const contentType = request.headers.get('Content-Type')?.trim();
  if (contentType) headers.set('Content-Type', contentType);
  const secret = env.BILLING_APP_SECRET?.trim();
  if (secret) headers.set('Authorization', `Bearer ${secret}`);

  const upstream = await fetch(`${base}${path}`, {
    method,
    headers,
    body: method === 'GET' || method === 'HEAD' ? undefined : body,
  });

  const responseHeaders = new Headers(upstream.headers);
  responseHeaders.set('Cache-Control', 'no-store');
  responseHeaders.set('X-Correlation-ID', requestId);
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}
