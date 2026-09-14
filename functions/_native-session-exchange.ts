import { makeSignature } from 'better-auth/crypto';
import { createAuth, type AuthEnv } from './_auth';
import { consumeExchangeRecord, insertExchangeRecord, safeReturnPath } from './_native-exchange-util';
import { insertSecurityEvent, tenantIdForUser } from './_security-events';

export { consumeExchangeRecord, safeReturnPath } from './_native-exchange-util';

type D1PreparedStatement = {
  bind: (...values: unknown[]) => D1PreparedStatement;
  first: <T = Record<string, unknown>>() => Promise<T | null>;
  run: () => Promise<{ success?: boolean; meta?: { changes?: number } }>;
};

type D1Database = {
  prepare: (query: string) => D1PreparedStatement;
};

export type NativeExchangeEnv = AuthEnv & { ASTERA_DB: D1Database };

const NATIVE_LOGIN_SCHEME = 'jp.asterav8.app://open/login';
const SESSION_COOKIE_BASE = 'astera.session_token';
const SECURE_COOKIE_PREFIX = '__Secure-';
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

type SessionUser = {
  id: string;
  email: string;
  name?: string | null;
  emailVerified?: boolean;
  twoFactorEnabled?: boolean;
};

type SessionPayload = {
  user?: SessionUser;
  session?: { id?: string; expiresAt?: Date | string };
};

