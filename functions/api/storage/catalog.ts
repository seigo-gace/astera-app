import {
  functionErrorResponse,
  requestCorrelationId,
  requireAsteraActor,
  type AsteraFunctionEnv,
} from '../../_account-projection';
import { loadStorageCommerceProjection } from '../../_storage-commerce';
import { loadStorageContractProjection } from '../../_storage-contract';
import { usage } from '../../_storage-store';

type PagesContext = { request: Request; env: AsteraFunctionEnv };

export async function onRequestGet(context: PagesContext): Promise<Response> {
  const requestId = requestCorrelationId(context.request);
  try {
    const actor = await requireAsteraActor(context.request, context.env);
    const [commerce, contract] = await Promise.all([
      loadStorageCommerceProjection(context.env.ASTERA_DB, actor.profile.tenant_id),
      loadStorageContractProjection(context.env.ASTERA_DB, actor.profile.tenant_id),
    ]);
    const quota = await usage(
      context.env.ASTERA_DB,
      { userId: actor.user.id, tenantId: actor.profile.tenant_id },
      { capacityBytes: contract.capacityBytes, writeAllowed: contract.writeAllowed, state: contract.state },
    );

    return Response.json({
      catalog_version: commerce.catalogVersion,
      plan_id: commerce.planId,
      plan_max_capacity_gb: commerce.planMaxCapacityGb,
      current_capacity_gb: commerce.currentCapacityGb,
      remaining_purchase_capacity_gb: commerce.remainingCapacityGb,
      over_plan_limit: contract.overPlanLimit,
      state: contract.state,
      write_allowed: contract.writeAllowed,
      usage: quota,
      packs: commerce.packs.map((pack) => ({
        product_id: pack.productId,
        display_name: pack.displayName,
        capacity_gb: pack.capacityGb,
        price_jpy: pack.priceJpy,
        can_purchase: pack.canPurchase,
      })),
    }, { headers: { 'Cache-Control': 'no-store', 'X-Correlation-ID': requestId } });
  } catch (error) {
    return functionErrorResponse(error, requestId);
  }
}

export function onRequest(context: PagesContext): Promise<Response> {
  if (context.request.method !== 'GET') {
    return Promise.resolve(Response.json(
      { error: { code: 'METHOD_NOT_ALLOWED', message: 'GETのみ対応しています。' } },
      { status: 405, headers: { Allow: 'GET' } },
    ));
  }
  return onRequestGet(context);
}
