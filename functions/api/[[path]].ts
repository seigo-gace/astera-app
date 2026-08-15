import {
  functionErrorResponse,
  requestCorrelationId,
  requireAsteraActor,
  type AsteraFunctionEnv,
} from '../_account-projection';
import { loadStorageContractProjection } from '../_storage-contract';

type Env = AsteraFunctionEnv & {
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

const LOCALLY_OWNED_PREFIXES = [
  '/api/catalog/',
  '/api/account',
  '/api/auth/',
  '/api/billing/',
  '/api/credit/',
  '/api/jobs',
  '/api/uploads',
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

const SPOOFABLE_INTERNAL_HEADERS = new Set([
  'x-astera-user-id',
  'x-astera-tenant-id',
  'x-astera-account-status',
  'x-astera-ui-language',
  'x-astera-email',
  'x-astera-session-id',
  'x-astera-internal-authenticated',
  'x-astera-storage-entitled',
  'x-astera-storage-capacity-bytes',
  'x-astera-storage-state',
  'x-astera-storage-write-allowed',
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

function matchesPrefix(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(prefix));
}

function isAllowedPath(pathname: string): boolean {
  return pathname.startsWith('/api/') && matchesPrefix(pathname, ALLOWED_PREFIXES);
}

function isLocallyOwnedPath(pathname: string): boolean {
  return matchesPrefix(pathname, LOCALLY_OWNED_PREFIXES);
}

function responseHeaders(upstream: Response, correlationId: string, publicOrigin: string): Headers {
  const headers = new Headers();
  for (const [key, value] of upstream.headers) {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lower)) continue;
    if (lower === 'set-cookie') {
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
  const correlationId = requestCorrelationId(request);

  if (!isAllowedPath(requestUrl.pathname)) {
    return jsonError(404, 'API_ROUTE_NOT_FOUND', 'Astera App API Routeが定義されていません。', correlationId);
  }

  if (isLocallyOwnedPath(requestUrl.pathname)) {
    return jsonError(
      503,
      'LOCAL_API_ROUTE_NOT_BOUND',
      'Cloudflare上の専用API FunctionがRouteへBindingされていません。',
      correlationId,
      { pathname: requestUrl.pathname },
    );
  }

  const upstreamOrigin = normalizedOrigin(env.APP_API_ORIGIN);
  if (!upstreamOrigin) {
    return jsonError(503, 'APP_API_ORIGIN_NOT_CONFIGURED', 'Astera App Backend API接続先が設定されていません。', correlationId);
  }
  if (!env.APP_API_SERVICE_TOKEN?.trim()) {
    return jsonError(503, 'APP_API_SERVICE_TOKEN_NOT_CONFIGURED', 'Astera App Backend用Service Tokenが設定されていません。', correlationId);
  }

  let actor;
  try {
    actor = await requireAsteraActor(request, env);
  } catch (error) {
    return functionErrorResponse(error, correlationId);
  }

  let storageProjection = null;
  if (requestUrl.pathname.startsWith('/api/storage/')) {
    try {
      storageProjection = await loadStorageContractProjection(env.ASTERA_DB, actor.profile.tenant_id);
    } catch (error) {
      return functionErrorResponse(error, correlationId);
    }
  }

  const headers = new Headers();
  for (const [key, value] of request.headers) {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lower) || SPOOFABLE_INTERNAL_HEADERS.has(lower) || lower === 'authorization') continue;
    headers.append(key, value);
  }
  headers.set('Authorization', `Bearer ${env.APP_API_SERVICE_TOKEN.trim()}`);
  headers.set('X-Correlation-ID', correlationId);
  headers.set('X-Request-ID', headers.get('X-Request-ID') || correlationId);
  headers.set('X-Forwarded-Proto', requestUrl.protocol.replace(':', ''));
  headers.set('X-Forwarded-Host', requestUrl.host);
  headers.set('X-Astera-Internal-Authenticated', '1');
  headers.set('X-Astera-User-ID', actor.user.id);
  headers.set('X-Astera-Tenant-ID', actor.profile.tenant_id);
  headers.set('X-Astera-Account-Status', actor.profile.account_status);
  headers.set('X-Astera-UI-Language', actor.profile.ui_language);
  if (actor.session?.id) headers.set('X-Astera-Session-ID', actor.session.id);
  if (storageProjection) {
    headers.set('X-Astera-Storage-Entitled', storageProjection.entitled ? '1' : '0');
    headers.set('X-Astera-Storage-Capacity-Bytes', String(storageProjection.capacityBytes));
    headers.set('X-Astera-Storage-State', storageProjection.state);
    headers.set('X-Astera-Storage-Write-Allowed', storageProjection.writeAllowed ? '1' : '0');
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
      headers,
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
