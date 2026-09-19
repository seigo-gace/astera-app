import { loadActiveCatalogJson } from './catalog-load.js';

const LIVE_PLAN_STATES = new Set(['active', 'paused', 'grace', 'cancel_pending']);

function safeNonNegativeInteger(value: unknown, code: string): number {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < 0) {
    throw { status: 503, code, message: 'Storage容量を安全に計算できません。' };
  }
  return numeric;
}

export async function readActor(db: D1Database, tenantId: string, userId: string): Promise<Record<string, unknown>> {
  const profile = await db.prepare(
    `SELECT user_id, tenant_id, nickname, account_status, ui_language, created_at, updated_at
     FROM user_profiles WHERE user_id = ?1 AND tenant_id = ?2 LIMIT 1`,
  ).bind(userId, tenantId).first<Record<string, unknown>>();
  const credit = await db.prepare(
    `SELECT id, tenant_id, available_balance, reserved_balance, version, updated_at
     FROM credit_accounts WHERE tenant_id = ?1 LIMIT 1`,
  ).bind(tenantId).first<Record<string, unknown>>();
  if (!profile || !credit || profile.tenant_id !== tenantId) {
    throw { status: 503, code: 'BILLING_ACTOR_PROJECTION_UNAVAILABLE', message: 'Account Projectionを取得できません。' };
  }
  if (profile.account_status !== 'active') {
    throw { status: 403, code: `ACCOUNT_${String(profile.account_status).toUpperCase()}`, message: 'Accountの現在状態ではこの操作を実行できません。' };
  }
  return { profile, credit };
}

export async function readCatalog(db: D1Database): Promise<Record<string, unknown>> {
  return loadActiveCatalogJson(db);
}

export async function readSubscription(db: D1Database, tenantId: string): Promise<Record<string, unknown>> {
  const row = await db.prepare(
    `SELECT id, tenant_id, catalog_version, plan_id, billing_cycle, provider_subscription_id, status,
            current_period_start, current_period_end, cancel_at_period_end
     FROM tenant_subscriptions WHERE tenant_id = ?1 LIMIT 1`,
  ).bind(tenantId).first<Record<string, unknown>>();
  return { subscription: row ?? null };
}

export async function readIntent(db: D1Database, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const tenantId = typeof body.tenant_id === 'string' ? body.tenant_id.trim() : null;
  let row: Record<string, unknown> | null = null;
  if (typeof body.intent_id === 'string' && body.intent_id.trim()) {
    row = await db.prepare(
      `SELECT id, tenant_id, user_id, catalog_version, product_id, product_kind, billing_cycle, currency, amount, credit_amount,
              status, idempotency_key, provider_checkout_id, provider_order_id, provider_payment_id, checkout_url,
              return_context_id, expires_at, completed_at, failure_code, created_at, updated_at
       FROM billing_intents WHERE id = ?1 LIMIT 1`,
    ).bind(body.intent_id.trim()).first();
  } else if (typeof body.idempotency_key === 'string' && body.idempotency_key.trim()) {
    row = await db.prepare(
      `SELECT id, tenant_id, user_id, catalog_version, product_id, product_kind, billing_cycle, currency, amount, credit_amount,
              status, idempotency_key, provider_checkout_id, provider_order_id, provider_payment_id, checkout_url,
              return_context_id, expires_at, completed_at, failure_code, created_at, updated_at
       FROM billing_intents WHERE idempotency_key = ?1 LIMIT 1`,
    ).bind(body.idempotency_key.trim()).first();
  } else if (typeof body.provider_order_id === 'string' && body.provider_order_id.trim()) {
    row = await db.prepare(
      `SELECT id, tenant_id, user_id, catalog_version, product_id, product_kind, billing_cycle, currency, amount, credit_amount,
              status, idempotency_key, provider_checkout_id, provider_order_id, provider_payment_id, checkout_url,
              return_context_id, expires_at, completed_at, failure_code, created_at, updated_at
       FROM billing_intents WHERE provider_order_id = ?1 LIMIT 1`,
    ).bind(body.provider_order_id.trim()).first();
  } else if (typeof body.provider_payment_id === 'string' && body.provider_payment_id.trim()) {
    row = await db.prepare(
      `SELECT id, tenant_id, user_id, catalog_version, product_id, product_kind, billing_cycle, currency, amount, credit_amount,
              status, idempotency_key, provider_checkout_id, provider_order_id, provider_payment_id, checkout_url,
              return_context_id, expires_at, completed_at, failure_code, created_at, updated_at
       FROM billing_intents WHERE provider_payment_id = ?1 LIMIT 1`,
    ).bind(body.provider_payment_id.trim()).first();
  } else {
    throw { status: 400, code: 'SCHEMA_VALIDATION_FAILED', message: 'intent lookup key required.' };
  }
  if (!row) throw { status: 404, code: 'BILLING_INTENT_NOT_FOUND', message: 'Billing Intent not found.' };
  if (tenantId && row.tenant_id !== tenantId) throw { status: 404, code: 'BILLING_INTENT_NOT_FOUND', message: 'Billing Intent not found.' };
  return { intent: row };
}

