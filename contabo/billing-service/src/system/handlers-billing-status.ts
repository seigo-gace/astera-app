import {
  FunctionHttpError,
  functionErrorResponse,
  requestCorrelationId,
  type BillingServiceEnv,
} from '../part/billing-env.js';
import { requireBillingActor } from '../feature/billing-auth.js';
import { requireProjectionClient } from '../feature/astera-projection.js';

export async function handleBillingStatus(request: Request, env: BillingServiceEnv, intentId: string): Promise<Response> {
  const requestId = requestCorrelationId(request.headers);
  try {
    const projection = requireProjectionClient(env);
    const actor = await requireBillingActor(request, env);
    const normalizedIntent = intentId.trim();
    if (!normalizedIntent) throw new FunctionHttpError(400, 'INTENT_ID_REQUIRED', 'Billing Intent IDが必要です。');

    const intent = await projection.getBillingIntentLookup({
      intent_id: normalizedIntent,
      tenant_id: actor.profile.tenant_id,
    });

    if (!intent) {
      const storage = await projection.getStorageIntentById(normalizedIntent, actor.profile.tenant_id);
      if (!storage) throw new FunctionHttpError(404, 'BILLING_INTENT_NOT_FOUND', 'Billing Intentが見つかりません。');
      return Response.json({
        intent_id: storage.id,
        status: storage.status,
        product_kind: 'storage',
        product_id: storage.product_id,
        catalog_version: storage.catalog_version,
        money: { amount: Number(storage.price_jpy), currency: 'JPY' },
        capacity_gb: Number(storage.capacity_gb),
        provider_checkout_id: storage.provider_checkout_id,
        provider_order_id: storage.provider_order_id,
        provider_payment_id: storage.provider_payment_id,
        expires_at: storage.expires_at,
        completed_at: storage.completed_at,
        failure_code: storage.failure_code,
        created_at: storage.created_at,
        updated_at: storage.updated_at,
        resume_mode: storage.status === 'completed' ? 'user_confirm' : 'wait_for_webhook',
        return_to: '/app/plan-credit',
      }, { headers: { 'Cache-Control': 'no-store', 'X-Correlation-ID': requestId } });
    }

    const grant = await projection.getLedgerGrant(actor.credit.id, 'billing_intent', normalizedIntent);

    return Response.json({
      intent_id: intent.id,
      status: intent.status,
      product_kind: intent.product_kind,
      product_id: intent.product_id,
      catalog_version: intent.catalog_version,
      money: { amount: Number(intent.amount), currency: intent.currency },
      credit_amount: Number(intent.credit_amount),
      provider_checkout_id: intent.provider_checkout_id,
      provider_order_id: intent.provider_order_id,
      provider_payment_id: intent.provider_payment_id,
      return_context_id: intent.return_context_id,
      expires_at: intent.expires_at,
      completed_at: intent.completed_at,
      failure_code: intent.failure_code,
      created_at: intent.created_at,
      updated_at: intent.updated_at,
      credit_posted: Boolean(grant),
      credit_transaction: grant ?? null,
      resume_mode: intent.status === 'completed' ? 'user_confirm' : 'wait_for_webhook',
    }, { headers: { 'Cache-Control': 'no-store', 'X-Correlation-ID': requestId } });
  } catch (error) {
    return functionErrorResponse(error, requestId);
  }
}
