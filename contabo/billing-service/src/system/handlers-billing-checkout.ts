import {
  FunctionHttpError,
  functionErrorResponse,
  requestCorrelationId,
  type BillingServiceEnv,
} from '../part/billing-env.js';
import { requireBillingActor } from '../feature/billing-auth.js';
import { requireProjectionClient } from '../feature/astera-projection.js';
import { monthlyIncludedCreditsForPlan, type BillingCycle } from '../feature/catalog.js';
import {
  billingIntentRetryable,
  resolveBillingSquareCheckout,
  runSquareBillingCheckout,
  type BillingIntentRow,
} from '../feature/checkout-intent-recovery.js';
import { assertOrReusePlanCheckout } from '../feature/plan-checkout-guard.js';
import { createLibralVaultClientFromEnv } from '../feature/libral-vault.js';

type CheckoutBody = {
  product_id?: unknown;
  plan_id?: unknown;
  billing_cycle?: unknown;
  return_to?: unknown;
};

type ExistingIntent = BillingIntentRow;

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function parseBillingCycle(value: unknown): BillingCycle {
  const normalized = text(value).toLowerCase();
  if (!normalized || normalized === 'monthly') return 'monthly';
  if (normalized === 'annual') return 'annual';
  throw new FunctionHttpError(422, 'BILLING_CYCLE_INVALID', 'billing_cycleはmonthlyまたはannualを指定してください。');
}

function idempotencyKey(request: Request): string {
  const value = request.headers.get('Idempotency-Key')?.trim();
  if (!value) throw new FunctionHttpError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Keyが必要です。');
  if (value.length > 192) throw new FunctionHttpError(400, 'IDEMPOTENCY_KEY_TOO_LONG', 'Idempotency-Keyは192文字以内です。');
  return value;
}

function returnRoute(value: unknown): string {
  const normalized = text(value);
  if (normalized === 'pricing') return '/pricing';
  if (normalized === 'plan-credit') return '/app/plan-credit';
  if (normalized === 'credit') return '/account/credit';
  if (normalized === 'account') return '/account/subscription';
  return '/app/new';
}

