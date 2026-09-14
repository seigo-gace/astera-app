import { makeSignature } from 'better-auth/crypto';
import { matchCanonicalRoute } from '../src/platform/route-registry';
import { createAuth, type AuthEnv } from './_auth';

type D1PreparedStatement = {
  bind: (...values: unknown[]) => D1PreparedStatement;
  first: <T = Record<string, unknown>>() => Promise<T | null>;
  run: () => Promise<{ success?: boolean; meta?: { changes?: number } }>;
};

type D1Database = {
  prepare: (query: string) => D1PreparedStatement;
};

export type NativeExchangeEnv = AuthEnv & { ASTERA_DB: D1Database };

const EXCHANGE_TTL_MS = 90_000;
const EXCHANGE_IDENTIFIER_PREFIX = 'astera-native-exchange:';
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

function safeReturnPath(rawValue: string | null | undefined, origin: string, fallback = '/app/new'): string {
  if (!rawValue) return fallback;
  try {
    const candidate = rawValue.startsWith('/') ? rawValue : decodeURIComponent(rawValue);
    if (!candidate.startsWith('/') || candidate.startsWith('//') || candidate.includes('\\') || /[\u0000-\u001f\u007f]/.test(candidate)) return fallback;
    const url = new URL(candidate, origin);
    if (url.origin !== new URL(origin).origin) return fallback;
    const route = matchCanonicalRoute(url.pathname);
    if (route.group === 'auth') return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}

function jsonError(status: number, code: string, message: string, correlationId: string): Response {
  return Response.json({
    error: { code, message, correlation_id: correlationId, retryable: false },
  }, { status, headers: correlationHeaders(correlationId) });
}

async function sha256Hex(raw: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
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

function exchangeIdentifier(rawToken: string): Promise<string> {
  return sha256Hex(rawToken.trim()).then((hash) => `${EXCHANGE_IDENTIFIER_PREFIX}${hash}`);
}

async function insertExchangeRecord(db: D1Database, sessionToken: string): Promise<string> {
  const raw = `${crypto.randomUUID().replace(/-/g, '')}${crypto.randomUUID().replace(/-/g, '')}`;
  const identifier = await exchangeIdentifier(raw);
  const now = Date.now();
  await db.prepare(
    `INSERT INTO "verification" ("id", "identifier", "value", "expiresAt", "createdAt", "updatedAt")
     VALUES (?1, ?2, ?3, ?4, ?5, ?5)`,
  ).bind(crypto.randomUUID(), identifier, sessionToken, now + EXCHANGE_TTL_MS, now).run();
  return raw;
}

async function consumeExchangeRecord(db: D1Database, rawToken: string): Promise<string | null> {
  const trimmed = rawToken.trim();
  if (!trimmed) return null;
  const identifier = await exchangeIdentifier(trimmed);
  const now = Date.now();
  const row = await db.prepare(
    `SELECT "id", "value", "expiresAt" FROM "verification" WHERE "identifier" = ?1 LIMIT 1`,
  ).bind(identifier).first<{ id: string; value: string; expiresAt: number }>();
  if (!row?.id || !row.value) return null;
  if (Number(row.expiresAt) <= now) {
    await db.prepare(
      `DELETE FROM "verification" WHERE "id" = ?1 AND "identifier" = ?2`,
    ).bind(row.id, identifier).run();
    return null;
  }
  const deleted = await db.prepare(
    `DELETE FROM "verification" WHERE "id" = ?1 AND "identifier" = ?2 AND "value" = ?3 AND "expiresAt" = ?4`,
  ).bind(row.id, identifier, row.value, row.expiresAt).run();
  if (!deleted.success || (deleted.meta?.changes ?? 0) < 1) return null;
  return row.value;
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
  return {
    user: {
      id: user.id,
      email: user.email,
      emailVerified,
      name: user.name ?? null,
      twoFactorEnabled: user.twoFactorEnabled === true,
    },
    account: {
      account_status: status,
      email: user.email,
      email_verified: emailVerified,
    },
    emailVerified,
    requires_password_setup: requiresPasswordSetup,
    twoFactorRedirect: false,
    auth_stage: status === 'active' ? 'authenticated' : status,
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
      return jsonError(403, 'EXCHANGE_TOKEN_REJECTED', 'Exchange Tokenは無効、期限切れ、または既に使用済みです。', correlationId);
    }
    try {
      const secret = required(env.BETTER_AUTH_SECRET, 'BETTER_AUTH_SECRET');
      const payload = await buildContinuationPayload(env, request.headers, sessionToken);
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
