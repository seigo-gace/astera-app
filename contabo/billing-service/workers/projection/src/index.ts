import {
  readActor,
  readCatalog,
  readSubscription,
  readIntent,
  readStorageIntent,
  readStorageCommerce,
  readStorageProduct,
  readPendingStorageCapacity,
  readPendingPlanIntents,
  readLedgerGrant,
  readEvent,
  readSignupBonus,
  readProfileCreatedAt,
  readCreditAccount,
} from './billing-read-write.js';
import {
  writeIntentCreate,
  writeIntentCheckoutCreated,
  writeStorageIntentCreate,
  writeStorageIntentCheckoutCreated,
  writeStorageIntentFailed,
  writeStorageIntentPayment,
  writeIntentPaymentApply,
  writeEventStartProcessing,
  writeEventGetMeta,
  writeWebhookInvoicePayment,
  writeWebhookSubscription,
  writeWebhookIntentReconciliation,
  writeWebhookInvoiceProjection,
  writeWebhookPayoutRecorded,
} from './billing-writes.js';

export interface Env {
  ASTERA_DB: D1Database;
  BILLING_PROJECTION_SECRET: string;
}

type BillingOperation =
  | 'projections.events'
  | 'projections.subscriptions'
  | 'grants.credits'
  | 'grants.storage'
  | 'intents.status';

const PII_FIELD_PATTERN = /^(email|e_mail|phone|phone_number|customer_email|customer_name|given_name|family_name|address|billing_address|card_.*)$/i;

const INTENT_TRANSITIONS: Record<string, readonly string[]> = {
  creating_checkout: ['checkout_created', 'failed', 'cancelled'],
  checkout_created: ['payment_pending', 'completed', 'failed', 'cancelled', 'reconciliation_required'],
  payment_pending: ['completed', 'failed', 'cancelled', 'reconciliation_required'],
  reconciliation_required: ['completed', 'failed', 'cancelled'],
  pending: ['processing', 'failed'],
  processing: ['completed', 'failed'],
  completed: ['refunded', 'disputed'],
  failed: [],
  cancelled: [],
  refunded: ['disputed'],
  disputed: [],
};

const SUBSCRIPTION_STATUSES = new Set(['pending', 'active', 'past_due', 'canceled', 'paused']);

function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i += 1) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

function jsonError(status: number, code: string, message: string, correlationId: string): Response {
  return Response.json(
    { error: { code, message, correlation_id: correlationId, retryable: status >= 500 } },
    { status, headers: { 'Cache-Control': 'no-store', 'X-Correlation-ID': correlationId } },
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rejectPiiKeys(record: Record<string, unknown>): void {
  for (const key of Object.keys(record)) {
    if (PII_FIELD_PATTERN.test(key)) {
      throw { status: 400, code: 'PII_FIELD_FORBIDDEN', message: 'PIIフィールドは受け付けません。' };
    }
  }
}

function parseStrictObject(raw: unknown, allowedKeys: readonly string[]): Record<string, unknown> {
  if (!isRecord(raw)) throw { status: 400, code: 'INVALID_JSON', message: 'JSONオブジェクトが必要です。' };
  rejectPiiKeys(raw);
  for (const key of Object.keys(raw)) {
    if (!allowedKeys.includes(key)) {
      throw { status: 400, code: 'UNKNOWN_FIELD', message: `未知のフィールド: ${key}` };
    }
  }
  return raw;
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw { status: 400, code: 'SCHEMA_VALIDATION_FAILED', message: `${key} が必要です。` };
  }
  return value.trim();
}

function optionalString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw { status: 400, code: 'SCHEMA_VALIDATION_FAILED', message: `${key} は文字列または null である必要があります。` };
  return value.trim() || null;
}

function optionalInteger(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  if (value === null || value === undefined) return null;
  if (!Number.isSafeInteger(value)) throw { status: 400, code: 'SCHEMA_VALIDATION_FAILED', message: `${key} は整数である必要があります。` };
  return value;
}

function requiredInteger(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (!Number.isSafeInteger(value)) throw { status: 400, code: 'SCHEMA_VALIDATION_FAILED', message: `${key} は整数である必要があります。` };
  return value;
}

function requiredBoolean(record: Record<string, unknown>, key: string): boolean {
  const value = record[key];
  if (typeof value !== 'boolean') throw { status: 400, code: 'SCHEMA_VALIDATION_FAILED', message: `${key} は boolean である必要があります。` };
  return value;
}

function assertProjectionAuth(request: Request, env: Env): void {
  const configured = env.BILLING_PROJECTION_SECRET?.trim();
  if (!configured) throw { status: 503, code: 'BILLING_PROJECTION_SECRET_MISSING', message: 'Projection secret missing.' };
  const header = request.headers.get('Authorization')?.trim() ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  const provided = match?.[1] ?? '';
  if (!provided || !timingSafeEqual(provided, configured)) {
    throw { status: 401, code: 'BILLING_PROJECTION_UNAUTHORIZED', message: 'Projection認証に失敗しました。' };
  }
}

