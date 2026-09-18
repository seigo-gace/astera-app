import {
  FunctionHttpError,
  functionErrorResponse,
  requestCorrelationId,
  requireAsteraActor,
  type AsteraFunctionEnv,
} from '../../_account-projection';
import { loadStorageCommerceProjection, loadStoragePackProduct } from '../../_storage-commerce';
import { createSquareCheckout, type SquareEnv } from '../../_square';

type Env = AsteraFunctionEnv & SquareEnv;
type PagesContext = { request: Request; env: Env };
type Body = { product_id?: unknown };

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

type PendingCapacityRow = { total: number };

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function idempotencyKey(request: Request): string {
  const value = request.headers.get('Idempotency-Key')?.trim();
  if (!value) throw new FunctionHttpError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Keyが必要です。');
  if (value.length > 192) throw new FunctionHttpError(400, 'IDEMPOTENCY_KEY_TOO_LONG', 'Idempotency-Keyは192文字以内です。');
  return value;
}

export async function onRequestPost(context: PagesContext): Promise<Response> {
  const requestId = requestCorrelationId(context.request);
  try {
    const actor = await requireAsteraActor(context.request, context.env);
    const key = idempotencyKey(context.request);
    const body = await context.request.json().catch(() => null) as Body | null;
    const productId = text(body?.product_id);
    if (!productId) throw new FunctionHttpError(422, 'STORAGE_PRODUCT_REQUIRED', 'Storage Packを選択してください。');

    const existing = await context.env.ASTERA_DB.prepare(
      `SELECT id, tenant_id, user_id, status, checkout_url, provider_checkout_id, provider_order_id, expires_at
       FROM astera_storage_pack_intents WHERE idempotency_key=?1 LIMIT 1`,
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
      throw new FunctionHttpError(409, 'STORAGE_CHECKOUT_INTENT_IN_PROGRESS', '同じStorage Checkoutを作成中です。');
    }

    const commerce = await loadStorageCommerceProjection(context.env.ASTERA_DB, actor.profile.tenant_id);
    if (commerce.planMaxCapacityGb <= 0) {
      throw new FunctionHttpError(403, 'STORAGE_PLAN_NOT_ELIGIBLE', '現在のPlanではAstera Storageを購入できません。');
    }
    const product = await loadStoragePackProduct(context.env.ASTERA_DB, commerce.catalogVersion, productId);
    const pending = await context.env.ASTERA_DB.prepare(
      `SELECT COALESCE(SUM(capacity_gb),0) total
       FROM astera_storage_pack_intents
       WHERE tenant_id=?1
         AND status IN ('creating_checkout','checkout_created','payment_pending')
         AND (expires_at IS NULL OR expires_at > ?2)`,
    ).bind(actor.profile.tenant_id, new Date().toISOString()).first<PendingCapacityRow>();
    const pendingCapacityGb = Number(pending?.total ?? 0);
    if (!Number.isSafeInteger(pendingCapacityGb) || pendingCapacityGb < 0) {
      throw new FunctionHttpError(503, 'STORAGE_PENDING_CAPACITY_INVALID', 'Storage購入予約容量を確認できません。');
    }
    if (commerce.currentCapacityGb + pendingCapacityGb + product.capacityGb > commerce.planMaxCapacityGb) {
      throw new FunctionHttpError(409, 'STORAGE_PLAN_CAPACITY_EXCEEDED', 'このStorage Packを追加すると現在PlanのStorage上限を超えます。', {
        plan_id: commerce.planId,
        current_capacity_gb: commerce.currentCapacityGb,
        pending_capacity_gb: pendingCapacityGb,
        requested_capacity_gb: product.capacityGb,
        plan_max_capacity_gb: commerce.planMaxCapacityGb,
      });
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
    const intentId = crypto.randomUUID();
    await context.env.ASTERA_DB.prepare(
      `INSERT INTO astera_storage_pack_intents
        (id, tenant_id, user_id, catalog_version, product_id, capacity_gb, price_jpy, status, idempotency_key,
         provider_checkout_id, provider_order_id, provider_payment_id, checkout_url, expires_at, completed_at,
         failure_code, created_at, updated_at)
       VALUES (?1,?2,?3,?4,?5,?6,?7,'creating_checkout',?8,NULL,NULL,NULL,NULL,?9,NULL,NULL,?10,?10)`,
    ).bind(
      intentId,
      actor.profile.tenant_id,
      actor.user.id,
      commerce.catalogVersion,
      product.productId,
      product.capacityGb,
      product.priceJpy,
      key,
      expiresAt,
      now.toISOString(),
    ).run();

    try {
      const square = await createSquareCheckout(context.env, {
        idempotencyKey: key,
        intentId,
        displayName: `Astera Storage ${product.displayName}`,
        amount: product.priceJpy,
        currency: 'JPY',
        subscriptionPlanVariationId: null,
      });
      await context.env.ASTERA_DB.prepare(
        `UPDATE astera_storage_pack_intents
         SET status='checkout_created', provider_checkout_id=?1, provider_order_id=?2,
             checkout_url=?3, updated_at=?4
         WHERE id=?5 AND status='creating_checkout'`,
      ).bind(square.checkoutId, square.orderId, square.checkoutUrl, new Date().toISOString(), intentId).run();

      return Response.json({
        intent_id: intentId,
        status: 'checkout_created',
        checkout_url: square.checkoutUrl,
        provider_checkout_id: square.checkoutId,
        provider_order_id: square.orderId,
        expires_at: expiresAt,
        catalog_version: commerce.catalogVersion,
        capacity_gb: product.capacityGb,
        price_jpy: product.priceJpy,
      }, { status: 201, headers: { 'Cache-Control': 'no-store', 'X-Correlation-ID': requestId } });
    } catch (error) {
      const code = error instanceof FunctionHttpError ? error.code : 'SQUARE_STORAGE_CHECKOUT_CREATE_FAILED';
      await context.env.ASTERA_DB.prepare(
        `UPDATE astera_storage_pack_intents SET status='failed', failure_code=?1, updated_at=?2 WHERE id=?3`,
      ).bind(code, new Date().toISOString(), intentId).run();
      throw error;
    }
  } catch (error) {
    return functionErrorResponse(error, requestId);
  }
}

export function onRequest(context: PagesContext): Promise<Response> {
  if (context.request.method !== 'POST') {
    return Promise.resolve(Response.json(
      { error: { code: 'METHOD_NOT_ALLOWED', message: 'POSTのみ対応しています。' } },
      { status: 405, headers: { Allow: 'POST' } },
    ));
  }
  return onRequestPost(context);
}
