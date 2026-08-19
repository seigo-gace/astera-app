import {
  FunctionHttpError,
  functionErrorResponse,
  requestCorrelationId,
  requireFreshAsteraActor,
  type AsteraFunctionEnv,
} from '../../_account-projection';
import { loadActiveCatalog } from '../../_catalog';
import { createSquareCheckout, type SquareEnv } from '../../_square';

type Env = AsteraFunctionEnv & SquareEnv;
type PagesContext = { request: Request; env: Env };

type CheckoutBody = {
  product_id?: unknown;
  plan_id?: unknown;
  return_to?: unknown;
  native_callback?: unknown;
};

type ExistingIntent = {
  id: string;
  tenant_id: string;
  user_id: string;
  status: string;
  checkout_url: string | null;
  provider_checkout_id: string | null;
  provider_order_id: string | null;
  expires_at: string | null;
};

type ExistingSubscription = {
  plan_id: string;
  provider_subscription_id: string | null;
  status: string;
};

type PendingPlanIntent = {
  id: string;
  status: string;
};

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
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
  if (normalized === 'credit') return '/account/credit';
  if (normalized === 'account') return '/account/subscription';
  return '/app/new';
}

function bodyFingerprint(value: { catalogVersion: string; productKind: string; productId: string; amount: number; credits: number }): string {
  return JSON.stringify(value);
}

async function assertPlanCheckoutAvailable(context: PagesContext, tenantId: string, planId: string): Promise<void> {
  const [subscription, pendingIntent] = await Promise.all([
    context.env.ASTERA_DB.prepare(
      `SELECT plan_id, provider_subscription_id, status
       FROM tenant_subscriptions WHERE tenant_id = ?1 LIMIT 1`,
    ).bind(tenantId).first<ExistingSubscription>(),
    context.env.ASTERA_DB.prepare(
      `SELECT id, status
       FROM billing_intents
       WHERE tenant_id = ?1 AND product_kind = 'plan'
         AND status IN ('creating_checkout','checkout_created','payment_pending','reconciliation_required')
         AND (expires_at IS NULL OR expires_at > ?2)
       ORDER BY created_at DESC LIMIT 1`,
    ).bind(tenantId, new Date().toISOString()).first<PendingPlanIntent>(),
  ]);

  if (pendingIntent) {
    throw new FunctionHttpError(409, 'PLAN_CHECKOUT_ALREADY_PENDING', '既存のPlan契約処理が完了していません。Billing状態を確認してから再試行してください。', { intent_id: pendingIntent.id, status: pendingIntent.status });
  }

  const live = subscription?.provider_subscription_id
    && !['none', 'cancelled', 'failed'].includes(subscription.status);
  if (!live) return;
  if (subscription?.plan_id === planId) {
    throw new FunctionHttpError(409, 'SUBSCRIPTION_ALREADY_ACTIVE', '選択したPlanは既に契約中です。');
  }
  throw new FunctionHttpError(409, 'SUBSCRIPTION_CHANGE_REQUIRES_SWAP', '既存SubscriptionのPlan変更は新規Checkoutでは行えません。Plan変更APIを使用してください。', { current_plan_id: subscription?.plan_id, requested_plan_id: planId });
}