export async function readStorageIntent(db: D1Database, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const tenantId = typeof body.tenant_id === 'string' ? body.tenant_id.trim() : null;
  let row: Record<string, unknown> | null = null;
  if (typeof body.intent_id === 'string' && body.intent_id.trim()) {
    row = await db.prepare(
      `SELECT id, tenant_id, user_id, catalog_version, product_id, capacity_gb, price_jpy, status, idempotency_key,
              provider_checkout_id, provider_order_id, provider_payment_id, checkout_url, expires_at, completed_at,
              failure_code, created_at, updated_at
       FROM astera_storage_pack_intents WHERE id = ?1 LIMIT 1`,
    ).bind(body.intent_id.trim()).first();
  } else if (typeof body.idempotency_key === 'string' && body.idempotency_key.trim()) {
    row = await db.prepare(
      `SELECT id, tenant_id, user_id, catalog_version, product_id, capacity_gb, price_jpy, status, idempotency_key,
              provider_checkout_id, provider_order_id, provider_payment_id, checkout_url, expires_at, completed_at,
              failure_code, created_at, updated_at
       FROM astera_storage_pack_intents WHERE idempotency_key = ?1 LIMIT 1`,
    ).bind(body.idempotency_key.trim()).first();
  } else if (typeof body.provider_order_id === 'string' && body.provider_order_id.trim()) {
    row = await db.prepare(
      `SELECT id, tenant_id, user_id, catalog_version, product_id, capacity_gb, price_jpy, status, idempotency_key,
              provider_checkout_id, provider_order_id, provider_payment_id, checkout_url, expires_at, completed_at,
              failure_code, created_at, updated_at
       FROM astera_storage_pack_intents WHERE provider_order_id = ?1 LIMIT 1`,
    ).bind(body.provider_order_id.trim()).first();
  } else {
    throw { status: 400, code: 'SCHEMA_VALIDATION_FAILED', message: 'storage intent lookup key required.' };
  }
  if (!row) throw { status: 404, code: 'STORAGE_INTENT_NOT_FOUND', message: 'Storage intent not found.' };
  if (tenantId && row.tenant_id !== tenantId) throw { status: 404, code: 'STORAGE_INTENT_NOT_FOUND', message: 'Storage intent not found.' };
  return { intent: row };
}

