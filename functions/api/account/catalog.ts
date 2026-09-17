import { functionErrorResponse, requestCorrelationId, requireAsteraActor, type AsteraFunctionEnv } from '../../_account-projection';
import { loadActiveCatalog, loadTenantSubscription } from '../../_catalog';
import { callBillingEnsureGrants } from '../../_billing-ensure-grants';

type PagesContext = { request: Request; env: AsteraFunctionEnv };

export async function onRequestGet(context: PagesContext): Promise<Response> {
  const requestId = requestCorrelationId(context.request);
  try {
    const actor = await requireAsteraActor(context.request, context.env);
    await callBillingEnsureGrants(context.env, context.request, actor, requestId).catch(() => undefined);
    const refreshedCredit = await context.env.ASTERA_DB.prepare(
      `SELECT id, tenant_id, available_balance, reserved_balance, version, updated_at
       FROM credit_accounts WHERE tenant_id = ?1 LIMIT 1`,
    ).bind(actor.profile.tenant_id).first<typeof actor.credit>();
    const creditRow = refreshedCredit ?? actor.credit;
    const [catalog, subscription] = await Promise.all([
      loadActiveCatalog(context.env.ASTERA_DB),
      loadTenantSubscription(context.env.ASTERA_DB, actor.profile.tenant_id),
    ]);
    return Response.json({
      catalog_version: catalog.catalog_version,
      checksum: catalog.checksum,
      published_at: catalog.published_at,
      plans: catalog.plans,
      creditProducts: catalog.creditProducts,
      credit_products: catalog.creditProducts,
      account: {
        tenant_id: actor.profile.tenant_id,
        subscription: subscription ?? {
          status: 'none',
          plan_id: null,
          catalog_version: catalog.catalog_version,
        },
        credit: {
          available: Number(creditRow.available_balance),
          reserved: Number(creditRow.reserved_balance),
          version: Number(creditRow.version),
        },
      },
      subscription: subscription ?? {
        status: 'none',
        plan_id: null,
        catalog_version: catalog.catalog_version,
      },
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
