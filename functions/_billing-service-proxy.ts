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
    { error: 'BILLING_SERVICE_UNAVAILABLE' },
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

  // Cloudflare Pages/Workers: forwarding hop-by-hop upstream headers (Connection,
  // Keep-Alive, Transfer-Encoding, etc.) can crash the isolate with plain-text 502.
  // Buffer the body and return only safe client headers.
  const upstreamText = await upstream.text();
  const responseHeaders = new Headers({
    'Cache-Control': 'no-store',
    'X-Correlation-ID': requestId,
  });
  const upstreamContentType = upstream.headers.get('Content-Type')?.trim();
  if (upstreamContentType) responseHeaders.set('Content-Type', upstreamContentType);
  const upstreamCorrelation = upstream.headers.get('X-Correlation-ID')?.trim();
  if (upstreamCorrelation) responseHeaders.set('X-Upstream-Correlation-ID', upstreamCorrelation);
  return new Response(upstreamText, { status: upstream.status, headers: responseHeaders });
}