export async function onRequestPost(context: PagesContext): Promise<Response> {
  const requestId = requestCorrelationId(context.request);
  try {
    const actor = await requireFreshAsteraActor(context.request, context.env);
    const key = idempotencyKey(context.request);
    const body = await context.request.json().catch(() => null) as CheckoutBody | null;
    if (!body) throw new FunctionHttpError(400, 'CHECKOUT_BODY_INVALID', 'Checkout RequestのJSONを確認できません。');
    const productId = text(body.product_id);
    const planId = text(body.plan_id);
    if (Boolean(productId) === Boolean(planId)) {
      throw new FunctionHttpError(422, 'CHECKOUT_PRODUCT_SELECTION_INVALID', 'product_idまたはplan_idのどちらか一つを指定してください。');
    }

    const existing = await context.env.ASTERA_DB.prepare(
      `SELECT id, tenant_id, user_id, status, checkout_url, provider_checkout_id, provider_order_id, expires_at
       FROM billing_intents WHERE idempotency_key = ?1 LIMIT 1`,
    ).bind(key).first<ExistingIntent>();
    if (existing) {
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
      throw new FunctionHttpError(409, 'CHECKOUT_INTENT_IN_PROGRESS', '同じCheckout Intentを作成中です。');
    }

    if (planId) await assertPlanCheckoutAvailable(context, actor.profile.tenant_id, planId);

    const catalog = await loadActiveCatalog(context.env.ASTERA_DB);
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
      if (!plan) throw new FunctionHttpError(422, 'PLAN_NOT_AVAILABLE', 'Accountが選択可能なPlanではありません。');
      if (plan.recurring_amount <= 0) throw new FunctionHttpError(422, 'PLAN_CHECKOUT_NOT_REQUIRED', 'このPlanはSquare Checkoutを必要としません。');
      if (!plan.square_plan_variation_id) throw new FunctionHttpError(503, 'SQUARE_PLAN_MAPPING_MISSING', 'PlanとSquare Subscription VariationのMappingがありません。');
      productKind = 'plan';
      selectedId = plan.plan_id;
      displayName = plan.display_name;
      amount = plan.recurring_amount;
      credits = plan.included_credits;
      subscriptionPlanVariationId = plan.square_plan_variation_id;
    }

    if (!Number.isInteger(amount) || amount <= 0 || !Number.isInteger(credits) || credits < 0) {
      throw new FunctionHttpError(500, 'CATALOG_MONEY_CONTRACT_INVALID', 'Catalogの金額またはCredit量が不正です。');
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
    const intentId = crypto.randomUUID();
    const contextId = crypto.randomUUID();
    const route = returnRoute(body.return_to);
    const fingerprint = bodyFingerprint({ catalogVersion: catalog.catalog_version, productKind, productId: selectedId, amount, credits });

    await context.env.ASTERA_DB.batch([
      context.env.ASTERA_DB.prepare(
        `INSERT INTO return_contexts
          (id, tenant_id, user_id, route, reference_type, reference_id, private_mode, resume_mode, expires_at, consumed_at, created_at)
         VALUES (?1, ?2, ?3, ?4, 'billing_intent', ?5, 0, 'user_confirm', ?6, NULL, ?7)`,
      ).bind(contextId, actor.profile.tenant_id, actor.user.id, route, intentId, expiresAt, now.toISOString()),
      context.env.ASTERA_DB.prepare(
        `INSERT INTO billing_intents
          (id, tenant_id, user_id, catalog_version, product_id, currency, amount, status, idempotency_key,
           provider_checkout_id, created_at, updated_at, product_kind, credit_amount, provider_order_id,
           provider_payment_id, checkout_url, return_context_id, expires_at, completed_at, failure_code)
         VALUES (?1, ?2, ?3, ?4, ?5, 'JPY', ?6, 'creating_checkout', ?7,
                 NULL, ?8, ?8, ?9, ?10, NULL, NULL, NULL, ?11, ?12, NULL, NULL)`,
      ).bind(intentId, actor.profile.tenant_id, actor.user.id, catalog.catalog_version, selectedId, amount, key, now.toISOString(), productKind, credits, contextId, expiresAt),
    ]);

    try {
      const square = await createSquareCheckout(context.env, {
        idempotencyKey: key,
        intentId,
        displayName,
        amount,
        currency: 'JPY',
        subscriptionPlanVariationId,
      });
      await context.env.ASTERA_DB.prepare(
        `UPDATE billing_intents
         SET status = 'checkout_created', provider_checkout_id = ?1, provider_order_id = ?2,
             checkout_url = ?3, updated_at = ?4
         WHERE id = ?5 AND status = 'creating_checkout'`,
      ).bind(square.checkoutId, square.orderId, square.checkoutUrl, new Date().toISOString(), intentId).run();

      return Response.json({
        intent_id: intentId,
        status: 'checkout_created',
        checkout_url: square.checkoutUrl,
        provider_checkout_id: square.checkoutId,
        provider_order_id: square.orderId,
        return_context_id: contextId,
        expires_at: expiresAt,
        catalog_version: catalog.catalog_version,
        request_fingerprint: fingerprint,
      }, { status: 201, headers: { 'Cache-Control': 'no-store', 'X-Correlation-ID': requestId } });
    } catch (error) {
      const code = error instanceof FunctionHttpError ? error.code : 'SQUARE_CHECKOUT_CREATE_FAILED';
      await context.env.ASTERA_DB.prepare(
        `UPDATE billing_intents SET status = 'failed', failure_code = ?1, updated_at = ?2
         WHERE id = ?3`,
      ).bind(code, new Date().toISOString(), intentId).run();
      throw error;
    }
  } catch (error) {
    return functionErrorResponse(error, requestId);
  }
}

export function onRequest(context: PagesContext): Promise<Response> {
  if (context.request.method !== 'POST') {
    return Promise.resolve(Response.json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'POSTのみ対応しています。' } }, { status: 405 }));
  }
  return onRequestPost(context);
}
