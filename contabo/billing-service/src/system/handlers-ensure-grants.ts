import { ensureMonthlyIncludedGrantForTenant } from '../feature/credit-grants-projection.js';
import { requireBillingActor } from '../feature/billing-auth.js';
import { requireProjectionClient } from '../feature/astera-projection.js';
import { functionErrorResponse, requestCorrelationId, type BillingServiceEnv } from '../part/billing-env.js';

export async function handleEnsureGrants(request: Request, env: BillingServiceEnv): Promise<Response> {
  const requestId = requestCorrelationId(new Headers(request.headers));
  try {
    if (request.method !== 'POST') {
      return Response.json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'POSTのみ対応しています。' } }, { status: 405 });
    }
    const projection = requireProjectionClient(env);
    const actor = await requireBillingActor(request, env);
    await ensureMonthlyIncludedGrantForTenant(
      projection,
      actor.profile.tenant_id,
      actor.user.id,
      actor.credit.id,
      { correlationId: requestId },
    );
    const refreshed = await projection.getCreditAccount(actor.credit.id);
    return Response.json(
      {
        accepted: true,
        credit: {
          available: Number(refreshed.available_balance),
          reserved: Number(refreshed.reserved_balance),
          version: Number(refreshed.version),
        },
      },
      { status: 200, headers: { 'Cache-Control': 'no-store', 'X-Correlation-ID': requestId } },
    );
  } catch (error) {
    return functionErrorResponse(error, requestId);
  }
}