async function validateTenantUser(db: D1Database, tenantId: string, userId: string): Promise<void> {
  const tenant = await db.prepare('SELECT id FROM tenants WHERE id = ?1 LIMIT 1').bind(tenantId).first<{ id: string }>();
  if (!tenant?.id) throw { status: 422, code: 'TENANT_NOT_FOUND', message: 'tenant_id を確認できません。' };
  const profile = await db.prepare(
    'SELECT user_id FROM user_profiles WHERE user_id = ?1 AND tenant_id = ?2 LIMIT 1',
  ).bind(userId, tenantId).first<{ user_id: string }>();
  if (!profile?.user_id) throw { status: 422, code: 'USER_TENANT_MISMATCH', message: 'user_id と tenant_id の組み合わせを確認できません。' };
}

async function loadIdempotentResponse(
  db: D1Database,
  operation: BillingOperation,
  idempotencyKey: string,
  fingerprint: string,
): Promise<Record<string, unknown> | null> {
  const row = await db.prepare(
    `SELECT request_fingerprint, response_json FROM billing_internal_idempotency
     WHERE operation = ?1 AND idempotency_key = ?2 LIMIT 1`,
  ).bind(operation, idempotencyKey).first<{ request_fingerprint: string; response_json: string }>();
  if (!row) return null;
  if (row.request_fingerprint !== fingerprint) {
    throw { status: 409, code: 'IDEMPOTENCY_KEY_REUSED', message: 'idempotency_key が別リクエストで使用されています。' };
  }
  return JSON.parse(row.response_json) as Record<string, unknown>;
}

