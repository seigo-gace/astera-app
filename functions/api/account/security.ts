import {
  FunctionHttpError,
  functionErrorResponse,
  requestCorrelationId,
  requireAsteraActor,
  type AsteraFunctionEnv,
} from '../../_account-projection';

type Context = { request: Request; env: AsteraFunctionEnv };

type CredentialRow = { id: string; password: string | null; updatedAt: number | string };
type PasskeyRow = {
  id: string;
  name: string | null;
  deviceType: string;
  backedUp: number;
  transports: string | null;
  createdAt: number | string | null;
  aaguid: string | null;
};
type TwoFactorRow = { id: string; verified: number; lockedUntil: number | string | null };
type SessionRow = {
  id: string;
  createdAt: number | string;
  updatedAt: number | string;
  expiresAt: number | string;
  userAgent: string | null;
};

type SessionProjection = {
  id: string;
  current: boolean;
  created_at: string | null;
  updated_at: string | null;
  expires_at: string | null;
  user_agent: string | null;
};

function timeValue(value: number | string | Date | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  const numeric = typeof value === 'number' ? value : Number(value);
  const date = Number.isFinite(numeric)
    ? new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric)
    : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export async function onRequestGet(context: Context): Promise<Response> {
  const correlationId = requestCorrelationId(context.request);
  try {
    const actor = await requireAsteraActor(context.request, context.env);
    const userId = actor.user.id;

    const [credential, passkeysResult, twoFactor, sessionsResult] = await Promise.all([
      context.env.ASTERA_DB.prepare(
        'SELECT id,password,"updatedAt" FROM "account" WHERE "userId"=?1 AND "providerId"=?2 AND password IS NOT NULL AND length(password) > 0 LIMIT 1',
      ).bind(userId, 'credential').first<CredentialRow>(),
      context.env.ASTERA_DB.prepare(
        'SELECT id,name,"deviceType","backedUp",transports,"createdAt",aaguid FROM passkey WHERE "userId"=?1 ORDER BY "createdAt" DESC LIMIT 50',
      ).bind(userId).all<PasskeyRow>(),
      context.env.ASTERA_DB.prepare(
        'SELECT id,verified,"lockedUntil" FROM "twoFactor" WHERE "userId"=?1 LIMIT 1',
      ).bind(userId).first<TwoFactorRow>(),
      context.env.ASTERA_DB.prepare(
        'SELECT id,"createdAt","updatedAt","expiresAt","userAgent" FROM session WHERE "userId"=?1 ORDER BY "updatedAt" DESC LIMIT 50',
      ).bind(userId).all<SessionRow>(),
    ]);

    const passkeys = (passkeysResult.results ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      device_type: row.deviceType,
      backed_up: Boolean(row.backedUp),
      transports: row.transports,
      created_at: timeValue(row.createdAt),
      aaguid: row.aaguid,
    }));

    const currentSessionId = actor.session?.id?.trim() || '';
    const currentUserAgent = context.request.headers.get('User-Agent')?.trim() || null;
    const sessions: SessionProjection[] = (sessionsResult.results ?? []).map((row) => ({
      id: row.id,
      current: Boolean(currentSessionId && row.id === currentSessionId),
      created_at: timeValue(row.createdAt),
      updated_at: timeValue(row.updatedAt),
      expires_at: timeValue(row.expiresAt),
      user_agent: row.userAgent || (currentSessionId && row.id === currentSessionId ? currentUserAgent : null),
    }));

    if (currentSessionId && !sessions.some((session) => session.id === currentSessionId)) {
      sessions.unshift({
        id: currentSessionId,
        current: true,
        created_at: timeValue(actor.session?.createdAt),
        updated_at: timeValue(actor.session?.updatedAt) ?? new Date().toISOString(),
        expires_at: timeValue(actor.session?.expiresAt),
        user_agent: currentUserAgent,
      });
    }

    return Response.json({
      security: {
        password_configured: Boolean(credential?.password),
        password_updated_at: timeValue(credential?.updatedAt),
        passkey_enabled: passkeys.length > 0,
        passkey_count: passkeys.length,
        passkeys,
        two_factor_enabled: Boolean(actor.user.twoFactorEnabled || twoFactor?.verified),
        two_factor_locked_until: timeValue(twoFactor?.lockedUntil),
        session_count: sessions.length,
        sessions,
      },
    }, {
      headers: { 'Cache-Control': 'no-store', 'X-Correlation-ID': correlationId },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/no such table|no such column|D1_ERROR/i.test(message)) {
      return functionErrorResponse(
        new FunctionHttpError(503, 'ACCOUNT_SECURITY_SCHEMA_NOT_READY', 'Account Security用D1 Schemaが適用されていません。'),
        correlationId,
      );
    }
    return functionErrorResponse(error, correlationId);
  }
}

export function onRequest(context: Context): Promise<Response> {
  if (context.request.method === 'GET') return onRequestGet(context);
  return Promise.resolve(Response.json(
    { error: { code: 'METHOD_NOT_ALLOWED', message: 'GETのみ対応しています。' } },
    { status: 405, headers: { Allow: 'GET' } },
  ));
}
