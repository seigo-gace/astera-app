import { refreshAccountProjectionForSession } from '../../_account-projection';
import { createAuth } from '../../_auth';
import { handleNativeAuthRoutes, type NativeExchangeEnv } from '../../_native-session-exchange';
import {
  blocksLastLoginMethodRemoval,
  countLoginMethods,
  insertSecurityEvent,
  parseJsonBodyMetadata,
  securityEventTypeForAuthPath,
  tenantIdForUser,
} from '../../_security-events';

type PagesContext = { request: Request; env: NativeExchangeEnv };
type SessionSnapshot = {
  user?: { id: string };
  session?: { createdAt?: Date | string; id?: string };
};

const FRESH_SESSION_MAX_AGE_MS = 15 * 60 * 1000;
const FRESH_MANAGEMENT_PATHS = new Set([
  '/api/auth/change-password',
  '/api/auth/set-password',
  '/api/auth/two-factor/enable',
  '/api/auth/two-factor/disable',
  '/api/auth/two-factor/generate-backup-codes',
  '/api/auth/passkey/add-passkey',
  '/api/auth/passkey/delete-passkey',
  '/api/auth/passkey/update-passkey',
  '/api/auth/list-sessions',
  '/api/auth/revoke-session',
  '/api/auth/revoke-other-sessions',
  '/api/auth/revoke-sessions',
  '/api/auth/list-accounts',
  '/api/auth/link-social',
  '/api/auth/unlink-account',
  '/api/auth/delete-user',
]);

const LAST_LOGIN_GUARD_PATHS = new Set([
  '/api/auth/unlink-account',
  '/api/auth/passkey/delete-passkey',
]);

function normalizedPath(request: Request): string {
  return new URL(request.url).pathname.replace(/\/+$/, '') || '/';
}

const OAUTH_CALLBACK_PATHS = new Set([
  '/api/auth/callback/google',
  '/api/auth/callback/github',
]);

const OAUTH_STATE_COOKIE_NAME = '__Secure-astera.state';

const OAUTH_CALLBACK_EXCEPTION_ALLOWLIST = new Set([
  'state_not_found',
  'state_mismatch',
  'state_security_mismatch',
  'state_invalid',
  'state_generation_error',
  'invalid_callback_request',
  'no_code',
]);

function isOAuthCallbackPath(pathname: string): boolean {
  return OAUTH_CALLBACK_PATHS.has(pathname);
}

function oauthStateCookiePresent(cookieHeader: string): boolean {
  if (cookieHeader.length === 0) return false;
  for (const segment of cookieHeader.split(';')) {
    const name = segment.trim().split('=')[0]?.trim() ?? '';
    if (name === OAUTH_STATE_COOKIE_NAME) return true;
  }
  return false;
}

function resolveOAuthCallbackException(error: unknown): string {
  const candidates: string[] = [];
  if (error instanceof Error) {
    candidates.push(error.message);
  }
  if (error && typeof error === 'object') {
    const rec = error as Record<string, unknown>;
    if (typeof rec.code === 'string') candidates.push(rec.code);
    const body = rec.body;
    if (body && typeof body === 'object') {
      const bodyCode = (body as Record<string, unknown>).code;
      if (typeof bodyCode === 'string') candidates.push(bodyCode);
    }
  }
  for (const candidate of candidates) {
    if (OAUTH_CALLBACK_EXCEPTION_ALLOWLIST.has(candidate)) return candidate;
  }
  return 'UNKNOWN';
}

function locationDiagFields(response: Response, requestUrl: string): { location_pathname: string | null; location_error: string | null } {
  const location = response.headers.get('location');
  if (!location) return { location_pathname: null, location_error: null };
  try {
    const locUrl = new URL(location, requestUrl);
    return {
      location_pathname: locUrl.pathname,
      location_error: locUrl.searchParams.get('error'),
    };
  } catch {
    return { location_pathname: null, location_error: null };
  }
}