async function storeIdempotentResponse(
  db: D1Database,
  operation: BillingOperation,
  idempotencyKey: string,
  correlationId: string,
  fingerprint: string,
  response: Record<string, unknown>,
): Promise<void> {
  const now = new Date().toISOString();
  await db.prepare(
    `INSERT OR IGNORE INTO billing_internal_idempotency
      (operation, idempotency_key, correlation_id, request_fingerprint, response_json, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
  ).bind(operation, idempotencyKey, correlationId, fingerprint, JSON.stringify(response), now).run();
}

async function applyCreditGrant(
  db: D1Database,
  creditAccountId: string,
  amount: number,
  referenceType: string,
  referenceId: string,
  idempotencyKey: string,
  fingerprint: string,
): Promise<'granted' | 'duplicate'> {
  const existing = await db.prepare(
    `SELECT transaction_id FROM credit_ledger WHERE idempotency_key = ?1 LIMIT 1`,
  ).bind(idempotencyKey).first<{ transaction_id: string }>();
  if (existing?.transaction_id) return 'duplicate';
  if (!Number.isSafeInteger(amount) || amount <= 0) return 'duplicate';
  const now = new Date().toISOString();
  const transactionId = `grant:${referenceType}:${referenceId}`;
  const batchResult = await db.batch([
    db.prepare(
      `UPDATE credit_accounts
       SET available_balance = available_balance + ?1, version = version + 1, updated_at = ?2
       WHERE id = ?3
         AND NOT EXISTS (
           SELECT 1 FROM credit_ledger
           WHERE reference_type = ?4 AND reference_id = ?5 AND kind = 'grant'
         )`,
    ).bind(amount, now, creditAccountId, referenceType, referenceId),
    db.prepare(
      `INSERT OR IGNORE INTO credit_ledger
        (transaction_id, credit_account_id, kind, amount, idempotency_key, reference_type, reference_id, request_fingerprint, created_at)
       VALUES (?1, ?2, 'grant', ?3, ?4, ?5, ?6, ?7, ?8)`,
    ).bind(transactionId, creditAccountId, amount, idempotencyKey, referenceType, referenceId, fingerprint, now),
  ]);
  const updated = Number(batchResult[0]?.meta?.changes ?? 0);
  const inserted = Number(batchResult[1]?.meta?.changes ?? 0);
  if (updated > 0 && inserted > 0) return 'granted';
  return 'duplicate';
}

async function loadActiveCatalogVersion(db: D1Database): Promise<string> {
  const row = await db.prepare(
    `SELECT version FROM catalog_versions WHERE status = 'active' ORDER BY published_at DESC LIMIT 1`,
  ).first<{ version: string }>();
  if (!row?.version) throw { status: 503, code: 'CATALOG_UNAVAILABLE', message: 'Active catalog unavailable.' };
  return row.version;
}

async function expectedMonthlyIncludedCredits(db: D1Database, catalogVersion: string, planId: string): Promise<number> {
  const variant = await db.prepare(
    `SELECT included_credits FROM plan_billing_variants
     WHERE catalog_version = ?1 AND plan_id = ?2 AND billing_cycle = 'monthly' AND active = 1 LIMIT 1`,
  ).bind(catalogVersion, planId).first<{ included_credits: number }>();
  if (variant?.included_credits != null && Number(variant.included_credits) > 0) {
    return Number(variant.included_credits);
  }
  const planRow = await db.prepare(
    `SELECT included_credits FROM plan_catalog_entries
     WHERE catalog_version = ?1 AND plan_id = ?2 AND active = 1 LIMIT 1`,
  ).bind(catalogVersion, planId).first<{ included_credits: number }>();
  return Number(planRow?.included_credits ?? 0);
}

async function verifyGrantAmount(
  db: D1Database,
  referenceType: string,
  amount: number,
  tenantId: string,
): Promise<void> {
  const catalogVersion = await loadActiveCatalogVersion(db);
  if (referenceType === 'tenant_free_signup_bonus') {
    if (amount !== 10_000) throw { status: 422, code: 'GRANT_AMOUNT_MISMATCH', message: 'signup bonus amount invalid.' };
    return;
  }
  if (referenceType === 'tenant_free_first_month') {
    const planRow = await db.prepare(
      `SELECT included_credits FROM plan_catalog_entries
       WHERE catalog_version = ?1 AND plan_id = 'free' AND active = 1 LIMIT 1`,
    ).bind(catalogVersion).first<{ included_credits: number }>();
    const expected = Number(planRow?.included_credits ?? 10_000);
    if (amount !== expected) throw { status: 422, code: 'GRANT_AMOUNT_MISMATCH', message: 'included credits amount invalid.' };
    return;
  }
  if (referenceType === 'plan_monthly_included') {
    const subscription = await db.prepare(
      `SELECT plan_id FROM tenant_subscriptions WHERE tenant_id = ?1 LIMIT 1`,
    ).bind(tenantId).first<{ plan_id: string }>();
    const planId = subscription?.plan_id?.trim().toLowerCase() || 'free';
    const expected = await expectedMonthlyIncludedCredits(db, catalogVersion, planId);
    if (expected <= 0 || amount !== expected) {
      throw { status: 422, code: 'GRANT_AMOUNT_MISMATCH', message: 'included credits amount invalid.' };
    }
    return;
  }
  if (referenceType === 'billing_intent') return;
}

function isEntitlementNeutralEventType(eventType: string): boolean {
  return /refund|dispute|payout/.test(eventType.toLowerCase());
}

async function handleEventProjection(db: D1Database, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const parsed = parseStrictObject(body, [
    'idempotency_key', 'correlation_id', 'tenant_id', 'user_id', 'provider_event_id', 'event_type',
    'object_kind', 'object_id', 'status', 'amount', 'currency', 'provider_created_at', 'billing_intent_id', 'processing_status',
  ]);
  const idempotencyKey = requiredString(parsed, 'idempotency_key');
  const correlationId = requiredString(parsed, 'correlation_id');
  const tenantId = requiredString(parsed, 'tenant_id');
  const userId = requiredString(parsed, 'user_id');
  const providerEventId = requiredString(parsed, 'provider_event_id');
  const eventType = requiredString(parsed, 'event_type');
  const objectKind = requiredString(parsed, 'object_kind');
  const processingStatus = requiredString(parsed, 'processing_status');
  if (tenantId !== 'system:billing' || userId !== 'system:billing') {
    await validateTenantUser(db, tenantId, userId);
  }

  const existingByKey = await db.prepare(
    `SELECT provider_event_id, processing_status FROM billing_event_projections WHERE idempotency_key = ?1 LIMIT 1`,
  ).bind(idempotencyKey).first<{ provider_event_id: string; processing_status: string }>();
  if (existingByKey) {
    return { accepted: true, duplicate: true, provider_event_id: existingByKey.provider_event_id, processing_status: existingByKey.processing_status, correlation_id: correlationId };
  }

  const existingEvent = await db.prepare(
    `SELECT idempotency_key FROM billing_event_projections WHERE provider_event_id = ?1 LIMIT 1`,
  ).bind(providerEventId).first<{ idempotency_key: string }>();
  if (existingEvent && existingEvent.idempotency_key !== idempotencyKey) {
    throw { status: 409, code: 'PROVIDER_EVENT_ID_CONFLICT', message: 'provider_event_id conflict.' };
  }
  if (existingEvent) {
    return { accepted: true, duplicate: true, provider_event_id: providerEventId, processing_status: processingStatus, correlation_id: correlationId };
  }

  if (!isEntitlementNeutralEventType(eventType)) {
    // projection-only; entitlements via grant routes
  }

  const now = new Date().toISOString();
  await db.prepare(
    `INSERT INTO billing_event_projections
      (provider_event_id, idempotency_key, correlation_id, tenant_id, event_type, object_kind, object_id,
       status, amount, currency, provider_created_at, billing_intent_id, processing_status, recorded_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`,
  ).bind(
    providerEventId, idempotencyKey, correlationId, tenantId === 'system:billing' ? null : tenantId,
    eventType, objectKind, optionalString(parsed, 'object_id'), optionalString(parsed, 'status'),
    optionalInteger(parsed, 'amount'), optionalString(parsed, 'currency'), optionalString(parsed, 'provider_created_at'),
    optionalString(parsed, 'billing_intent_id'), processingStatus, now,
  ).run();

  return { accepted: true, duplicate: false, provider_event_id: providerEventId, processing_status: processingStatus, correlation_id: correlationId };
}

async function handleSubscriptionProjection(db: D1Database, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const parsed = parseStrictObject(body, [
    'idempotency_key', 'correlation_id', 'tenant_id', 'user_id', 'catalog_version', 'plan_id', 'billing_cycle',
    'provider_subscription_id', 'status', 'current_period_start', 'current_period_end', 'cancel_at_period_end',
  ]);
  const idempotencyKey = requiredString(parsed, 'idempotency_key');
  const correlationId = requiredString(parsed, 'correlation_id');
  const tenantId = requiredString(parsed, 'tenant_id');
  const userId = requiredString(parsed, 'user_id');
  const catalogVersion = requiredString(parsed, 'catalog_version');
  const planId = requiredString(parsed, 'plan_id');
  const billingCycle = requiredString(parsed, 'billing_cycle');
  if (billingCycle !== 'monthly' && billingCycle !== 'annual') {
    throw { status: 400, code: 'SCHEMA_VALIDATION_FAILED', message: 'billing_cycle invalid.' };
  }
  const status = requiredString(parsed, 'status');
  if (!SUBSCRIPTION_STATUSES.has(status)) {
    throw { status: 400, code: 'SUBSCRIPTION_STATUS_INVALID', message: 'subscription status invalid.' };
  }
  const cancelAtPeriodEnd = requiredBoolean(parsed, 'cancel_at_period_end');
  await validateTenantUser(db, tenantId, userId);

  const planExists = await db.prepare(
    `SELECT plan_id FROM plan_catalog_entries WHERE catalog_version = ?1 AND plan_id = ?2 AND active = 1 LIMIT 1`,
  ).bind(catalogVersion, planId).first<{ plan_id: string }>();
  if (!planExists?.plan_id) throw { status: 422, code: 'PLAN_NOT_IN_CATALOG', message: 'plan_id not in catalog.' };

  const variantExists = await db.prepare(
    `SELECT billing_cycle FROM plan_billing_variants WHERE catalog_version = ?1 AND plan_id = ?2 AND billing_cycle = ?3 LIMIT 1`,
  ).bind(catalogVersion, planId, billingCycle).first<{ billing_cycle: string }>();
  if (!variantExists?.billing_cycle) throw { status: 422, code: 'BILLING_CYCLE_NOT_IN_CATALOG', message: 'billing_cycle not in catalog.' };

  const existing = await db.prepare(
    `SELECT tenant_id, plan_id, status FROM billing_subscription_projections WHERE idempotency_key = ?1 LIMIT 1`,
  ).bind(idempotencyKey).first<{ tenant_id: string; plan_id: string; status: string }>();
  if (existing) {
    return { accepted: true, duplicate: true, tenant_id: existing.tenant_id, plan_id: existing.plan_id, status: existing.status, correlation_id: correlationId };
  }

  const now = new Date().toISOString();
  const providerSubscriptionId = optionalString(parsed, 'provider_subscription_id');
  const periodStart = optionalString(parsed, 'current_period_start');
  const periodEnd = optionalString(parsed, 'current_period_end');

  const subscriptionRow = await db.prepare(`SELECT id, status FROM tenant_subscriptions WHERE tenant_id = ?1 LIMIT 1`).bind(tenantId).first<{ id: string; status: string }>();
  if (subscriptionRow?.status && subscriptionRow.status !== status) {
    // allow updates; invalid transitions could be enforced here with 409 if needed
  }

  const statements = [
    db.prepare(
      `INSERT INTO billing_subscription_projections
        (idempotency_key, correlation_id, tenant_id, user_id, catalog_version, plan_id, billing_cycle,
         provider_subscription_id, status, current_period_start, current_period_end, cancel_at_period_end, recorded_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`,
    ).bind(idempotencyKey, correlationId, tenantId, userId, catalogVersion, planId, billingCycle, providerSubscriptionId, status, periodStart, periodEnd, cancelAtPeriodEnd ? 1 : 0, now),
  ];

  if (subscriptionRow?.id) {
    statements.push(
      db.prepare(
        `UPDATE tenant_subscriptions SET catalog_version = ?1, plan_id = ?2, billing_cycle = ?3, provider_subscription_id = ?4,
         status = ?5, current_period_start = ?6, current_period_end = ?7, cancel_at_period_end = ?8, updated_at = ?9 WHERE id = ?10`,
      ).bind(catalogVersion, planId, billingCycle, providerSubscriptionId, status, periodStart, periodEnd, cancelAtPeriodEnd ? 1 : 0, now, subscriptionRow.id),
    );
  } else {
    statements.push(
      db.prepare(
        `INSERT INTO tenant_subscriptions
          (id, tenant_id, catalog_version, plan_id, billing_cycle, provider_subscription_id, status,
           current_period_start, current_period_end, cancel_at_period_end, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)`,
      ).bind(`sub:${tenantId}`, tenantId, catalogVersion, planId, billingCycle, providerSubscriptionId, status, periodStart, periodEnd, cancelAtPeriodEnd ? 1 : 0, now),
    );
  }
  await db.batch(statements);
  return { accepted: true, duplicate: false, tenant_id: tenantId, plan_id: planId, status, correlation_id: correlationId };
}

async function handleCreditGrant(db: D1Database, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const parsed = parseStrictObject(body, [
    'idempotency_key', 'correlation_id', 'tenant_id', 'user_id', 'credit_account_id', 'amount', 'reference_type', 'reference_id', 'billing_intent_id',
  ]);
  const idempotencyKey = requiredString(parsed, 'idempotency_key');
  const correlationId = requiredString(parsed, 'correlation_id');
  const tenantId = requiredString(parsed, 'tenant_id');
  const userId = requiredString(parsed, 'user_id');
  const creditAccountId = requiredString(parsed, 'credit_account_id');
  const amount = requiredInteger(parsed, 'amount');
  const referenceType = requiredString(parsed, 'reference_type');
  const referenceId = requiredString(parsed, 'reference_id');
  await validateTenantUser(db, tenantId, userId);
  if (amount <= 0) throw { status: 400, code: 'GRANT_AMOUNT_INVALID', message: 'amount must be > 0.' };
  await verifyGrantAmount(db, referenceType, amount, tenantId);

  const fingerprint = JSON.stringify({
    tenant_id: tenantId, credit_account_id: creditAccountId, amount, reference_type: referenceType,
    reference_id: referenceId, billing_intent_id: optionalString(parsed, 'billing_intent_id'),
  });
  const replay = await loadIdempotentResponse(db, 'grants.credits', idempotencyKey, fingerprint);
  if (replay) {
    return { ...replay, duplicate: true, granted: false };
  }

  const credit = await db.prepare('SELECT id, tenant_id FROM credit_accounts WHERE id = ?1 LIMIT 1').bind(creditAccountId).first<{ id: string; tenant_id: string }>();
  if (!credit?.id || credit.tenant_id !== tenantId) throw { status: 422, code: 'CREDIT_ACCOUNT_MISMATCH', message: 'credit_account_id invalid.' };

  const outcome = await applyCreditGrant(db, creditAccountId, amount, referenceType, referenceId, idempotencyKey, fingerprint);
  const response = { accepted: true, duplicate: outcome === 'duplicate', granted: outcome === 'granted', correlation_id: correlationId };
  await storeIdempotentResponse(db, 'grants.credits', idempotencyKey, correlationId, fingerprint, response);
  return response;
}

async function handleStorageGrant(db: D1Database, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const parsed = parseStrictObject(body, [
    'idempotency_key', 'correlation_id', 'tenant_id', 'user_id', 'storage_intent_id', 'provider_order_id', 'provider_payment_id',
  ]);
  const idempotencyKey = requiredString(parsed, 'idempotency_key');
  const correlationId = requiredString(parsed, 'correlation_id');
  const tenantId = requiredString(parsed, 'tenant_id');
  const userId = requiredString(parsed, 'user_id');
  const storageIntentId = requiredString(parsed, 'storage_intent_id');
  const providerOrderId = requiredString(parsed, 'provider_order_id');
  const providerPaymentId = optionalString(parsed, 'provider_payment_id');
  await validateTenantUser(db, tenantId, userId);

  const fingerprint = JSON.stringify({ tenant_id: tenantId, storage_intent_id: storageIntentId, provider_order_id: providerOrderId, provider_payment_id: providerPaymentId });
  const replay = await loadIdempotentResponse(db, 'grants.storage', idempotencyKey, fingerprint);
  if (replay) return replay;

  const intent = await db.prepare(
    `SELECT id, tenant_id, user_id, catalog_version, product_id, capacity_gb, price_jpy, status
     FROM astera_storage_pack_intents WHERE id = ?1 AND tenant_id = ?2 LIMIT 1`,
  ).bind(storageIntentId, tenantId).first<{ id: string; tenant_id: string; user_id: string; catalog_version: string; product_id: string; capacity_gb: number; price_jpy: number; status: string }>();
  if (!intent?.id) throw { status: 422, code: 'STORAGE_INTENT_NOT_FOUND', message: 'storage_intent_id invalid.' };
  if (intent.user_id !== userId) throw { status: 422, code: 'STORAGE_INTENT_USER_MISMATCH', message: 'user mismatch.' };

  const existingPurchase = await db.prepare(
    `SELECT id FROM astera_storage_pack_purchases WHERE provider_order_id = ?1 LIMIT 1`,
  ).bind(providerOrderId).first<{ id: string }>();

  const now = new Date().toISOString();
  if (!existingPurchase?.id) {
    await db.batch([
      db.prepare(
        `INSERT OR IGNORE INTO astera_storage_pack_purchases
          (id, tenant_id, user_id, catalog_version, product_id, capacity_gb, price_jpy, provider_order_id, provider_payment_id, purchased_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
      ).bind(intent.id, intent.tenant_id, intent.user_id, intent.catalog_version, intent.product_id, Number(intent.capacity_gb), Number(intent.price_jpy), providerOrderId, providerPaymentId, now),
      db.prepare(
        `UPDATE astera_storage_pack_intents SET status = 'completed', provider_order_id = ?1, provider_payment_id = ?2,
         completed_at = COALESCE(completed_at, ?3), failure_code = NULL, updated_at = ?3 WHERE id = ?4`,
      ).bind(providerOrderId, providerPaymentId, now, intent.id),
    ]);
  }

  const response = { accepted: true, duplicate: Boolean(existingPurchase?.id), granted: !existingPurchase?.id, correlation_id: correlationId };
  await storeIdempotentResponse(db, 'grants.storage', idempotencyKey, correlationId, fingerprint, response);
  return response;
}

