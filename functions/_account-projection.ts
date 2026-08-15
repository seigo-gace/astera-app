import { createAuth, type AuthEnv } from './_auth';

export type D1Result<T> = { results?: T[]; success?: boolean; error?: string; meta?: Record<string, unknown> };
export type D1PreparedStatement = {
  bind: (...values: unknown[]) => D1PreparedStatement;
  first: <T = Record<string, unknown>>() => Promise<T | null>;
  all: <T = Record<string, unknown>>() => Promise<D1Result<T>>;
  run: () => Promise<D1Result<Record<string, unknown>>>;
};
export type D1Database = {
  prepare: (query: string) => D1PreparedStatement;
  batch: (statements: D1PreparedStatement[]) => Promise<Array<D1Result<Record<string, unknown>>>>;
};

export type AsteraFunctionEnv = AuthEnv & { ASTERA_DB: D1Database };

export type SessionUser = {
  id: string;
  email: string;
  name?: string | null;
  emailVerified?: boolean;
  image?: string | null;
  twoFactorEnabled?: boolean;
};

export type SessionPayload = {
  user?: SessionUser;
  session?: {
    id?: string;
    expiresAt?: Date | string;
    createdAt?: Date | string;
    updatedAt?: Date | string;
  };
};

export type UserProfileRow = {
  user_id: string;
  tenant_id: string;
  nickname: string;
  account_status: string;
  ui_language: string;
  created_at: string;
  updated_at: string;
};

export type CreditRow = {
  id: string;
  tenant_id: string;
  available_balance: number;
  reserved_balance: number;
  version: number;
  updated_at: string;
};

export type AsteraActorProjection = {
  user: SessionUser;
  session: SessionPayload['session'];
  profile: UserProfileRow;
  credit: CreditRow;
};

export class FunctionHttpError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'FunctionHttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const FRESH_SESSION_MAX_AGE_MS = 15 * 60 * 1000;

function desiredAccountStatus(user: SessionUser, credentialAccountExists: boolean): string {
  if (user.emailVerified === false) return 'pending_email_verification';
  if (!credentialAccountExists) return 'pending_password_setup';
  return 'active';
}

async function hasCredentialAccount(db: D1Database, userId: string): Promise<boolean> {
  const row = await db.prepare(
    'SELECT id FROM "account" WHERE "userId" = ?1 AND "providerId" = ?2 LIMIT 1',
  ).bind(userId, 'credential').first<{ id: string }>();
  return Boolean(row?.id);
}

async function ensureProjection(db: D1Database, user: SessionUser): Promise<{ profile: UserProfileRow; credit: CreditRow }> {
  const now = new Date().toISOString();
  const tenantId = `personal:${user.id}`;
  const creditId = `credit:${tenantId}`;
  const accountStatus = desiredAccountStatus(user, await hasCredentialAccount(db, user.id));
  const nickname = user.name?.trim() || user.email.split('@')[0] || 'Astera User';

  await db.batch([
    db.prepare(
      `INSERT INTO tenants (id, kind, display_name, created_at, updated_at)
       VALUES (?1, 'personal', ?2, ?3, ?3)
       ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name, updated_at = excluded.updated_at`,
    ).bind(tenantId, nickname, now),
    db.prepare(
      `INSERT INTO user_profiles (user_id, tenant_id, nickname, account_status, ui_language, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, 'ja-JP', ?5, ?5)
       ON CONFLICT(user_id) DO UPDATE SET
         tenant_id = excluded.tenant_id,
         nickname = CASE WHEN user_profiles.nickname = '' THEN excluded.nickname ELSE user_profiles.nickname END,
         account_status = CASE
           WHEN user_profiles.account_status IN ('security_hold', 'suspended', 'deletion_scheduled', 'deleted') THEN user_profiles.account_status
           ELSE excluded.account_status
         END,
         updated_at = excluded.updated_at`,
    ).bind(user.id, tenantId, nickname, accountStatus, now),
    db.prepare(
      `INSERT INTO credit_accounts (id, tenant_id, available_balance, reserved_balance, version, updated_at)
       VALUES (?1, ?2, 0, 0, 0, ?3)
       ON CONFLICT(tenant_id) DO NOTHING`,
    ).bind(creditId, tenantId, now),
  ]);

  const profile = await db.prepare(
    `SELECT user_id, tenant_id, nickname, account_status, ui_language, created_at, updated_at
     FROM user_profiles WHERE user_id = ?1 LIMIT 1`,
  ).bind(user.id).first<UserProfileRow>();
  const credit = await db.prepare(
    `SELECT id, tenant_id, available_balance, reserved_balance, version, updated_at
     FROM credit_accounts WHERE tenant_id = ?1 LIMIT 1`,
  ).bind(tenantId).first<CreditRow>();

  if (!profile || !credit) throw new FunctionHttpError(503, 'ASTERA_ACCOUNT_SCHEMA_NOT_READY', 'Account／Credit Projectionを作成できませんでした。');
  return { profile, credit };
}