function required(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name}_NOT_CONFIGURED`);
  return normalized;
}

function correlationHeaders(correlationId: string): HeadersInit {
  return { 'Cache-Control': 'no-store', 'X-Correlation-ID': correlationId };
}

function jsonError(status: number, code: string, message: string, correlationId: string): Response {
  return Response.json({
    error: { code, message, correlation_id: correlationId, retryable: false },
  }, { status, headers: correlationHeaders(correlationId) });
}

function sessionCookieName(): string {
  return `${SECURE_COOKIE_PREFIX}${SESSION_COOKIE_BASE}`;
}

async function signSessionCookieValue(sessionToken: string, secret: string): Promise<string> {
  return `${sessionToken}.${await makeSignature(sessionToken, secret)}`;
}

async function buildSessionSetCookie(sessionToken: string, secret: string): Promise<string> {
  const signed = await signSessionCookieValue(sessionToken, secret);
  return `${sessionCookieName()}=${signed}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SECONDS}`;
}

async function credentialAccountExists(db: D1Database, userId: string): Promise<boolean> {
  const row = await db.prepare(
    `SELECT "id" FROM "account" WHERE "userId" = ?1 AND "providerId" = ?2 LIMIT 1`,
  ).bind(userId, 'credential').first<{ id: string }>();
  return Boolean(row?.id);
}

function accountStatus(user: SessionUser, hasCredential: boolean): string {
  if (user.emailVerified === false) return 'pending_email_verification';
  if (!hasCredential) return 'pending_password_setup';
  return 'active';
}

async function sessionRowById(db: D1Database, sessionId: string): Promise<{ token: string; expiresAt: number } | null> {
  const row = await db.prepare(
    `SELECT "token", "expiresAt" FROM "session" WHERE "id" = ?1 LIMIT 1`,
  ).bind(sessionId).first<{ token: string; expiresAt: number }>();
  if (!row?.token || Number(row.expiresAt) <= Date.now()) return null;
  return row;
}

function hasTwoFactorCookie(headers: Headers): boolean {
  const cookie = headers.get('cookie') ?? '';
  return /(?:^|;\s*)(?:__Secure-)?astera\.two_factor=/.test(cookie);
}

async function hasPendingTwoFactorChallenge(db: D1Database, userId: string): Promise<boolean> {
  const now = Date.now();
  const row = await db.prepare(
    `SELECT "id" FROM "verification"
     WHERE "value" = ?1 AND "identifier" LIKE '2fa-%' AND "identifier" NOT LIKE '2fa-attempts-%' AND "expiresAt" > ?2
     LIMIT 1`,
  ).bind(userId, now).first<{ id: string }>();
  return Boolean(row?.id);
}

async function buildContinuationPayload(
  env: NativeExchangeEnv,
  requestHeaders: Headers,
  sessionToken: string,
): Promise<Record<string, unknown>> {
  const secret = required(env.BETTER_AUTH_SECRET, 'BETTER_AUTH_SECRET');
  const cookieValue = await signSessionCookieValue(sessionToken, secret);
  const headers = new Headers(requestHeaders);
  headers.set('cookie', `${sessionCookieName()}=${cookieValue}`);
  const auth = createAuth(env);
  const sessionPayload = await auth.api.getSession({ headers }) as SessionPayload | null;
  const user = sessionPayload?.user;
  if (!user?.id || !user.email) {
    throw new Error('NATIVE_EXCHANGE_SESSION_INVALID');
  }
  const hasCredential = await credentialAccountExists(env.ASTERA_DB, user.id);
  const status = accountStatus(user, hasCredential);
  const emailVerified = user.emailVerified !== false;
  const requiresPasswordSetup = status === 'pending_password_setup';
  const twoFactorEnabled = user.twoFactorEnabled === true;
  const pendingTwoFactor = twoFactorEnabled && (hasTwoFactorCookie(requestHeaders) || await hasPendingTwoFactorChallenge(env.ASTERA_DB, user.id));
  const authStage = pendingTwoFactor ? 'pending_2fa' : (status === 'active' ? 'authenticated' : status);
  return {
    user: {
      id: user.id,
      email: user.email,
      emailVerified,
      name: user.name ?? null,
      twoFactorEnabled,
    },
    account: {
      account_status: status,
      email: user.email,
      email_verified: emailVerified,
    },
    emailVerified,
    requires_password_setup: requiresPasswordSetup,
    twoFactorRedirect: pendingTwoFactor,
    auth_stage: authStage,
  };
}

function nativeLoginRedirect(exchangeToken: string, returnTo: string): string {
  const url = new URL(NATIVE_LOGIN_SCHEME);
  url.searchParams.set('exchange', exchangeToken);
  if (returnTo) url.searchParams.set('return_to', returnTo);
  return url.toString();
}

function normalizedAuthPath(request: Request): string {
  return new URL(request.url).pathname.replace(/\/+$/, '') || '/';
}

export async function handleNativeAuthRoutes(
  request: Request,
  env: NativeExchangeEnv,
  correlationId: string,
): Promise<Response | null> {
  const path = normalizedAuthPath(request);
  if (path === '/api/auth/native/session-exchange' && request.method === 'POST') {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError(401, 'EXCHANGE_TOKEN_INVALID', 'Exchange Tokenを確認できませんでした。', correlationId);
    }
    const exchangeToken = typeof (body as { exchange_token?: unknown })?.exchange_token === 'string'
      ? (body as { exchange_token: string }).exchange_token
      : '';
    const sessionToken = await consumeExchangeRecord(env.ASTERA_DB, exchangeToken);
    if (!sessionToken) {
      await insertSecurityEvent({
        db: env.ASTERA_DB,
        userId: 'anonymous',
        tenantId: 'anonymous',
        eventType: 'exchange_rejected',
        correlationId,
        headers: request.headers,
        metadata: { reason: 'exchange_token_invalid_or_consumed' },
      });
      return jsonError(403, 'EXCHANGE_TOKEN_REJECTED', 'Exchange Tokenは無効、期限切れ、または既に使用済みです。', correlationId);
    }
    try {
      const secret = required(env.BETTER_AUTH_SECRET, 'BETTER_AUTH_SECRET');
      const payload = await buildContinuationPayload(env, request.headers, sessionToken);
      const userId = recordTextUserId(payload);
      if (userId) {
        await insertSecurityEvent({
          db: env.ASTERA_DB,
          userId,
          tenantId: tenantIdForUser(userId),
          eventType: 'sign_in_native_exchange',
          correlationId,
          headers: request.headers,
        });
      }
      const setCookie = await buildSessionSetCookie(sessionToken, secret);
      return Response.json({ data: payload, ...payload }, {
        headers: {
          ...correlationHeaders(correlationId),
          'Set-Cookie': setCookie,
        },
      });
    } catch {
      return jsonError(401, 'EXCHANGE_SESSION_INVALID', 'Exchange後のSessionを確立できませんでした。', correlationId);
    }
  }

  if (path === '/api/auth/native/oauth-complete' && (request.method === 'GET' || request.method === 'POST')) {
    let auth: ReturnType<typeof createAuth>;
    try {
      auth = createAuth(env);
    } catch {
      return jsonError(503, 'AUTH_RUNTIME_CONFIGURATION_ERROR', '認証Runtimeを開始できません。', correlationId);
    }
    const sessionPayload = await auth.api.getSession({ headers: request.headers }) as SessionPayload | null;
    const sessionId = sessionPayload?.session?.id;
    if (!sessionId) {
      return jsonError(401, 'SESSION_REQUIRED', 'Loginが必要です。', correlationId);
    }
    const sessionRow = await sessionRowById(env.ASTERA_DB, sessionId);
    if (!sessionRow) {
      return jsonError(401, 'SESSION_REQUIRED', 'Loginが必要です。', correlationId);
    }
    try {
      const rawExchange = await insertExchangeRecord(env.ASTERA_DB, sessionRow.token);
      const requestUrl = new URL(request.url);
      const returnTo = safeReturnPath(requestUrl.searchParams.get('return_to'), requestUrl.origin);
      return new Response(null, {
        status: 302,
        headers: {
          ...correlationHeaders(correlationId),
          Location: nativeLoginRedirect(rawExchange, returnTo),
        },
      });
    } catch {
      return jsonError(503, 'NATIVE_EXCHANGE_ISSUE_FAILED', 'Native Exchange Tokenを発行できませんでした。', correlationId);
    }
  }

  return null;
}

function recordTextUserId(payload: Record<string, unknown>): string | null {
  const user = payload.user;
  if (!user || typeof user !== 'object') return null;
  const id = (user as Record<string, unknown>).id;
  return typeof id === 'string' && id.trim() ? id.trim() : null;
}