async function handleIntentStatus(db: D1Database, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const parsed = parseStrictObject(body, [
    'idempotency_key', 'correlation_id', 'tenant_id', 'user_id', 'billing_intent_id', 'status', 'provider_payment_id', 'failure_code',
  ]);
  const idempotencyKey = requiredString(parsed, 'idempotency_key');
  const correlationId = requiredString(parsed, 'correlation_id');
  const tenantId = requiredString(parsed, 'tenant_id');
  const userId = requiredString(parsed, 'user_id');
  const billingIntentId = requiredString(parsed, 'billing_intent_id');
  const status = requiredString(parsed, 'status');
  await validateTenantUser(db, tenantId, userId);

  const fingerprint = JSON.stringify({
    tenant_id: tenantId, billing_intent_id: billingIntentId, status,
    provider_payment_id: optionalString(parsed, 'provider_payment_id'), failure_code: optionalString(parsed, 'failure_code'),
  });
  const replay = await loadIdempotentResponse(db, 'intents.status', idempotencyKey, fingerprint);
  if (replay) return replay;

  const intent = await db.prepare(
    `SELECT id, tenant_id, user_id, status FROM billing_intents WHERE id = ?1 LIMIT 1`,
  ).bind(billingIntentId).first<{ id: string; tenant_id: string; user_id: string; status: string }>();
  if (!intent?.id || intent.tenant_id !== tenantId || intent.user_id !== userId) {
    throw { status: 422, code: 'BILLING_INTENT_NOT_FOUND', message: 'billing_intent_id invalid.' };
  }

  const allowed = INTENT_TRANSITIONS[intent.status] ?? null;
  if (intent.status === 'completed' && status !== intent.status && !(allowed ?? []).includes(status)) {
    throw { status: 409, code: 'INTENT_STATUS_TRANSITION_INVALID', message: 'completed intent cannot be downgraded.' };
  }
  if (allowed && intent.status !== status && !allowed.includes(status)) {
    throw { status: 409, code: 'INTENT_STATUS_TRANSITION_INVALID', message: 'intent status transition invalid.' };
  }

  const now = new Date().toISOString();
  if (status === 'completed') {
    await db.prepare(
      `UPDATE billing_intents SET status = ?1, provider_payment_id = COALESCE(?2, provider_payment_id),
       failure_code = ?3, completed_at = COALESCE(completed_at, ?4), updated_at = ?4 WHERE id = ?5 AND status != 'completed'`,
    ).bind(status, optionalString(parsed, 'provider_payment_id'), optionalString(parsed, 'failure_code'), now, billingIntentId).run();
  } else {
    await db.prepare(
      `UPDATE billing_intents SET status = ?1, provider_payment_id = COALESCE(?2, provider_payment_id),
       failure_code = ?3, updated_at = ?4 WHERE id = ?5 AND status != 'completed'`,
    ).bind(status, optionalString(parsed, 'provider_payment_id'), optionalString(parsed, 'failure_code'), now, billingIntentId).run();
  }

  const response = { accepted: true, duplicate: false, billing_intent_id: billingIntentId, status, correlation_id: correlationId };
  await storeIdempotentResponse(db, 'intents.status', idempotencyKey, correlationId, fingerprint, response);
  return response;
}

