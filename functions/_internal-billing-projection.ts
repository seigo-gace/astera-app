import {
  FunctionHttpError,
  functionErrorResponse,
  requestCorrelationId,
  type AsteraFunctionEnv,
  type D1Database,
} from './_account-projection';
import { applyCreditGrant } from './_credit-grants';

export type InternalBillingEnv = AsteraFunctionEnv & { BILLING_APP_SECRET?: string };

type PagesContext = { request: Request; env: InternalBillingEnv };

type BillingOperation =
  | 'projections.events'
  | 'projections.subscriptions'
  | 'grants.credits'
  | 'grants.storage'
  | 'intents.status';

const PII_FIELD_PATTERN = /^(email|e_mail|phone|phone_number|customer_email|customer_name|given_name|family_name|address|billing_address)$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rejectPiiKeys(record: Record<string, unknown>): void {
  for (const key of Object.keys(record)) {
    if (PII_FIELD_PATTERN.test(key)) {
      throw new FunctionHttpError(400, 'PII_FIELD_FORBIDDEN', 'PIIフィールドは受け付けません。');
    }
  }
}

function parseStrictObject(raw: unknown, allowedKeys: readonly string[]): Record<string, unknown> {
  if (!isRecord(raw)) {
    throw new FunctionHttpError(400, 'INVALID_JSON', 'JSONオブジェクトが必要です。');
  }
  rejectPiiKeys(raw);
  for (const key of Object.keys(raw)) {
    if (!allowedKeys.includes(key)) {
      throw new FunctionHttpError(400, 'UNKNOWN_FIELD', `未知のフィールド: ${key}`);
    }
  }
  return raw;
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new FunctionHttpError(400, 'SCHEMA_VALIDATION_FAILED', `${key} が必要です。`);
  }
  return value.trim();
}

function optionalString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') {
    throw new FunctionHttpError(400, 'SCHEMA_VALIDATION_FAILED', `${key} は文字列または null である必要があります。`);
  }
  return value.trim() || null;
}

function optionalInteger(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  if (value === null || value === undefined) return null;
  if (!Number.isSafeInteger(value)) {
    throw new FunctionHttpError(400, 'SCHEMA_VALIDATION_FAILED', `${key} は整数である必要があります。`);
  }
  return value;
}

function requiredInteger(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (!Number.isSafeInteger(value)) {
    throw new FunctionHttpError(400, 'SCHEMA_VALIDATION_FAILED', `${key} は整数である必要があります。`);
  }
  return value;
}

function requiredBoolean(record: Record<string, unknown>, key: string): boolean {
  const value = record[key];
  if (typeof value !== 'boolean') {
    throw new FunctionHttpError(400, 'SCHEMA_VALIDATION_FAILED', `${key} は boolean である必要があります。`);
  }
  return value;
}

function requireBillingAppSecret(request: Request, env: InternalBillingEnv): void {
  const configured = env.BILLING_APP_SECRET?.trim();
  if (!configured) {
    throw new FunctionHttpError(503, 'BILLING_APP_SECRET_MISSING', 'Billing内部API Secretが設定されていません。');
  }
  const header = request.headers.get('Authorization')?.trim() ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match || match[1] !== configured) {
    throw new FunctionHttpError(401, 'BILLING_APP_UNAUTHORIZED', 'Billing内部API認証に失敗しました。');
  }
}