function logOAuthCallbackDiag(
  request: Request,
  pathname: string,
  phase: 'before' | 'after' | 'exception',
  response?: Response,
  callbackException?: string,
): void {
  const url = new URL(request.url);
  const providerError = url.searchParams.get('error');
  const cookieHeader = request.headers.get('cookie') ?? '';
  const payload: Record<string, unknown> = {
    phase,
    pathname,
    method: request.method,
    has_code: url.searchParams.has('code'),
    has_state: url.searchParams.has('state'),
    has_provider_error: providerError !== null,
    provider_error: providerError,
    cookie_present: cookieHeader.length > 0,
    oauth_state_cookie_present: oauthStateCookiePresent(cookieHeader),
  };
  if (phase === 'after' && response) {
    payload.response_status = response.status;
    Object.assign(payload, locationDiagFields(response, request.url));
  }
  if (phase === 'exception') {
    payload.callback_exception = callbackException ?? 'UNKNOWN';
  }
  console.log(`ASTERA_OAUTH_CALLBACK_DIAG ${JSON.stringify(payload)}`);
}

function freshError(status: number, code: string, message: string, correlationId: string): Response {
  return Response.json({
    error: {
      code,
      message,
      correlation_id: correlationId,
      retryable: false,
      details: { max_age_seconds: FRESH_SESSION_MAX_AGE_MS / 1000 },
    },
  }, { status, headers: { 'Cache-Control': 'no-store', 'X-Correlation-ID': correlationId } });
}

function sessionAgeMs(session: SessionSnapshot['session']): number {
  const raw = session?.createdAt;
  const createdAt = raw instanceof Date ? raw.getTime() : typeof raw === 'string' ? Date.parse(raw) : Number.NaN;
  return Date.now() - createdAt;
}

async function enforceFreshSession(
  request: Request,
  auth: ReturnType<typeof createAuth>,
  correlationId: string,
): Promise<Response | null> {
  const pathname = normalizedPath(request);
  const conditionalEnrollmentVerification = pathname === '/api/auth/two-factor/verify-totp';
  if (!FRESH_MANAGEMENT_PATHS.has(pathname) && !conditionalEnrollmentVerification) return null;

  const session = await auth.api.getSession({ headers: request.headers }) as SessionSnapshot | null;
  if (!session?.session) {
    if (conditionalEnrollmentVerification) return null;
    return freshError(401, 'SESSION_REQUIRED', 'この操作にはLoginが必要です。', correlationId);
  }

  const ageMs = sessionAgeMs(session.session);
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > FRESH_SESSION_MAX_AGE_MS) {
    return freshError(403, 'FRESH_SESSION_REQUIRED', 'この操作には15分以内に開始されたFresh Sessionが必要です。再認証してください。', correlationId);
  }
  return null;
}

function mergeSetCookieHeaders(requestHeaders: Headers, response: Response): Headers {
  const merged = new Headers(requestHeaders);
  const existing = merged.get('cookie') ?? '';
  const setCookies = response.headers.getSetCookie?.() ?? [];
  if (setCookies.length === 0) {
    const single = response.headers.get('set-cookie');
    if (single) setCookies.push(single);
  }
  const pairs = setCookies.map((entry) => entry.split(';')[0]).filter(Boolean);
  if (pairs.length > 0) {
    merged.set('cookie', [existing, ...pairs].filter(Boolean).join('; '));
  }
  return merged;
}

async function enforceLastLoginMethodGuard(
  request: Request,
  env: NativeExchangeEnv,
  auth: ReturnType<typeof createAuth>,
  correlationId: string,
): Promise<Response | null> {
  const pathname = normalizedPath(request);
  if (!LAST_LOGIN_GUARD_PATHS.has(pathname) || request.method !== 'POST') return null;
  const session = await auth.api.getSession({ headers: request.headers }) as SessionSnapshot | null;
  const userId = session?.user?.id;
  if (!userId) {
    return freshError(401, 'SESSION_REQUIRED', 'この操作にはLoginが必要です。', correlationId);
  }
  const counts = await countLoginMethods(env.ASTERA_DB, userId);
  if (blocksLastLoginMethodRemoval(counts)) {
    return Response.json({
      error: {
        code: 'LAST_LOGIN_METHOD_REQUIRED',
        message: '最後のLogin手段は削除または解除できません。',
        correlation_id: correlationId,
        retryable: false,
      },
    }, { status: 409, headers: { 'Cache-Control': 'no-store', 'X-Correlation-ID': correlationId } });
  }
  return null;
}