const ROUTES: Record<string, BillingOperation> = {
  '/internal/billing/projections/events': 'projections.events',
  '/internal/billing/projections/subscriptions': 'projections.subscriptions',
  '/internal/billing/grants/credits': 'grants.credits',
  '/internal/billing/grants/storage': 'grants.storage',
  '/internal/billing/intents/status': 'intents.status',
};

const READ_ROUTE_KEYS: Record<string, readonly string[]> = {
  '/internal/billing/reads/actor': ['tenant_id', 'user_id'],
  '/internal/billing/reads/catalog': [],
  '/internal/billing/reads/subscription': ['tenant_id'],
  '/internal/billing/reads/intent': ['intent_id', 'idempotency_key', 'provider_order_id', 'provider_payment_id', 'tenant_id'],
  '/internal/billing/reads/storage-intent': ['intent_id', 'idempotency_key', 'provider_order_id', 'tenant_id'],
  '/internal/billing/reads/storage-commerce': ['tenant_id'],
  '/internal/billing/reads/storage-product': ['catalog_version', 'product_id'],
  '/internal/billing/reads/pending-storage-capacity': ['tenant_id', 'now_iso'],
  '/internal/billing/reads/pending-plan-intents': ['tenant_id', 'now_iso', 'limit'],
  '/internal/billing/reads/ledger-grant': ['credit_account_id', 'reference_type', 'reference_id'],
  '/internal/billing/reads/event': ['provider_event_id'],
  '/internal/billing/reads/signup-bonus': ['credit_account_id', 'tenant_id'],
  '/internal/billing/reads/profile-created-at': ['tenant_id'],
  '/internal/billing/reads/credit-account': ['credit_account_id'],
};

