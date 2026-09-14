import {
  FunctionHttpError,
  functionErrorResponse,
  requestCorrelationId,
  requireAsteraActor,
  type AsteraFunctionEnv,
} from '../../_account-projection';

type Context = { request: Request; env: AsteraFunctionEnv };

type CredentialRow = { id: string; updatedAt: number | string };
type PasskeyRow = {
  id: string;
  name: string | null;
  deviceType: string;
  backedUp: number;
  transports: string | null;
  createdAt: number | string | null;
};
type TwoFactorRow = { id: string; verified: number; lockedUntil: number | string | null };
type SessionRow = {
  id: string;
  createdAt: number | string;
  updatedAt: number | string;
  expiresAt: number | string;
  userAgent: string | null;
};

type SecurityEventRow = {
  id: string;
  event_type: string;
  actor_ip: string | null;
  user_agent: string | null;
  correlation_id: string;
  metadata_json: string;
  created_at: string;
};

function timeValue(value: number | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
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

    const tenantId = actor.profile.tenant_id;

    const [credential, passkeysResult, twoFactor, sessionsResult, eventsResult] = await Promise.all([
      context.env.ASTERA_DB.prepare(
        'SELECT id, "updatedAt" FROM "account" WHERE "userId"=?1 AND "providerId"=?2 LIMIT 1',
      ).bind(userId, 'credential').first<CredentialRow>(),
      context.env.ASTERA_DB.prepare(
        'SELECT id,name,"deviceType","backedUp",transports,"createdAt" FROM passkey WHERE "userId"=?1 ORDER BY "createdAt" DESC LIMIT 50',
      ).bind(userId).all<PasskeyRow>(),
      context.env.ASTERA_DB.prepare(
        'SELECT id,verified,"lockedUntil" FROM "twoFactor" WHERE "userId"=?1 LIMIT 1',
      ).bind(userId).first<TwoFactorRow>(),
      context.env.ASTERA_DB.prepare(
        'SELECT id,"createdAt","updatedAt","expiresAt","userAgent" FROM session WHERE "userId"=?1 ORDER BY "updatedAt" DESC LIMIT 50',
      ).bind(userId).all<SessionRow>(),
      context.env.ASTERA_DB.prepare(
        `SELECT id, event_type, actor_ip, user_agent, correlation_id, metadata_json, created_at
         FROM account_security_events
         WHERE tenant_id = ?1 AND user_id = ?2
         ORDER BY created_at DESC
         LIMIT 100`,
      ).bind(tenantId, userId).all<SecurityEventRow>(),
    ]);

    const passkeys = (passkeysResult.results ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      device_type: row.deviceType,
      backed_up: Boolean(row.backedUp),
      transports: row.transports,
      created_at: timeValue(row.createdAt),
    }));
    const sessions = (sessionsResult.results ?? []).map((row) => ({
      id: row.id,
      current: row.id === actor.session?.id,
      created_at: timeValue(row.createdAt),
      updated_at: timeValue(row.updatedAt),
      expires_at: timeValue(row.expiresAt),
      user_agent: row.userAgent,
    }));

    const events = (eventsResult.results ?? []).map((row) => {
      let metadata: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(row.metadata_json || '{}');
        if (parsed && typeof parsed === 'object') metadata = parsed as Record<string, unknown>;
      } catch {
        metadata = {};
      }
      return {
        id: row.id,
        event_type: row.event_type,
        actor_ip: row.actor_ip,
        user_agent: row.user_agent,
        correlation_id: row.correlation_id,
        metadata,
        created_at: row.created_at,
      };
    });

    return Response.json({
      security: {
        password_configured: Boolean(credential),
        password_updated_at: timeValue(credential?.updatedAt),
        passkey_enabled: passkeys.length > 0,
        passkey_count: passkeys.length,
        passkeys,
        two_factor_enabled: Boolean(actor.user.twoFactorEnabled || twoFactor?.verified),
        two_factor_locked_until: timeValue(twoFactor?.lockedUntil),
        session_count: sessions.length,
        sessions,
        events,
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
