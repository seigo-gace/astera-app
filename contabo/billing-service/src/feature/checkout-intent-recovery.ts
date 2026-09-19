import { FunctionHttpError, type BillingServiceEnv } from '../part/billing-env.js';
import type { AsteraProjectionClient } from './astera-projection.js';
import type { ActiveCommercialCatalog, BillingCycle } from './catalog.js';
import { createSquareCheckout } from './square.js';
import type { LibralVaultClient } from './libral-vault.js';

export type BillingIntentRow = {
  id: string;
  tenant_id: string;
  user_id: string;
  status: string;
  checkout_url: string | null;
  provider_checkout_id: string | null;
  provider_order_id: string | null;
  expires_at: string | null;
  product_id: string;
  product_kind: string;
  billing_cycle: string | null;
  amount: number;
  return_context_id?: string | null;
};

function checkoutFailureCode(error: unknown): string {
  if (error instanceof FunctionHttpError) return error.code;
  return 'CHECKOUT_CREATE_FAILED';
}

export async function markBillingIntentCheckoutFailed(
  projection: AsteraProjectionClient,
  actor: { profile: { tenant_id: string }; user: { id: string } },
  intentId: string,
  idempotencyKey: string,
  correlationId: string,
  error: unknown,
): Promise<void> {
  try {
    await projection.postIntentStatus({
      intent_id: intentId,
      billing_intent_id: intentId,
      tenant_id: actor.profile.tenant_id,
      user_id: actor.user.id,
      status: 'failed',
      failure_code: checkoutFailureCode(error),
      idempotency_key: `${idempotencyKey}:checkout-failed:${intentId}`,
      correlation_id: correlationId,
    });
  } catch {
    // Best-effort: do not mask the original checkout error.
  }
}

export async function markStorageIntentCheckoutFailed(
  projection: AsteraProjectionClient,
  actor: { profile: { tenant_id: string }; user: { id: string } },
  intentId: string,
  idempotencyKey: string,
  correlationId: string,
  error: unknown,
): Promise<void> {
  try {
    await projection.postStorageIntentFailed({
      intent_id: intentId,
      tenant_id: actor.profile.tenant_id,
      user_id: actor.user.id,
      failure_code: checkoutFailureCode(error),
      idempotency_key: `${idempotencyKey}:checkout-failed:${intentId}`,
      correlation_id: correlationId,
    });
  } catch {
    // Best-effort: do not mask the original checkout error.
  }
}

export function billingIntentRetryable(intent: BillingIntentRow): boolean {
  return !intent.checkout_url && (intent.status === 'creating_checkout' || intent.status === 'failed');
}

export function storageIntentRetryable(intent: BillingIntentRow): boolean {
  return !intent.checkout_url && (intent.status === 'creating_checkout' || intent.status === 'failed');
}

export function resolveBillingSquareCheckout(
  catalog: ActiveCommercialCatalog,
  intent: BillingIntentRow,
): {
  displayName: string;
  amount: number;
  subscriptionPlanVariationId: string | null;
} {
  if (intent.product_kind === 'credit') {
    const product = catalog.creditProducts.find((item) => item.product_id === intent.product_id && item.active);
    if (!product) {
      throw new FunctionHttpError(422, 'CREDIT_PRODUCT_NOT_AVAILABLE', 'Active Catalogに存在するCredit商品を選択してください。');
    }
    return {
      displayName: product.display_name,
      amount: product.amount,
      subscriptionPlanVariationId: null,
    };
  }
  const billingCycle = (intent.billing_cycle ?? 'monthly') as BillingCycle;
  const plan = catalog.plans.find((item) => item.plan_id === intent.product_id && item.active);
  if (!plan) throw new FunctionHttpError(422, 'PLAN_NOT_AVAILABLE', 'Accountが選択可能なPlanではありません。');
  const variant = plan.billing_variants.find((item) => item.billing_cycle === billingCycle && item.active);
  if (!variant?.square_plan_variation_id) {
    throw new FunctionHttpError(503, 'SQUARE_PLAN_MAPPING_MISSING', 'PlanとSquare Subscription VariationのMappingがありません。');
  }
  return {
    displayName: `${plan.display_name} (${billingCycle})`,
    amount: variant.recurring_amount,
    subscriptionPlanVariationId: variant.square_plan_variation_id,
  };
}

export async function runSquareBillingCheckout(
  deps: { env: BillingServiceEnv; vault: LibralVaultClient; projection: AsteraProjectionClient },
  actor: { profile: { tenant_id: string }; user: { id: string } },
  input: {
    intentId: string;
    idempotencyKey: string;
    correlationId: string;
    displayName: string;
    amount: number;
    subscriptionPlanVariationId: string | null;
  },
): Promise<Awaited<ReturnType<typeof createSquareCheckout>>> {
  try {
    return await createSquareCheckout({ env: deps.env, vault: deps.vault }, {
      idempotencyKey: input.idempotencyKey,
      intentId: input.intentId,
      displayName: input.displayName,
      amount: input.amount,
      currency: 'JPY',
      subscriptionPlanVariationId: input.subscriptionPlanVariationId,
    });
  } catch (error) {
    await markBillingIntentCheckoutFailed(
      deps.projection,
      actor,
      input.intentId,
      input.idempotencyKey,
      input.correlationId,
      error,
    );
    throw error;
  }
}

export async function runSquareStorageCheckout(
  deps: { env: BillingServiceEnv; vault: LibralVaultClient; projection: AsteraProjectionClient },
  actor: { profile: { tenant_id: string }; user: { id: string } },
  input: {
    intentId: string;
    idempotencyKey: string;
    correlationId: string;
    displayName: string;
    amount: number;
  },
): Promise<Awaited<ReturnType<typeof createSquareCheckout>>> {
  try {
    return await createSquareCheckout({ env: deps.env, vault: deps.vault }, {
      idempotencyKey: input.idempotencyKey,
      intentId: input.intentId,
      displayName: input.displayName,
      amount: input.amount,
      currency: 'JPY',
      subscriptionPlanVariationId: null,
    });
  } catch (error) {
    await markStorageIntentCheckoutFailed(
      deps.projection,
      actor,
      input.intentId,
      input.idempotencyKey,
      input.correlationId,
      error,
    );
    throw error;
  }
}