const WRITE_ROUTE_KEYS: Record<string, readonly string[]> = {
  '/internal/billing/intents/create': [
    'intent_id', 'context_id', 'tenant_id', 'user_id', 'catalog_version', 'product_id', 'amount', 'product_kind',
    'billing_cycle', 'credit_amount', 'route', 'expires_at', 'created_at', 'idempotency_key',
  ],
  '/internal/billing/intents/checkout-created': ['intent_id', 'provider_checkout_id', 'provider_order_id', 'checkout_url', 'updated_at'],
  '/internal/billing/storage-intents/create': [
    'intent_id', 'tenant_id', 'user_id', 'catalog_version', 'product_id', 'capacity_gb', 'price_jpy', 'expires_at', 'created_at', 'idempotency_key',
  ],
  '/internal/billing/storage-intents/checkout-created': ['intent_id', 'provider_checkout_id', 'provider_order_id', 'checkout_url', 'updated_at'],
  '/internal/billing/storage-intents/failed': ['intent_id', 'tenant_id', 'user_id', 'failure_code', 'updated_at'],
  '/internal/billing/storage-intents/payment': [
    'provider_event_id', 'provider_order_id', 'provider_payment_id', 'payment_status', 'paid_amount', 'paid_currency',
  ],
  '/internal/billing/intents/payment-apply': [
    'provider_event_id', 'provider_order_id', 'provider_payment_id', 'payment_status', 'paid_amount', 'paid_currency',
    'grant_idempotency_key', 'grant_fingerprint',
  ],
  '/internal/billing/events/start-processing': ['provider_event_id', 'event_type', 'received_at'],
  '/internal/billing/events/meta': ['provider_event_id'],
  '/internal/billing/webhook/invoice-payment': ['provider_event_id', 'provider_order_id', 'provider_subscription_id'],
  '/internal/billing/webhook/subscription': ['provider_event_id', 'provider_subscription_id', 'subscription_status', 'start_date', 'charged_through_date'],
  '/internal/billing/webhook/intent-reconciliation': ['provider_event_id', 'provider_payment_id', 'failure_code', 'event_processing_status'],
  '/internal/billing/webhook/invoice-projection': ['provider_event_id', 'provider_order_id', 'failure_code'],
  '/internal/billing/webhook/payout-recorded': ['provider_event_id'],
};