export async function requireAsteraActor(request: Request, env: AsteraFunctionEnv): Promise<AsteraActorProjection> {
  let session: SessionPayload | null;
  try {
    session = await createAuth(env).api.getSession({ headers: request.headers }) as SessionPayload | null;
  } catch (error) {
    throw new FunctionHttpError(503, 'AUTH_RUNTIME_UNAVAILABLE', '認証Runtimeを利用できません。', error instanceof Error ? error.message : String(error));
  }
  const user = session?.user;
  if (!user?.id || !user.email) throw new FunctionHttpError(401, 'SESSION_REQUIRED', 'Loginが必要です。');

  try {
    const { profile, credit } = await ensureProjection(env.ASTERA_DB, user);
    if (profile.account_status !== 'active') {
      throw new FunctionHttpError(403, `ACCOUNT_${profile.account_status.toUpperCase()}`, 'Accountの現在状態ではこの操作を実行できません。');
    }
    return { user, session: session?.session, profile, credit };
  } catch (error) {
    if (error instanceof FunctionHttpError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    if (/no such table|D1_ERROR/i.test(message)) {
      throw new FunctionHttpError(503, 'ASTERA_ACCOUNT_SCHEMA_NOT_READY', '認証・Account・Credit用D1 Migrationが適用されていません。', message);
    }
    throw new FunctionHttpError(500, 'ACCOUNT_SESSION_PROJECTION_FAILED', 'Account状態を取得できませんでした。', message);
  }
}

export async function requireFreshAsteraActor(request: Request, env: AsteraFunctionEnv): Promise<AsteraActorProjection> {
  const actor = await requireAsteraActor(request, env);
  const rawCreatedAt = actor.session?.createdAt;
  const createdAtMs = rawCreatedAt instanceof Date
    ? rawCreatedAt.getTime()
    : typeof rawCreatedAt === 'string'
      ? Date.parse(rawCreatedAt)
      : Number.NaN;
  const ageMs = Date.now() - createdAtMs;
  if (!Number.isFinite(createdAtMs) || ageMs < 0 || ageMs > FRESH_SESSION_MAX_AGE_MS) {
    throw new FunctionHttpError(
      403,
      'FRESH_SESSION_REQUIRED',
      'この操作には15分以内に開始されたFresh Sessionが必要です。再認証してください。',
      { max_age_seconds: FRESH_SESSION_MAX_AGE_MS / 1000 },
    );
  }
  return actor;
}

export function requestCorrelationId(request: Request): string {
  return request.headers.get('X-Request-ID')?.trim() || crypto.randomUUID();
}

export function functionErrorResponse(error: unknown, requestId: string): Response {
  const normalized = error instanceof FunctionHttpError
    ? error
    : new FunctionHttpError(500, 'INTERNAL_SERVER_ERROR', '処理を完了できませんでした。', error instanceof Error ? error.message : String(error));
  return Response.json({
    error: {
      code: normalized.code,
      message: normalized.message,
      correlation_id: requestId,
      retryable: normalized.status >= 500,
      details: normalized.details,
    },
  }, {
    status: normalized.status,
    headers: { 'Cache-Control': 'no-store', 'X-Correlation-ID': requestId },
  });
}
