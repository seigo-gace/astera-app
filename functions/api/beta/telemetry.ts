import {
  FunctionHttpError,
  functionErrorResponse,
  requestCorrelationId,
  requireAsteraActor,
} from '../../_account-projection';
import { adminiSignedRequest } from '../../_admini-signature';
import { betaParticipant, type BetaEnv } from '../../_beta-program';

type PagesContext = { request: Request; env: BetaEnv };

const SAFE_KEYS = new Set([
  'event','stage','status','duration_ms','render_ms','api_ms','memory_mb','cpu_ms','network_bytes',
  'os','device_class','browser','webview','viewport_width','viewport_height','orientation','network_type',
  'app_version','build_version','feature_flag','route','retry_count','timeout','fallback','error_code','error_type','http_status',
]);
const FORBIDDEN_KEY = /(password|passcode|secret|token|cookie|authorization|api[_-]?key|oauth|prompt|question|message|body|content|document|file[_-]?text|result[_-]?text|conversation)/i;

function currentJstMonth(): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit' }).formatToParts(new Date());
  const year = parts.find((part) => part.type === 'year')?.value ?? '0000';
  const month = parts.find((part) => part.type === 'month')?.value ?? '00';
  return `${year}-${month}`;
}

function sanitize(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {};
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    if (!SAFE_KEYS.has(key) || FORBIDDEN_KEY.test(key)) continue;
    if (value === null || typeof value === 'boolean') output[key] = value;
    else if (typeof value === 'number' && Number.isFinite(value)) output[key] = value;
    else if (typeof value === 'string') output[key] = value.slice(0, 500);
  }
  return output;
}

async function deliver(env: BetaEnv, event: Record<string, unknown>): Promise<boolean> {
  try {
    await adminiSignedRequest(env, '/internal/v1/rewards/beta/telemetry', event);
    return true;
  } catch {
    return false;
  }
}

async function flushOutbox(env: BetaEnv): Promise<void> {
  const now = new Date().toISOString();
  const rows = await env.ASTERA_DB.prepare(
    `SELECT event_id,sanitized_event_json,attempt_count FROM beta_telemetry_outbox
     WHERE next_attempt_at<=?1 AND expires_at>?1 ORDER BY created_at LIMIT 10`,
  ).bind(now).all<{ event_id: string; sanitized_event_json: string; attempt_count: number }>();
  for (const row of rows.results ?? []) {
    let event: Record<string, unknown>;
    try { event = JSON.parse(row.sanitized_event_json) as Record<string, unknown>; } catch {
      await env.ASTERA_DB.prepare(`DELETE FROM beta_telemetry_outbox WHERE event_id=?1`).bind(row.event_id).run();
      continue;
    }
    if (await deliver(env, event)) {
      await env.ASTERA_DB.prepare(`DELETE FROM beta_telemetry_outbox WHERE event_id=?1`).bind(row.event_id).run();
      continue;
    }
    const attempt = Number(row.attempt_count) + 1;
    const delayMinutes = Math.min(60, 2 ** Math.min(6, attempt));
    const next = new Date(Date.now() + delayMinutes * 60_000).toISOString();
    await env.ASTERA_DB.prepare(
      `UPDATE beta_telemetry_outbox SET attempt_count=?1,next_attempt_at=?2,updated_at=?3 WHERE event_id=?4`,
    ).bind(attempt, next, new Date().toISOString(), row.event_id).run();
  }
  await env.ASTERA_DB.prepare(`DELETE FROM beta_telemetry_outbox WHERE expires_at<=?1`).bind(now).run();
}