async function dispatch(db: D1Database, operation: BillingOperation, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  switch (operation) {
    case 'projections.events': return handleEventProjection(db, body);
    case 'projections.subscriptions': return handleSubscriptionProjection(db, body);
    case 'grants.credits': return handleCreditGrant(db, body);
    case 'grants.storage': return handleStorageGrant(db, body);
    case 'intents.status': return handleIntentStatus(db, body);
    default: throw { status: 404, code: 'NOT_FOUND', message: 'Not found.' };
  }
}

async function dispatchRead(db: D1Database, pathname: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  switch (pathname) {
    case '/internal/billing/reads/actor':
      return readActor(db, requiredString(body, 'tenant_id'), requiredString(body, 'user_id'));
    case '/internal/billing/reads/catalog':
      return readCatalog(db);
    case '/internal/billing/reads/subscription':
      return readSubscription(db, requiredString(body, 'tenant_id'));
    case '/internal/billing/reads/intent':
      return readIntent(db, body);
    case '/internal/billing/reads/storage-intent':
      return readStorageIntent(db, body);
    case '/internal/billing/reads/storage-commerce':
      return readStorageCommerce(db, requiredString(body, 'tenant_id'));
    case '/internal/billing/reads/storage-product':
      return readStorageProduct(db, requiredString(body, 'catalog_version'), requiredString(body, 'product_id'));
    case '/internal/billing/reads/pending-storage-capacity':
      return readPendingStorageCapacity(db, requiredString(body, 'tenant_id'), requiredString(body, 'now_iso'));
    case '/internal/billing/reads/pending-plan-intents':
      return readPendingPlanIntents(
        db,
        requiredString(body, 'tenant_id'),
        requiredString(body, 'now_iso'),
        body.limit,
      );
    case '/internal/billing/reads/ledger-grant':
      return readLedgerGrant(
        db,
        requiredString(body, 'credit_account_id'),
        requiredString(body, 'reference_type'),
        requiredString(body, 'reference_id'),
      );
    case '/internal/billing/reads/event':
      return readEvent(db, requiredString(body, 'provider_event_id'));
    case '/internal/billing/reads/signup-bonus':
      return readSignupBonus(db, requiredString(body, 'credit_account_id'), requiredString(body, 'tenant_id'));
    case '/internal/billing/reads/profile-created-at':
      return readProfileCreatedAt(db, requiredString(body, 'tenant_id'));
    case '/internal/billing/reads/credit-account':
      return readCreditAccount(db, requiredString(body, 'credit_account_id'));
    default:
      throw { status: 404, code: 'NOT_FOUND', message: 'Not found.' };
  }
}