export async function readStorageCommerce(db: D1Database, tenantId: string): Promise<Record<string, unknown>> {
  const catalogVersionRow = await db.prepare(
    `SELECT version FROM catalog_versions WHERE status='active' LIMIT 1`,
  ).first<{ version: string }>();
  if (!catalogVersionRow?.version) throw { status: 503, code: 'ACTIVE_CATALOG_NOT_PUBLISHED', message: 'Active Catalogを確認できません。' };
  const catalogVersion = catalogVersionRow.version;
  const subscription = await db.prepare(
    `SELECT plan_id, status FROM tenant_subscriptions WHERE tenant_id=?1 LIMIT 1`,
  ).bind(tenantId).first<{ plan_id: string; status: string }>();
  let planId = 'free';
  if (subscription?.plan_id && LIVE_PLAN_STATES.has(subscription.status)) {
    planId = subscription.plan_id.trim().toLowerCase();
  }
  const [limit, legacy, purchased, packResult] = await Promise.all([
    db.prepare(
      `SELECT max_capacity_gb FROM astera_storage_plan_limits
       WHERE catalog_version=?1 AND plan_id=?2 AND active=1 LIMIT 1`,
    ).bind(catalogVersion, planId).first<{ max_capacity_gb: number }>(),
    db.prepare(
      `SELECT capacity_gb, state FROM astera_storage_contracts WHERE tenant_id=?1 LIMIT 1`,
    ).bind(tenantId).first<{ capacity_gb: number; state: string }>(),
    db.prepare(
      `SELECT COALESCE(SUM(capacity_gb),0) total FROM astera_storage_pack_purchases WHERE tenant_id=?1`,
    ).bind(tenantId).first<{ total: number }>(),
    db.prepare(
      `SELECT product_id, display_name, capacity_gb, price_jpy
       FROM astera_storage_pack_catalog WHERE catalog_version=?1 AND active=1
       ORDER BY display_order ASC, capacity_gb ASC`,
    ).bind(catalogVersion).all<{ product_id: string; display_name: string; capacity_gb: number; price_jpy: number }>(),
  ]);
  const planMaxCapacityGb = safeNonNegativeInteger(limit?.max_capacity_gb ?? 0, 'STORAGE_PLAN_LIMIT_INVALID');
  const legacyCapacityGb = safeNonNegativeInteger(legacy?.capacity_gb ?? 0, 'STORAGE_LEGACY_CAPACITY_INVALID');
  const purchasedCapacityGb = safeNonNegativeInteger(purchased?.total ?? 0, 'STORAGE_PURCHASE_CAPACITY_INVALID');
  const currentCapacityGb = legacyCapacityGb + purchasedCapacityGb;
  const remainingCapacityGb = Math.max(0, planMaxCapacityGb - currentCapacityGb);
  const packs = (packResult.results ?? []).map((row) => {
    const capacityGb = safeNonNegativeInteger(row.capacity_gb, 'STORAGE_PACK_CAPACITY_INVALID');
    const priceJpy = safeNonNegativeInteger(row.price_jpy, 'STORAGE_PACK_PRICE_INVALID');
    return {
      productId: row.product_id,
      displayName: row.display_name,
      capacityGb,
      priceJpy,
      canPurchase: planId !== 'free' && planMaxCapacityGb > 0 && capacityGb <= remainingCapacityGb,
    };
  });
  return {
    commerce: {
      catalogVersion,
      planId,
      planMaxCapacityGb,
      legacyCapacityGb,
      purchasedCapacityGb,
      currentCapacityGb,
      remainingCapacityGb,
      packs,
    },
  };
}

export async function readStorageProduct(db: D1Database, catalogVersion: string, productId: string): Promise<Record<string, unknown>> {
  const row = await db.prepare(
    `SELECT product_id, display_name, capacity_gb, price_jpy
     FROM astera_storage_pack_catalog WHERE catalog_version=?1 AND product_id=?2 AND active=1 LIMIT 1`,
  ).bind(catalogVersion, productId).first<{ product_id: string; display_name: string; capacity_gb: number; price_jpy: number }>();
  if (!row) throw { status: 422, code: 'STORAGE_PACK_NOT_AVAILABLE', message: 'Storage pack not available.' };
  return {
    product: {
      productId: row.product_id,
      displayName: row.display_name,
      capacityGb: safeNonNegativeInteger(row.capacity_gb, 'STORAGE_PACK_CAPACITY_INVALID'),
      priceJpy: safeNonNegativeInteger(row.price_jpy, 'STORAGE_PACK_PRICE_INVALID'),
    },
  };
}

export async function readPendingStorageCapacity(db: D1Database, tenantId: string, nowIso: string): Promise<Record<string, unknown>> {
  const pending = await db.prepare(
    `SELECT COALESCE(SUM(capacity_gb),0) total
     FROM astera_storage_pack_intents
     WHERE tenant_id=?1
       AND status IN ('creating_checkout','checkout_created','payment_pending')
       AND (expires_at IS NULL OR expires_at > ?2)`,
  ).bind(tenantId, nowIso).first<{ total: number }>();
  return { pending_capacity_gb: Number(pending?.total ?? 0) };
}