async function recordAuthSecurityEvent(
  request: Request,
  env: NativeExchangeEnv,
  response: Response,
  pathname: string,
  correlationId: string,
  sessionBefore: SessionSnapshot | null,
): Promise<void> {
  if (response.status < 200 || response.status >= 300) return;
  const eventType = securityEventTypeForAuthPath(pathname, request.method);
  if (!eventType) return;

  const auth = createAuth(env);
  let session = sessionBefore;
  if (eventType !== 'sign_out') {
    const headers = mergeSetCookieHeaders(request.headers, response);
    session = await auth.api.getSession({ headers }) as SessionSnapshot | null;
  }
  const userId = session?.user?.id ?? sessionBefore?.user?.id;
  if (!userId) return;

  const metadata = await parseJsonBodyMetadata(request);
  if (session?.session?.id) metadata.session_id = session.session.id;

  await insertSecurityEvent({
    db: env.ASTERA_DB,
    userId,
    tenantId: tenantIdForUser(userId),
    eventType,
    correlationId,
    headers: request.headers,
    metadata,
  });
}

export async function onRequest(context: PagesContext): Promise<Response> {
  const correlationId = context.request.headers.get('X-Request-ID') || crypto.randomUUID();
  try {
    const nativeResponse = await handleNativeAuthRoutes(context.request, context.env, correlationId);
    if (nativeResponse) return nativeResponse;
    const auth = createAuth(context.env);
    const pathname = normalizedPath(context.request);
    const sessionBefore = await auth.api.getSession({ headers: context.request.headers }) as SessionSnapshot | null;

    const lastLoginGuard = await enforceLastLoginMethodGuard(context.request, context.env, auth, correlationId);
    if (lastLoginGuard) return lastLoginGuard;

    const freshnessFailure = await enforceFreshSession(context.request, auth, correlationId);
    if (freshnessFailure) return freshnessFailure;

    if (isOAuthCallbackPath(pathname)) {
      logOAuthCallbackDiag(context.request, pathname, 'before');
    }
    let response: Response;
    try {
      if (pathname === '/api/auth/set-password' && context.request.method === 'POST') {
        response = await auth.api.setPassword({
          headers: context.request.headers,
          request: context.request,
          asResponse: true,
        }) as Response;
      } else {
        response = await auth.handler(context.request);
      }
    } catch (handlerError) {
      if (isOAuthCallbackPath(pathname)) {
        logOAuthCallbackDiag(
          context.request,
          pathname,
          'exception',
          undefined,
          resolveOAuthCallbackException(handlerError),
        );
      }
      throw handlerError;
    }
    if (isOAuthCallbackPath(pathname)) {
      logOAuthCallbackDiag(context.request, pathname, 'after', response);
    }
    if (
      pathname === '/api/auth/set-password'
      && response.status >= 200
      && response.status < 300
    ) {
      const sessionHeaders = mergeSetCookieHeaders(context.request.headers, response);
      await refreshAccountProjectionForSession(context.request, context.env, sessionHeaders);
    }
    await recordAuthSecurityEvent(context.request, context.env, response, pathname, correlationId, sessionBefore);
    return response;
  } catch (error) {
    return Response.json({
      error: {
        code: error instanceof Error ? error.message : 'AUTH_RUNTIME_CONFIGURATION_ERROR',
        message: '認証Runtimeを開始できません。',
        correlation_id: correlationId,
        retryable: false,
      },
    }, { status: 503, headers: { 'Cache-Control': 'no-store', 'X-Correlation-ID': correlationId } });
  }
}