async function dispatchWrite(db: D1Database, pathname: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  switch (pathname) {
    case '/internal/billing/intents/create':
      return writeIntentCreate(db, body);
    case '/internal/billing/intents/checkout-created':
      return writeIntentCheckoutCreated(db, body);
    case '/internal/billing/storage-intents/create':
      return writeStorageIntentCreate(db, body);
    case '/internal/billing/storage-intents/checkout-created':
      return writeStorageIntentCheckoutCreated(db, body);
    case '/internal/billing/storage-intents/failed':
      return writeStorageIntentFailed(db, body);
    case '/internal/billing/storage-intents/payment':
      return writeStorageIntentPayment(db, body);
    case '/internal/billing/intents/payment-apply':
      return writeIntentPaymentApply(db, body);
    case '/internal/billing/events/start-processing':
      return writeEventStartProcessing(db, body);
    case '/internal/billing/events/meta':
      return writeEventGetMeta(db, requiredString(body, 'provider_event_id'));
    case '/internal/billing/webhook/invoice-payment':
      return writeWebhookInvoicePayment(db, body);
    case '/internal/billing/webhook/subscription':
      return writeWebhookSubscription(db, body);
    case '/internal/billing/webhook/intent-reconciliation':
      return writeWebhookIntentReconciliation(db, body);
    case '/internal/billing/webhook/invoice-projection':
      return writeWebhookInvoiceProjection(db, body);
    case '/internal/billing/webhook/payout-recorded':
      return writeWebhookPayoutRecorded(db, requiredString(body, 'provider_event_id'));
    default:
      throw { status: 404, code: 'NOT_FOUND', message: 'Not found.' };
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const correlationId = request.headers.get('X-Request-ID')?.trim() || crypto.randomUUID();
    const url = new URL(request.url);
    const operation = ROUTES[url.pathname];
    if (url.pathname === '/healthz' && request.method === 'GET') return new Response('ok', { status: 200 });
    if (!operation && !READ_ROUTE_KEYS[url.pathname] && !WRITE_ROUTE_KEYS[url.pathname]) {
      return jsonError(404, 'NOT_FOUND', 'Not found.', correlationId);
    }
    try {
      assertProjectionAuth(request, env);
      if (request.method !== 'POST') return jsonError(405, 'METHOD_NOT_ALLOWED', 'POST only.', correlationId);
      const raw = await request.text();
      let parsed: unknown;
      try { parsed = raw ? JSON.parse(raw) : null; } catch { return jsonError(400, 'INVALID_JSON', 'Invalid JSON.', correlationId); }
      const body = isRecord(parsed) ? parsed : {};
      if (READ_ROUTE_KEYS[url.pathname]) {
        const allowed = READ_ROUTE_KEYS[url.pathname];
        const strict = parseStrictObject(body, allowed);
        const result = await dispatchRead(env.ASTERA_DB, url.pathname, strict);
        return Response.json(result, { status: 200, headers: { 'Cache-Control': 'no-store', 'X-Correlation-ID': correlationId } });
      }
      if (WRITE_ROUTE_KEYS[url.pathname]) {
        const allowed = WRITE_ROUTE_KEYS[url.pathname];
        const strict = parseStrictObject(body, allowed);
        const result = await dispatchWrite(env.ASTERA_DB, url.pathname, strict);
        return Response.json(result, { status: 200, headers: { 'Cache-Control': 'no-store', 'X-Correlation-ID': correlationId } });
      }
      if (!isRecord(parsed)) return jsonError(400, 'INVALID_JSON', 'JSON object required.', correlationId);
      const result = await dispatch(env.ASTERA_DB, operation, parsed);
      return Response.json(result, { status: 200, headers: { 'Cache-Control': 'no-store', 'X-Correlation-ID': correlationId } });
    } catch (error) {
      const err = error as { status?: number; code?: string; message?: string };
      if (err.status && err.code) return jsonError(err.status, err.code, err.message ?? 'Error', correlationId);
      return jsonError(500, 'INTERNAL_SERVER_ERROR', 'Internal error.', correlationId);
    }
  },
};