export async function readPendingPlanIntents(
  db: D1Database,
  tenantId: string,
  nowIso: string,
  limitRaw: unknown,
): Promise<Record<string, unknown>> {
  const limit = Math.min(Math.max(Number(limitRaw) || 1, 1), 50);
  const result = await db.prepare(
    `SELECT id, tenant_id, user_id, catalog_version, product_id, product_kind, billing_cycle, currency, amount, credit_amount,
            status, idempotency_key, provider_checkout_id, provider_order_id, provider_payment_id, checkout_url,
            return_context_id, expires_at, completed_at, failure_code, created_at, updated_at
     FROM billing_intents
     WHERE tenant_id = ?1
       AND product_kind = 'plan'
       AND status IN ('creating_checkout','checkout_created','payment_pending','reconciliation_required')
       AND (expires_at IS NULL OR expires_at > ?2)
     ORDER BY created_at DESC
     LIMIT ?3`,
  ).bind(tenantId, nowIso, limit).all();
  return { intents: result.results ?? [] };
}

export async function readLedgerGrant(
  db: D1Database,
  creditAccountId: string,
  referenceType: string,
  referenceId: string,
): Promise<Record<string, unknown>> {
  const row = await db.prepare(
    `SELECT transaction_id, amount, created_at
     FROM credit_ledger
     WHERE credit_account_id = ?1 AND reference_type = ?2 AND reference_id = ?3 AND kind = 'grant'
     LIMIT 1`,
  ).bind(creditAccountId, referenceType, referenceId).first<Record<string, unknown>>();
  if (!row) throw { status: 404, code: 'LEDGER_GRANT_NOT_FOUND', message: 'Grant not found.' };
  return { grant: row };
}

export async function readEvent(db: D1Database, providerEventId: string): Promise<Record<string, unknown>> {
  const billingEvent = await db.prepare(
    `SELECT provider_event_id, billing_intent_id, processing_status, event_type, received_at, processed_at
     FROM billing_events WHERE provider_event_id = ?1 LIMIT 1`,
  ).bind(providerEventId).first<Record<string, unknown>>();
  if (billingEvent) return { source: 'billing_events', event: billingEvent };
  const projection = await db.prepare(
    `SELECT provider_event_id, billing_intent_id, processing_status, event_type, recorded_at
     FROM billing_event_projections WHERE provider_event_id = ?1 LIMIT 1`,
  ).bind(providerEventId).first<Record<string, unknown>>();
  if (projection) return { source: 'billing_event_projections', event: projection };
  throw { status: 404, code: 'EVENT_NOT_FOUND', message: 'Event not found.' };
}

export async function readSignupBonus(db: D1Database, creditAccountId: string, tenantId: string): Promise<Record<string, unknown>> {
  const row = await db.prepare(
    `SELECT transaction_id FROM credit_ledger
     WHERE credit_account_id = ?1 AND reference_type = 'tenant_free_signup_bonus' AND reference_id = ?2 LIMIT 1`,
  ).bind(creditAccountId, tenantId).first<{ transaction_id: string }>();
  return { exists: Boolean(row?.transaction_id), grant: row ?? null };
}

export async function readProfileCreatedAt(db: D1Database, tenantId: string): Promise<Record<string, unknown>> {
  const row = await db.prepare(
    `SELECT created_at FROM user_profiles WHERE tenant_id = ?1 LIMIT 1`,
  ).bind(tenantId).first<{ created_at: string }>();
  if (!row?.created_at) throw { status: 404, code: 'PROFILE_NOT_FOUND', message: 'Profile not found.' };
  return { created_at: row.created_at };
}

export async function readCreditAccount(db: D1Database, creditAccountId: string): Promise<Record<string, unknown>> {
  const row = await db.prepare(
    `SELECT id, tenant_id, available_balance, reserved_balance, version, updated_at
     FROM credit_accounts WHERE id = ?1 LIMIT 1`,
  ).bind(creditAccountId).first<Record<string, unknown>>();
  if (!row) throw { status: 404, code: 'CREDIT_ACCOUNT_NOT_FOUND', message: 'Credit account not found.' };
  return { credit: row };
}
