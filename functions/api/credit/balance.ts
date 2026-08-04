import { functionErrorResponse, requestCorrelationId, requireAsteraActor, type AsteraFunctionEnv } from '../../_account-projection';

type Env = AsteraFunctionEnv & {
  CREDIT_POLICY_VERSION?: string;
  CREDIT_LOW_THRESHOLD?: string;
  CREDIT_CRITICAL_THRESHOLD?: string;
};
type PagesContext = { request: Request; env: Env };

function nonNegativeInteger(value: string | undefined): number | null {
  if (!value?.trim()) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function stateFor(usable: number, low: number | null, critical: number | null): string {
  if (usable <= 0) return 'depleted';
  if (critical !== null && usable <= critical) return 'critical';
  if (low !== null && usable <= low) return 'low';
  return 'healthy';
}

export async function onRequestGet(context: PagesContext): Promise<Response> {
  const requestId = requestCorrelationId(context.request);
  try {
    const actor = await requireAsteraActor(context.request, context.env);
    const total = Number(actor.credit.available_balance);
    const reserved = Number(actor.credit.reserved_balance);
    const usable = Math.max(0, total - reserved);
    const lowThreshold = nonNegativeInteger(context.env.CREDIT_LOW_THRESHOLD);
    const criticalThreshold = nonNegativeInteger(context.env.CREDIT_CRITICAL_THRESHOLD);
    return Response.json({
      credit_account_id: actor.credit.id,
      tenant_id: actor.profile.tenant_id,
      available_balance: total,
      reserved_balance: reserved,
      usable_balance: usable,
      version: Number(actor.credit.version),
      state: stateFor(usable, lowThreshold, criticalThreshold),
      policy: {
        version: context.env.CREDIT_POLICY_VERSION?.trim() || 'unconfigured',
        low_threshold: lowThreshold,
        critical_threshold: criticalThreshold,
        configured: lowThreshold !== null && criticalThreshold !== null,
      },
      updated_at: actor.credit.updated_at,
    }, { headers: { 'Cache-Control': 'no-store', 'X-Correlation-ID': requestId } });
  } catch (error) {
    return functionErrorResponse(error, requestId);
  }
}

export function onRequest(context: PagesContext): Promise<Response> {
  if (context.request.method !== 'GET') {
    return Promise.resolve(Response.json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'GETのみ対応しています。' } }, { status: 405 }));
  }
  return onRequestGet(context);
}