export async function handleBillingCheckoutIntents(request: Request, env: BillingServiceEnv): Promise<Response> {
  const requestId = requestCorrelationId(request.headers);
  try {
    const projection = requireProjectionClient(env);
    const actor = await requireBillingActor(request, env);
    const key = idempotencyKey(request);
    const body = await request.json().catch(() => null) as CheckoutBody | null;
    if (!body) throw new FunctionHttpError(400, 'CHECKOUT_BODY_INVALID', 'Checkout RequestのJSONを確認できません。');
    const productId = text(body.product_id);
    const planId = text(body.plan_id);
    if (Boolean(productId) === Boolean(planId)) {
      throw new FunctionHttpError(422, 'CHECKOUT_PRODUCT_SELECTION_INVALID', 'product_idまたはplan_idのどちらか一つを指定してください。');
    }
    const billingCycle = planId ? parseBillingCycle(body.billing_cycle) : null;

    const vault = env.vault ?? createLibralVaultClientFromEnv(env);
    if (!vault) throw new FunctionHttpError(503, 'VAULT_NOT_CONFIGURED', 'Vault internal clientが設定されていません。');

    const existingRow = await projection.getBillingIntentByIdempotency(key);
    if (existingRow) {
      const existing = existingRow as unknown as ExistingIntent;
      if (existing.tenant_id !== actor.profile.tenant_id || existing.user_id !== actor.user.id) {
        throw new FunctionHttpError(409, 'IDEMPOTENCY_KEY_OWNERSHIP_MISMATCH', 'このIdempotency-Keyは別Contextで使用されています。');
      }
      if (existing.checkout_url) {
        return Response.json({
          intent_id: existing.id,
          status: existing.status,
          checkout_url: existing.checkout_url,
          provider_checkout_id: existing.provider_checkout_id,
          provider_order_id: existing.provider_order_id,
          expires_at: existing.expires_at,
          reused: true,
        }, { headers: { 'Cache-Control': 'no-store', 'X-Correlation-ID': requestId } });
      }
      if (billingIntentRetryable(existing)) {
        const catalog = await projection.getCatalog();
        const squareInput = resolveBillingSquareCheckout(catalog, existing);
        const square = await runSquareBillingCheckout(
          { env, vault, projection },
          actor,
          {
            intentId: existing.id,
            idempotencyKey: key,
            correlationId: requestId,
            displayName: squareInput.displayName,
            amount: squareInput.amount,
            subscriptionPlanVariationId: squareInput.subscriptionPlanVariationId,
          },
        );
        await projection.postIntentCheckoutCreated({
          intent_id: existing.id,
          provider_checkout_id: square.checkoutId,
          provider_order_id: square.orderId,
          checkout_url: square.checkoutUrl,
          updated_at: new Date().toISOString(),
        });
        return Response.json({
          intent_id: existing.id,
          status: 'checkout_created',
          checkout_url: square.checkoutUrl,
          provider_checkout_id: square.checkoutId,
          provider_order_id: square.orderId,
          expires_at: existing.expires_at,
          retried: true,
        }, { status: 201, headers: { 'Cache-Control': 'no-store', 'X-Correlation-ID': requestId } });
      }
      throw new FunctionHttpError(409, 'CHECKOUT_INTENT_IN_PROGRESS', '同じCheckout Intentを作成中です。');
    }

    if (planId && billingCycle) {
      const reuse = await assertOrReusePlanCheckout(projection, {
        tenantId: actor.profile.tenant_id,
        userId: actor.user.id,
        planId,
        billingCycle,
        correlationId: requestId,
      });
      if (reuse) {
        const intent = reuse.intent;
        return Response.json({
          intent_id: String(intent['id'] ?? ''),
          status: String(intent['status'] ?? 'checkout_created'),
          checkout_url: intent['checkout_url'] ?? null,
          provider_checkout_id: intent['provider_checkout_id'] ?? null,
          provider_order_id: intent['provider_order_id'] ?? null,
          expires_at: intent['expires_at'] ?? null,
          reused: true,
        }, { headers: { 'Cache-Control': 'no-store', 'X-Correlation-ID': requestId } });
      }
    }

    const catalog = await projection.getCatalog();
    let productKind: 'credit' | 'plan';
    let selectedId: string;
    let displayName: string;
    let amount: number;
    let credits: number;
    let subscriptionPlanVariationId: string | null = null;

    if (productId) {
      const product = catalog.creditProducts.find((item) => item.product_id === productId && item.active);
      if (!product) throw new FunctionHttpError(422, 'CREDIT_PRODUCT_NOT_AVAILABLE', 'Active Catalogに存在するCredit商品を選択してください。');
      productKind = 'credit';
      selectedId = product.product_id;
      displayName = product.display_name;
      amount = product.amount;
      credits = product.credits;
    } else {
      const plan = catalog.plans.find((item) => item.plan_id === planId && item.active);
      if (!plan || !billingCycle) throw new FunctionHttpError(422, 'PLAN_NOT_AVAILABLE', 'Accountが選択可能なPlanではありません。');
      const variant = plan.billing_variants.find((item) => item.billing_cycle === billingCycle && item.active);
      if (!variant) throw new FunctionHttpError(422, 'PLAN_BILLING_VARIANT_NOT_AVAILABLE', '選択したPlanの請求周期は利用できません。');
      if (variant.recurring_amount <= 0) throw new FunctionHttpError(422, 'PLAN_CHECKOUT_NOT_REQUIRED', 'このPlanはSquare Checkoutを必要としません。');
      if (!variant.square_plan_variation_id) {
        throw new FunctionHttpError(503, 'SQUARE_PLAN_MAPPING_MISSING', 'PlanとSquare Subscription VariationのMappingがありません。', { plan_id: planId, billing_cycle: billingCycle });
      }
      productKind = 'plan';
      selectedId = plan.plan_id;
      displayName = `${plan.display_name} (${billingCycle})`;
      amount = variant.recurring_amount;
      credits = monthlyIncludedCreditsForPlan(plan);
      subscriptionPlanVariationId = variant.square_plan_variation_id;
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
    const intentId = crypto.randomUUID();
    const contextId = crypto.randomUUID();
    const route = returnRoute(body.return_to);

    await projection.postIntentCreate({
      intent_id: intentId,
      context_id: contextId,
      tenant_id: actor.profile.tenant_id,
      user_id: actor.user.id,
      catalog_version: catalog.catalog_version,
      product_id: selectedId,
      amount,
      product_kind: productKind,
      billing_cycle: billingCycle,
      credit_amount: credits,
      route,
      expires_at: expiresAt,
      created_at: now.toISOString(),
      idempotency_key: key,
    });

    const square = await runSquareBillingCheckout(
      { env, vault, projection },
      actor,
      {
        intentId,
        idempotencyKey: key,
        correlationId: requestId,
        displayName,
        amount,
        subscriptionPlanVariationId,
      },
    );
    await projection.postIntentCheckoutCreated({
      intent_id: intentId,
      provider_checkout_id: square.checkoutId,
      provider_order_id: square.orderId,
      checkout_url: square.checkoutUrl,
      updated_at: new Date().toISOString(),
    });

    return Response.json({
      intent_id: intentId,
      status: 'checkout_created',
      checkout_url: square.checkoutUrl,
      provider_checkout_id: square.checkoutId,
      provider_order_id: square.orderId,
      return_context_id: contextId,
      expires_at: expiresAt,
      catalog_version: catalog.catalog_version,
      billing_cycle: billingCycle,
    }, { status: 201, headers: { 'Cache-Control': 'no-store', 'X-Correlation-ID': requestId } });
  } catch (error) {
    return functionErrorResponse(error, requestId);
  }
}