async function validateTenantUser(db: D1Database, tenantId: string, userId: string): Promise<void> {
  const tenant = await db.prepare('SELECT id FROM tenants WHERE id = ?1 LIMIT 1').bind(tenantId).first<{ id: string }>();
  if (!tenant?.id) {
    throw new FunctionHttpError(422, 'TENANT_NOT_FOUND', 'tenant_id を確認できません。');
  }
  const profile = await db.prepare(
    'SELECT user_id FROM user_profiles WHERE user_id = ?1 AND tenant_id = ?2 LIMIT 1',
  ).bind(userId, tenantId).first<{ user_id: string }>();
  if (!profile?.user_id) {
    throw new FunctionHttpError(422, 'USER_TENANT_MISMATCH', 'user_id と tenant_id の組み合わせを確認できません。');
  }
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
    throw new FunctionHttpError(409, 'IDEMPOTENCY_KEY_REUSED', 'idempotency_key が別リクエストで使用されています。');
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

function isEntitlementNeutralEventType(eventType: string): boolean {
  const normalized = eventType.toLowerCase();
  return /refund|dispute|payout/.test(normalized);
}

async function handleEventProjection(db: D1Database, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const parsed = parseStrictObject(body, [
    'idempotency_key',
    'correlation_id',
    'tenant_id',
    'user_id',
    'provider_event_id',
    'event_type',
    'object_kind',
    'object_id',
    'status',
    'amount',
    'currency',
    'provider_created_at',
    'billing_intent_id',
    'processing_status',
  ]);
  const idempotencyKey = requiredString(parsed, 'idempotency_key');
  const correlationId = requiredString(parsed, 'correlation_id');
  const tenantId = requiredString(parsed, 'tenant_id');
  const userId = requiredString(parsed, 'user_id');
  const providerEventId = requiredString(parsed, 'provider_event_id');
  const eventType = requiredString(parsed, 'event_type');
  const objectKind = requiredString(parsed, 'object_kind');
  const processingStatus = requiredString(parsed, 'processing_status');
  await validateTenantUser(db, tenantId, userId);

  const fingerprint = JSON.stringify({
    provider_event_id: providerEventId,
    event_type: eventType,
    processing_status: processingStatus,
  });

  const existingByKey = await db.prepare(
    `SELECT provider_event_id, processing_status FROM billing_event_projections WHERE idempotency_key = ?1 LIMIT 1`,
  ).bind(idempotencyKey).first<{ provider_event_id: string; processing_status: string }>();
  if (existingByKey) {
    return {
      accepted: true,
      duplicate: true,
      provider_event_id: existingByKey.provider_event_id,
      processing_status: existingByKey.processing_status,
      correlation_id: correlationId,
    };
  }

  const existingEvent = await db.prepare(
    `SELECT idempotency_key FROM billing_event_projections WHERE provider_event_id = ?1 LIMIT 1`,
  ).bind(providerEventId).first<{ idempotency_key: string }>();
  if (existingEvent && existingEvent.idempotency_key !== idempotencyKey) {
    throw new FunctionHttpError(409, 'PROVIDER_EVENT_ID_CONFLICT', 'provider_event_id が既に登録されています。');
  }
  if (existingEvent) {
    return {
      accepted: true,
      duplicate: true,
      provider_event_id: providerEventId,
      processing_status: processingStatus,
      correlation_id: correlationId,
    };
  }

  if (!isEntitlementNeutralEventType(eventType)) {
    // Event endpoint is projection-only; entitlements change via dedicated grant/subscription routes.
  }

  const now = new Date().toISOString();
  await db.prepare(
    `INSERT INTO billing_event_projections
      (provider_event_id, idempotency_key, correlation_id, tenant_id, event_type, object_kind, object_id,
       status, amount, currency, provider_created_at, billing_intent_id, processing_status, recorded_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`,
  ).bind(
    providerEventId,
    idempotencyKey,
    correlationId,
    tenantId,
    eventType,
    objectKind,
    optionalString(parsed, 'object_id'),
    optionalString(parsed, 'status'),
    optionalInteger(parsed, 'amount'),
    optionalString(parsed, 'currency'),
    optionalString(parsed, 'provider_created_at'),
    optionalString(parsed, 'billing_intent_id'),
    processingStatus,
    now,
  ).run();

  return {
    accepted: true,
    duplicate: false,
    provider_event_id: providerEventId,
    processing_status: processingStatus,
    correlation_id: correlationId,
  };
}

async function handleSubscriptionProjection(db: D1Database, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const parsed = parseStrictObject(body, [
    'idempotency_key',
    'correlation_id',
    'tenant_id',
    'user_id',
    'catalog_version',
    'plan_id',
    'billing_cycle',
    'provider_subscription_id',
    'status',
    'current_period_start',
    'current_period_end',
    'cancel_at_period_end',
  ]);
  const idempotencyKey = requiredString(parsed, 'idempotency_key');
  const correlationId = requiredString(parsed, 'correlation_id');
  const tenantId = requiredString(parsed, 'tenant_id');
  const userId = requiredString(parsed, 'user_id');
  const catalogVersion = requiredString(parsed, 'catalog_version');
  const planId = requiredString(parsed, 'plan_id');
  const billingCycle = requiredString(parsed, 'billing_cycle');
  if (billingCycle !== 'monthly' && billingCycle !== 'annual') {
    throw new FunctionHttpError(400, 'SCHEMA_VALIDATION_FAILED', 'billing_cycle が不正です。');
  }
  const status = requiredString(parsed, 'status');
  const cancelAtPeriodEnd = requiredBoolean(parsed, 'cancel_at_period_end');
  await validateTenantUser(db, tenantId, userId);

  const existing = await db.prepare(
    `SELECT tenant_id, plan_id, status FROM billing_subscription_projections WHERE idempotency_key = ?1 LIMIT 1`,
  ).bind(idempotencyKey).first<{ tenant_id: string; plan_id: string; status: string }>();
  if (existing) {
    return {
      accepted: true,
      duplicate: true,
      tenant_id: existing.tenant_id,
      plan_id: existing.plan_id,
      status: existing.status,
      correlation_id: correlationId,
    };
  }

  const now = new Date().toISOString();
  const providerSubscriptionId = optionalString(parsed, 'provider_subscription_id');
  const periodStart = optionalString(parsed, 'current_period_start');
  const periodEnd = optionalString(parsed, 'current_period_end');

  const subscriptionRow = await db.prepare(
    `SELECT id FROM tenant_subscriptions WHERE tenant_id = ?1 LIMIT 1`,
  ).bind(tenantId).first<{ id: string }>();

  const statements = [
    db.prepare(
      `INSERT INTO billing_subscription_projections
        (idempotency_key, correlation_id, tenant_id, user_id, catalog_version, plan_id, billing_cycle,
         provider_subscription_id, status, current_period_start, current_period_end, cancel_at_period_end, recorded_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`,
    ).bind(
      idempotencyKey,
      correlationId,
      tenantId,
      userId,
      catalogVersion,
      planId,
      billingCycle,
      providerSubscriptionId,
      status,
      periodStart,
      periodEnd,
      cancelAtPeriodEnd ? 1 : 0,
      now,
    ),
  ];

  if (subscriptionRow?.id) {
    statements.push(
      db.prepare(
        `UPDATE tenant_subscriptions
         SET catalog_version = ?1, plan_id = ?2, billing_cycle = ?3, provider_subscription_id = ?4,
             status = ?5, current_period_start = ?6, current_period_end = ?7,
             cancel_at_period_end = ?8, updated_at = ?9
         WHERE id = ?10`,
      ).bind(
        catalogVersion,
        planId,
        billingCycle,
        providerSubscriptionId,
        status,
        periodStart,
        periodEnd,
        cancelAtPeriodEnd ? 1 : 0,
        now,
        subscriptionRow.id,
      ),
    );
  } else {
    statements.push(
      db.prepare(
        `INSERT INTO tenant_subscriptions
          (id, tenant_id, catalog_version, plan_id, billing_cycle, provider_subscription_id, status,
           current_period_start, current_period_end, cancel_at_period_end, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)`,
      ).bind(
        `sub:${tenantId}`,
        tenantId,
        catalogVersion,
        planId,
        billingCycle,
        providerSubscriptionId,
        status,
        periodStart,
        periodEnd,
        cancelAtPeriodEnd ? 1 : 0,
        now,
      ),
    );
  }

  await db.batch(statements);

  return {
    accepted: true,
    duplicate: false,
    tenant_id: tenantId,
    plan_id: planId,
    status,
    correlation_id: correlationId,
  };
}

async function handleCreditGrant(db: D1Database, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const parsed = parseStrictObject(body, [
    'idempotency_key',
    'correlation_id',
    'tenant_id',
    'user_id',
    'credit_account_id',
    'amount',
    'reference_type',
    'reference_id',
    'billing_intent_id',
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

  const fingerprint = JSON.stringify({
    tenant_id: tenantId,
    credit_account_id: creditAccountId,
    amount,
    reference_type: referenceType,
    reference_id: referenceId,
    billing_intent_id: optionalString(parsed, 'billing_intent_id'),
  });

  const replay = await loadIdempotentResponse(db, 'grants.credits', idempotencyKey, fingerprint);
  if (replay) return replay;

  const credit = await db.prepare(
    'SELECT id, tenant_id FROM credit_accounts WHERE id = ?1 LIMIT 1',
  ).bind(creditAccountId).first<{ id: string; tenant_id: string }>();
  if (!credit?.id || credit.tenant_id !== tenantId) {
    throw new FunctionHttpError(422, 'CREDIT_ACCOUNT_MISMATCH', 'credit_account_id を確認できません。');
  }

  const outcome = await applyCreditGrant(
    db,
    creditAccountId,
    amount,
    referenceType,
    referenceId,
    idempotencyKey,
    fingerprint,
  );

  const response = {
    accepted: true,
    duplicate: outcome === 'duplicate',
    granted: outcome === 'granted',
    correlation_id: correlationId,
  };
  await storeIdempotentResponse(db, 'grants.credits', idempotencyKey, correlationId, fingerprint, response);
  return response;
}

async function handleStorageGrant(db: D1Database, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const parsed = parseStrictObject(body, [
    'idempotency_key',
    'correlation_id',
    'tenant_id',
    'user_id',
    'storage_intent_id',
    'provider_order_id',
    'provider_payment_id',
  ]);
  const idempotencyKey = requiredString(parsed, 'idempotency_key');
  const correlationId = requiredString(parsed, 'correlation_id');
  const tenantId = requiredString(parsed, 'tenant_id');
  const userId = requiredString(parsed, 'user_id');
  const storageIntentId = requiredString(parsed, 'storage_intent_id');
  const providerOrderId = requiredString(parsed, 'provider_order_id');
  const providerPaymentId = optionalString(parsed, 'provider_payment_id');
  await validateTenantUser(db, tenantId, userId);

  const fingerprint = JSON.stringify({
    tenant_id: tenantId,
    storage_intent_id: storageIntentId,
    provider_order_id: providerOrderId,
    provider_payment_id: providerPaymentId,
  });

  const replay = await loadIdempotentResponse(db, 'grants.storage', idempotencyKey, fingerprint);
  if (replay) return replay;

  const intent = await db.prepare(
    `SELECT id, tenant_id, user_id, catalog_version, product_id, capacity_gb, price_jpy, status
     FROM astera_storage_pack_intents WHERE id = ?1 AND tenant_id = ?2 LIMIT 1`,
  ).bind(storageIntentId, tenantId).first<{
    id: string;
    tenant_id: string;
    user_id: string;
    catalog_version: string;
    product_id: string;
    capacity_gb: number;
    price_jpy: number;
    status: string;
  }>();
  if (!intent?.id) {
    throw new FunctionHttpError(422, 'STORAGE_INTENT_NOT_FOUND', 'storage_intent_id を確認できません。');
  }
  if (intent.user_id !== userId) {
    throw new FunctionHttpError(422, 'STORAGE_INTENT_USER_MISMATCH', 'storage_intent_id と user_id が一致しません。');
  }

  const existingPurchase = await db.prepare(
    `SELECT id FROM astera_storage_pack_purchases WHERE provider_order_id = ?1 LIMIT 1`,
  ).bind(providerOrderId).first<{ id: string }>();

  const now = new Date().toISOString();
  if (!existingPurchase?.id) {
    await db.batch([
      db.prepare(
        `INSERT OR IGNORE INTO astera_storage_pack_purchases
          (id, tenant_id, user_id, catalog_version, product_id, capacity_gb, price_jpy,
           provider_order_id, provider_payment_id, purchased_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
      ).bind(
        intent.id,
        intent.tenant_id,
        intent.user_id,
        intent.catalog_version,
        intent.product_id,
        Number(intent.capacity_gb),
        Number(intent.price_jpy),
        providerOrderId,
        providerPaymentId,
        now,
      ),
      db.prepare(
        `UPDATE astera_storage_pack_intents
         SET status = 'completed', provider_order_id = ?1, provider_payment_id = ?2,
             completed_at = COALESCE(completed_at, ?3), failure_code = NULL, updated_at = ?3
         WHERE id = ?4`,
      ).bind(providerOrderId, providerPaymentId, now, intent.id),
    ]);
  }

  const response = {
    accepted: true,
    duplicate: Boolean(existingPurchase?.id),
    granted: !existingPurchase?.id,
    correlation_id: correlationId,
  };
  await storeIdempotentResponse(db, 'grants.storage', idempotencyKey, correlationId, fingerprint, response);
  return response;
}

async function handleIntentStatus(db: D1Database, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const parsed = parseStrictObject(body, [
    'idempotency_key',
    'correlation_id',
    'tenant_id',
    'user_id',
    'billing_intent_id',
    'status',
    'provider_payment_id',
    'failure_code',
  ]);
  const idempotencyKey = requiredString(parsed, 'idempotency_key');
  const correlationId = requiredString(parsed, 'correlation_id');
  const tenantId = requiredString(parsed, 'tenant_id');
  const userId = requiredString(parsed, 'user_id');
  const billingIntentId = requiredString(parsed, 'billing_intent_id');
  const status = requiredString(parsed, 'status');
  await validateTenantUser(db, tenantId, userId);

  const fingerprint = JSON.stringify({
    tenant_id: tenantId,
    billing_intent_id: billingIntentId,
    status,
    provider_payment_id: optionalString(parsed, 'provider_payment_id'),
    failure_code: optionalString(parsed, 'failure_code'),
  });

  const replay = await loadIdempotentResponse(db, 'intents.status', idempotencyKey, fingerprint);
  if (replay) return replay;

  const intent = await db.prepare(
    `SELECT id, tenant_id, user_id, status FROM billing_intents WHERE id = ?1 LIMIT 1`,
  ).bind(billingIntentId).first<{ id: string; tenant_id: string; user_id: string; status: string }>();
  if (!intent?.id || intent.tenant_id !== tenantId || intent.user_id !== userId) {
    throw new FunctionHttpError(422, 'BILLING_INTENT_NOT_FOUND', 'billing_intent_id を確認できません。');
  }

  const now = new Date().toISOString();
  await db.prepare(
    `UPDATE billing_intents
     SET status = ?1, provider_payment_id = COALESCE(?2, provider_payment_id),
         failure_code = ?3, updated_at = ?4
     WHERE id = ?5`,
  ).bind(
    status,
    optionalString(parsed, 'provider_payment_id'),
    optionalString(parsed, 'failure_code'),
    now,
    billingIntentId,
  ).run();

  const response = {
    accepted: true,
    duplicate: false,
    billing_intent_id: billingIntentId,
    status,
    correlation_id: correlationId,
  };
  await storeIdempotentResponse(db, 'intents.status', idempotencyKey, correlationId, fingerprint, response);
  return response;
}

async function dispatchOperation(db: D1Database, operation: BillingOperation, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  switch (operation) {
    case 'projections.events':
      return handleEventProjection(db, body);
    case 'projections.subscriptions':
      return handleSubscriptionProjection(db, body);
    case 'grants.credits':
      return handleCreditGrant(db, body);
    case 'grants.storage':
      return handleStorageGrant(db, body);
    case 'intents.status':
      return handleIntentStatus(db, body);
    default:
      throw new FunctionHttpError(404, 'NOT_FOUND', '操作が見つかりません。');
  }
}

export async function handleInternalBillingPost(context: PagesContext, operation: BillingOperation): Promise<Response> {
  const requestId = requestCorrelationId(context.request);
  try {
    requireBillingAppSecret(context.request, context.env);
    if (context.request.method !== 'POST') {
      throw new FunctionHttpError(405, 'METHOD_NOT_ALLOWED', 'POSTのみ対応しています。');
    }
    const raw = await context.request.text();
    let parsed: unknown;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      throw new FunctionHttpError(400, 'INVALID_JSON', 'JSONの解析に失敗しました。');
    }
    if (!isRecord(parsed)) {
      throw new FunctionHttpError(400, 'INVALID_JSON', 'JSONオブジェクトが必要です。');
    }
    const result = await dispatchOperation(context.env.ASTERA_DB, operation, parsed);
    return Response.json(result, {
      status: 200,
      headers: { 'Cache-Control': 'no-store', 'X-Correlation-ID': requestId },
    });
  } catch (error) {
    return functionErrorResponse(error, requestId);
  }
}

export function onInternalBillingMethodGuard(context: PagesContext): Promise<Response> | null {
  if (context.request.method !== 'POST') {
    const requestId = requestCorrelationId(context.request);
    return Promise.resolve(
      Response.json(
        { error: { code: 'METHOD_NOT_ALLOWED', message: 'POSTのみ対応しています。' } },
        { status: 405, headers: { 'X-Correlation-ID': requestId } },
      ),
    );
  }
  return null;
}
