type Env = {
  APP_API_ORIGIN?: string;
  APP_API_SERVICE_TOKEN?: string;
  APP_API_TIMEOUT_MS?: string;
  APP_PUBLIC_ORIGIN?: string;
};

type PagesContext = {
  request: Request;
  env: Env;
};

const ALLOWED_PREFIXES = [
  '/api/catalog/',
  '/api/account',
  '/api/auth/',
  '/api/billing/',
  '/api/credit/',
  '/api/jobs',
  '/api/uploads',
  '/api/preferences',
  '/api/projects',
  '/api/history',
  '/api/results',
  '/api/shares',
  '/api/templates',
  '/api/storage/',
  '/api/developer/',
  '/api/notifications',
  '/api/return-contexts',
] as const;

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
]);

function jsonError(status: number, code: string, message: string, correlationId: string, details?: unknown): Response {
  return Response.json(
    { error: { code, message, correlation_id: correlationId, retryable: status >= 500, details } },
    { status, headers: { 'Cache-Control': 'no-store', 'X-Correlation-ID': correlationId } },
  );
}

function normalizedOrigin(raw: string | undefined): URL | null {
  if (!raw?.trim()) return null;
  try {
    const value = new URL(raw.trim());
    if (value.protocol !== 'https:' && value.hostname !== 'localhost' && value.hostname !== '127.0.0.1') return null;
    value.pathname = value.pathname.replace(/\/+$/, '');
    value.search = '';
    value.hash = '';
    return value;
  } catch {
    return null;
  }
}

function isAllowedPath(pathname: string): boolean {
  if (!pathname.startsWith('/api/')) return false;
  return ALLOWED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix));
}

function requestHeaders(request: Request, serviceToken: string | undefined, correlationId: string): Headers {
  const headers = new Headers();
  for (const [key, value] of request.headers) {
    if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) headers.append(key, value);
  }
  headers.set('X-Correlation-ID', correlationId);
  headers.set('X-Request-ID', headers.get('X-Request-ID') || correlationId);
  headers.set('X-Forwarded-Proto', new URL(request.url).protocol.replace(':', ''));
  headers.set('X-Forwarded-Host', new URL(request.url).host);
  if (serviceToken?.trim()) headers.set('Authorization', `Bearer ${serviceToken.trim()}`);
  return headers;
}

function responseHeaders(upstream: Response, correlationId: string, publicOrigin: string): Headers {
  const headers = new Headers();
  for (const [key, value] of upstream.headers) {
    if (HOP_BY_HOP_HEADERS.has(key.toLowerCase())) continue;
    if (key.toLowerCase() === 'set-cookie') {
      const sanitized = value
        .replace(/;\s*Domain=[^;]+/ig, '')
        .replace(/;\s*SameSite=None/ig, '; SameSite=Lax');
      headers.append(key, sanitized);
      continue;
    }
    headers.append(key, value);
  }
  headers.set('Cache-Control', upstream.headers.get('Cache-Control') || 'no-store');
  headers.set('X-Correlation-ID', correlationId);
  headers.set('Vary', [headers.get('Vary'), 'Origin'].filter(Boolean).join(', '));
  headers.set('Content-Security-Policy', `frame-ancestors 'self' ${publicOrigin}`);
  return headers;
}

function timeoutMs(raw: string | undefined): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 30_000;
  return Math.min(120_000, Math.max(3_000, Math.trunc(parsed)));
}

export async function onRequest(context: PagesContext): Promise<Response> {
  const { request, env } = context;
  const requestUrl = new URL(request.url);
  const correlationId = request.headers.get('X-Request-ID')?.trim() || crypto.randomUUID();

  if (!isAllowedPath(requestUrl.pathname)) {
    return jsonError(404, 'API_ROUTE_NOT_FOUND', 'Astera App API Routeが定義されていません。', correlationId);
  }

  const upstreamOrigin = normalizedOrigin(env.APP_API_ORIGIN);
  if (!upstreamOrigin) {
    return jsonError(503, 'APP_API_ORIGIN_NOT_CONFIGURED', 'Astera App Backend API接続先が設定されていません。', correlationId);
  }

  const upstreamUrl = new URL(`${upstreamOrigin.pathname}${requestUrl.pathname}`, upstreamOrigin.origin);
  upstreamUrl.search = requestUrl.search;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort('upstream_timeout'), timeoutMs(env.APP_API_TIMEOUT_MS));
  const clientAbort = () => controller.abort(request.signal.reason || 'client_cancelled');
  request.signal.addEventListener('abort', clientAbort, { once: true });

  try {
    const upstream = await fetch(upstreamUrl, {
      method: request.method,
      headers: requestHeaders(request, env.APP_API_SERVICE_TOKEN, correlationId),
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
      redirect: 'manual',
      signal: controller.signal,
    });

    const publicOrigin = normalizedOrigin(env.APP_PUBLIC_ORIGIN)?.origin || requestUrl.origin;
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders(upstream, correlationId, publicOrigin),
    });
  } catch (error) {
    const aborted = controller.signal.aborted;
    return jsonError(
      aborted ? 504 : 502,
      aborted ? 'APP_API_UPSTREAM_TIMEOUT' : 'APP_API_UPSTREAM_UNAVAILABLE',
      aborted ? 'Astera App Backend APIの応答期限を超えました。' : 'Astera App Backend APIへ接続できません。',
      correlationId,
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    clearTimeout(timeout);
    request.signal.removeEventListener('abort', clientAbort);
  }
}
