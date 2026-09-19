import {
  FunctionHttpError,
  functionErrorResponse,
  requestCorrelationId,
  type BillingServiceEnv,
} from '../part/billing-env.js';
import { requireBillingActor } from '../feature/billing-auth.js';
import { requireProjectionClient } from '../feature/astera-projection.js';
import {
  runSquareStorageCheckout,
  storageIntentRetryable,
  type BillingIntentRow,
} from '../feature/checkout-intent-recovery.js';
import { storagePurchaseWithinPlanLimit } from '../feature/storage-capacity-guard.js';
import { createLibralVaultClientFromEnv } from '../feature/libral-vault.js';

type Body = { product_id?: unknown };

type ExistingIntent = BillingIntentRow;

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function idempotencyKey(request: Request): string {
  const value = request.headers.get('Idempotency-Key')?.trim();
  if (!value) throw new FunctionHttpError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Keyが必要です。');
  if (value.length > 192) throw new FunctionHttpError(400, 'IDEMPOTENCY_KEY_TOO_LONG', 'Idempotency-Keyは192文字以内です。');
  return value;
}

export async function handleStorageCheckoutIntents(request: Request, env: BillingServiceEnv): Promise<Response> {
  const requestId = requestCorrelationId(request.headers);
  try {
    const projection = requireProjectionClient(env);
    const actor = await requireBillingActor(request, env);
    const key = idempotencyKey(request);
    const body = await request.json().catch(() => null) as Body | null;
    const productId = text(body?.product_id);
    if (!productId) throw new FunctionHttpError(422, 'STORAGE_PRODUCT_REQUIRED', 'Storage Packを選択してください。');

    const vault = env.vault ?? createLibralVaultClientFromEnv(env);
    if (!vault) throw new FunctionHttpError(503, 'VAULT_NOT_CONFIGURED', 'Vault internal clientが設定されていません。');

    const existingRow = await projection.getStorageIntentByIdempotency(key);
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
      if (storageIntentRetryable(existing)) {
        const commerce = await projection.getStorageCommerce(actor.profile.tenant_id);
        const retryProductId = text((existing as { product_id?: unknown }).product_id) || productId;
        const product = await projection.getStorageProduct(commerce.catalogVersion, retryProductId);
        const square = await runSquareStorageCheckout(
          { env, vault, projection },
          actor,
          {
            intentId: existing.id,
            idempotencyKey: key,
            correlationId: requestId,
            displayName: `Astera Storage ${product.displayName}`,
            amount: product.priceJpy,
          },
        );
        await projection.postStorageIntentCheckoutCreated({
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
      throw new FunctionHttpError(409, 'STORAGE_CHECKOUT_INTENT_IN_PROGRESS', '同じStorage Checkoutを作成中です。');
    }

    const commerce = await projection.getStorageCommerce(actor.profile.tenant_id);
    if (commerce.planId === 'free' || commerce.planMaxCapacityGb <= 0) {
      throw new FunctionHttpError(403, 'STORAGE_PLAN_NOT_ELIGIBLE', '現在のPlanではAstera Storageを購入できません。');
    }
    const product = await projection.getStorageProduct(commerce.catalogVersion, productId);
    const nowIso = new Date().toISOString();
    const pendingCapacityGb = await projection.getPendingStorageCapacityGb(actor.profile.tenant_id, nowIso);
    if (!storagePurchaseWithinPlanLimit(
      commerce.currentCapacityGb,
      pendingCapacityGb,
      product.capacityGb,
      commerce.planMaxCapacityGb,
    )) {
      throw new FunctionHttpError(409, 'STORAGE_PLAN_CAPACITY_EXCEEDED', 'このStorage Packを追加すると現在PlanのStorage上限を超えます。');
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
    const intentId = crypto.randomUUID();
    await projection.postStorageIntentCreate({
      intent_id: intentId,
      tenant_id: actor.profile.tenant_id,
      user_id: actor.user.id,
      catalog_version: commerce.catalogVersion,
      product_id: product.productId,
      capacity_gb: product.capacityGb,
      price_jpy: product.priceJpy,
      idempotency_key: key,
      expires_at: expiresAt,
      created_at: now.toISOString(),
    });

    const square = await runSquareStorageCheckout(
      { env, vault, projection },
      actor,
      {
        intentId,
        idempotencyKey: key,
        correlationId: requestId,
        displayName: `Astera Storage ${product.displayName}`,
        amount: product.priceJpy,
      },
    );
    await projection.postStorageIntentCheckoutCreated({
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
      expires_at: expiresAt,
      catalog_version: commerce.catalogVersion,
      capacity_gb: product.capacityGb,
      price_jpy: product.priceJpy,
    }, { status: 201, headers: { 'Cache-Control': 'no-store', 'X-Correlation-ID': requestId } });
  } catch (error) {
    return functionErrorResponse(error, requestId);
  }
}
