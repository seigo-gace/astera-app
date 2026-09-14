type D1PreparedStatement = {
  bind: (...values: unknown[]) => D1PreparedStatement;
  run: () => Promise<{ success?: boolean }>;
};

type D1Database = {
  prepare: (query: string) => D1PreparedStatement;
};

export const SECURITY_EVENT_TYPES = [
  'sign_in_email',
  'sign_in_passkey',
  'sign_in_oauth',
  'sign_in_native_exchange',
  'sign_out',
  'password_change',
  'password_setup',
  '2fa_enable',
  '2fa_disable',
  '2fa_verify',
  'passkey_add',
  'passkey_delete',
  'session_revoke',
  'session_revoke_others',
  'session_revoke_all',
  'oauth_link',
  'oauth_unlink',
  'exchange_rejected',
] as const;

export type SecurityEventType = typeof SECURITY_EVENT_TYPES[number];

const METADATA_KEY_ALLOWLIST = new Set([
  'provider',
  'provider_id',
  'method',
  'session_id',
  'passkey_id',
  'account_id',
  'reason',
  'return_to',
]);

const METADATA_KEY_DENYLIST = /password|token|secret|credential|backup/i;

export function clientIpFromHeaders(headers: Headers): string | null {
  const cf = headers.get('CF-Connecting-IP')?.trim();
  if (cf) return cf.slice(0, 128);
  const forwarded = headers.get('X-Forwarded-For')?.split(',')[0]?.trim();
  if (forwarded) return forwarded.slice(0, 128);
  const realIp = headers.get('X-Real-IP')?.trim();
  if (realIp) return realIp.slice(0, 128);
  return null;
}

export function sanitizeSecurityEventMetadata(input: Record<string, unknown> | null | undefined): Record<string, string> {
  if (!input || typeof input !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(input)) {
    if (!METADATA_KEY_ALLOWLIST.has(key) || METADATA_KEY_DENYLIST.test(key)) continue;
    if (raw === null || raw === undefined) continue;
    const value = typeof raw === 'string' ? raw.trim() : String(raw);
    if (!value) continue;
    out[key] = value.slice(0, 512);
  }
  return out;
}

export type InsertSecurityEventInput = {
  db: D1Database;
  userId: string;
  tenantId: string;
  eventType: SecurityEventType;
  correlationId: string;
  headers: Headers;
  metadata?: Record<string, unknown>;
};

export async function insertSecurityEvent(input: InsertSecurityEventInput): Promise<void> {
  try {
    const metadata = sanitizeSecurityEventMetadata(input.metadata);
    const actorIp = clientIpFromHeaders(input.headers);
    const userAgent = input.headers.get('User-Agent')?.slice(0, 512) ?? null;
    await input.db.prepare(
      `INSERT INTO account_security_events
        (id, user_id, tenant_id, event_type, actor_ip, user_agent, correlation_id, metadata_json, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
    ).bind(
      crypto.randomUUID(),
      input.userId,
      input.tenantId,
      input.eventType,
      actorIp,
      userAgent,
      input.correlationId,
      JSON.stringify(metadata),
      new Date().toISOString(),
    ).run();
  } catch {
    // Audit failure must not block authentication flows.
  }
}

export type LoginMethodCounts = {
  credential: boolean;
  oauth: number;
  passkeys: number;
  total: number;
};

export async function countLoginMethods(db: D1Database, userId: string): Promise<LoginMethodCounts> {
  const [credentialRow, oauthRow, passkeyRow] = await Promise.all([
    db.prepare(
      `SELECT id FROM "account" WHERE "userId" = ?1 AND "providerId" = ?2 LIMIT 1`,
    ).bind(userId, 'credential').first<{ id: string }>(),
    db.prepare(
      `SELECT COUNT(*) AS count FROM "account" WHERE "userId" = ?1 AND "providerId" != ?2`,
    ).bind(userId, 'credential').first<{ count: number }>(),
    db.prepare(
      `SELECT COUNT(*) AS count FROM passkey WHERE "userId" = ?1`,
    ).bind(userId).first<{ count: number }>(),
  ]);
  const credential = Boolean(credentialRow?.id);
  const oauth = Number(oauthRow?.count ?? 0);
  const passkeys = Number(passkeyRow?.count ?? 0);
  return {
    credential,
    oauth,
    passkeys,
    total: (credential ? 1 : 0) + oauth + passkeys,
  };
}

export function tenantIdForUser(userId: string): string {
  return `personal:${userId}`;
}

const AUTH_PATH_EVENT_MAP: Record<string, SecurityEventType> = {
  '/api/auth/sign-in/email': 'sign_in_email',
  '/api/auth/sign-in/passkey': 'sign_in_passkey',
  '/api/auth/sign-in/social': 'sign_in_oauth',
  '/api/auth/sign-out': 'sign_out',
  '/api/auth/change-password': 'password_change',
  '/api/auth/set-password': 'password_setup',
  '/api/auth/two-factor/enable': '2fa_enable',
  '/api/auth/two-factor/disable': '2fa_disable',
  '/api/auth/two-factor/verify-totp': '2fa_verify',
  '/api/auth/passkey/add-passkey': 'passkey_add',
  '/api/auth/passkey/delete-passkey': 'passkey_delete',
  '/api/auth/revoke-session': 'session_revoke',
  '/api/auth/revoke-other-sessions': 'session_revoke_others',
  '/api/auth/revoke-sessions': 'session_revoke_all',
  '/api/auth/link-social': 'oauth_link',
  '/api/auth/unlink-account': 'oauth_unlink',
};

export function securityEventTypeForAuthPath(pathname: string, method: string): SecurityEventType | null {
  if (method !== 'POST' && pathname !== '/api/auth/sign-out') return null;
  if (pathname.startsWith('/api/auth/callback/')) return 'sign_in_oauth';
  return AUTH_PATH_EVENT_MAP[pathname] ?? null;
}

export async function parseJsonBodyMetadata(request: Request): Promise<Record<string, unknown>> {
  if (request.method !== 'POST') return {};
  try {
    const clone = request.clone();
    const body = await clone.json() as Record<string, unknown>;
    return {
      provider: body.provider ?? body.providerId,
      provider_id: body.providerId ?? body.provider_id,
      passkey_id: body.id,
      session_id: body.sessionId ?? body.session_id,
      account_id: body.accountId ?? body.account_id,
    };
  } catch {
    return {};
  }
}