export async function onRequest(context: PagesContext): Promise<Response> {
  const requestId = requestCorrelationId(context.request);
  try {
    if (context.request.method !== 'POST') {
      return Response.json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'POSTを使用してください。', correlation_id: requestId } }, { status: 405 });
    }
    const actor = await requireAsteraActor(context.request, context.env);
    const participant = await betaParticipant(context.env, actor.user.id);
    if (!participant || !['active','commitment_active'].includes(participant.state) || !participant.telemetry_enabled) {
      throw new FunctionHttpError(409, 'BETA_TELEMETRY_NOT_ALLOWED', 'βテストTelemetryは現在送信できません。');
    }
    const body = await context.request.json().catch(() => null) as {
      event_id?: unknown;
      feature_id?: unknown;
      event_type?: unknown;
      app_version?: unknown;
      trace_id?: unknown;
      request_id?: unknown;
      payload?: unknown;
    } | null;
    const featureId = typeof body?.feature_id === 'string' ? body.feature_id.trim() : '';
    const eventType = typeof body?.event_type === 'string' ? body.event_type.trim() : '';
    const appVersion = typeof body?.app_version === 'string' ? body.app_version.trim() : '';
    if (!featureId || !eventType || !appVersion) throw new FunctionHttpError(400, 'BETA_TELEMETRY_INPUT_INVALID', 'Telemetry情報が不足しています。');
    const feature = await context.env.ASTERA_DB.prepare(
      `SELECT f.version,f.lifecycle,COALESCE(p.enabled,f.default_enabled) AS enabled
       FROM beta_feature_projection f
       LEFT JOIN beta_feature_preferences p ON p.feature_id=f.feature_id AND p.user_id=?1
       WHERE f.feature_id=?2 LIMIT 1`,
    ).bind(actor.user.id, featureId).first<{ version: string; lifecycle: string; enabled: number }>();
    if (!feature || feature.lifecycle !== 'active' || feature.enabled !== 1) throw new FunctionHttpError(409, 'BETA_FEATURE_NOT_ACTIVE', '対象β機能は現在有効ではありません。');

    const eventId = typeof body?.event_id === 'string' && body.event_id.trim() ? body.event_id.trim() : crypto.randomUUID();
    const receivedAt = new Date().toISOString();
    const targetMonth = currentJstMonth();
    const event = {
      event_id: eventId,
      user_id: actor.user.id,
      tenant_id: actor.profile.tenant_id,
      feature_id: featureId,
      feature_version: feature.version,
      event_type: eventType.slice(0, 120),
      app_version: appVersion.slice(0, 80),
      trace_id: typeof body?.trace_id === 'string' ? body.trace_id.slice(0, 160) : null,
      request_id: typeof body?.request_id === 'string' ? body.request_id.slice(0, 160) : requestId,
      payload: sanitize(body?.payload),
      received_at: receivedAt,
    };
    const outboxJson = JSON.stringify(event);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    await context.env.ASTERA_DB.batch([
      context.env.ASTERA_DB.prepare(
        `INSERT OR IGNORE INTO beta_feature_usage_receipts
         (event_id,user_id,feature_id,feature_version,target_month,server_received_at)
         VALUES (?1,?2,?3,?4,?5,?6)`,
      ).bind(eventId, actor.user.id, featureId, feature.version, targetMonth, receivedAt),
      context.env.ASTERA_DB.prepare(
        `INSERT OR IGNORE INTO beta_telemetry_outbox
         (event_id,user_id,feature_id,sanitized_event_json,attempt_count,next_attempt_at,expires_at,created_at,updated_at)
         VALUES (?1,?2,?3,?4,0,?5,?6,?5,?5)`,
      ).bind(eventId, actor.user.id, featureId, outboxJson, receivedAt, expiresAt),
    ]);

    const delivered = await deliver(context.env, event);
    if (delivered) await context.env.ASTERA_DB.prepare(`DELETE FROM beta_telemetry_outbox WHERE event_id=?1`).bind(eventId).run();
    await flushOutbox(context.env);
    return Response.json({ accepted: true, event_id: eventId, delivery: delivered ? 'delivered' : 'queued' }, {
      status: delivered ? 200 : 202,
      headers: { 'Cache-Control': 'no-store', 'X-Correlation-ID': requestId },
    });
  } catch (error) {
    return functionErrorResponse(error, requestId);
  }
}
