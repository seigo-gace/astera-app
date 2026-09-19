import { FunctionHttpError } from '../part/billing-env.js';
import type { ActiveCommercialCatalog } from './catalog.js';
import type { StorageCommerceProjection, StoragePackProduct } from './storage-commerce.js';
import type { CreditRow, UserProfileRow } from '../part/billing-env.js';
import type { SquareEventProjection } from './square-event-handler.js';

export type ProjectionEventsPayload = {
  provider_event_id: string;
  event_type: string;
  processing_status: string;
  billing_intent_id: string | null;
  projection: SquareEventProjection;
  idempotency_key: string;
  correlation_id: string;
  tenant_id?: string | null;
  user_id?: string | null;
};

export type ProjectionEventsResult = {
  duplicate: boolean;
  processing_status: string;
};

export type ProjectionIntentStatusPayload = {
  intent_id: string;
  status: string;
  failure_code?: string | null;
  provider_order_id?: string | null;
  provider_payment_id?: string | null;
  idempotency_key: string;
  correlation_id: string;
  tenant_id: string;
  user_id: string;
  billing_intent_id?: string;
};

export type ProjectionCreditGrantPayload = {
  tenant_id: string;
  user_id: string;
  credit_account_id: string;
  amount: number;
  reference_type: string;
  reference_id: string;
  idempotency_key: string;
  correlation_id: string;
  billing_intent_id?: string | null;
};

export type ProjectionStorageGrantPayload = {
  tenant_id: string;
  user_id: string;
  storage_intent_id: string;
  provider_order_id: string;
  provider_payment_id?: string | null;
  idempotency_key: string;
  correlation_id: string;
};

export type ProjectionSubscriptionPayload = {
  tenant_id: string;
  user_id: string;
  catalog_version: string;
  plan_id: string;
  billing_cycle: string;
  provider_subscription_id: string | null;
  status: string;
  current_period_start?: string | null;
  current_period_end?: string | null;
  cancel_at_period_end?: boolean;
  idempotency_key: string;
  correlation_id: string;
};

export type BillingIntentRecord = Record<string, unknown>;
export type StorageIntentRecord = Record<string, unknown>;

export interface AsteraProjectionClient {
  postBillingEvent(payload: ProjectionEventsPayload): Promise<ProjectionEventsResult>;
  postIntentStatus(payload: ProjectionIntentStatusPayload): Promise<void>;
  postCreditGrant(payload: ProjectionCreditGrantPayload): Promise<void>;
  postStorageGrant(payload: ProjectionStorageGrantPayload): Promise<void>;
  postSubscription(payload: ProjectionSubscriptionPayload): Promise<void>;
  getActor(tenantId: string, userId: string): Promise<{ profile: UserProfileRow; credit: CreditRow }>;
  getCatalog(): Promise<ActiveCommercialCatalog>;
  getSubscription(tenantId: string): Promise<Record<string, unknown> | null>;
  getBillingIntentByIdempotency(idempotencyKey: string): Promise<BillingIntentRecord | null>;
  getBillingIntentLookup(query: Record<string, string | undefined>): Promise<BillingIntentRecord | null>;
  getStorageIntentByIdempotency(idempotencyKey: string): Promise<StorageIntentRecord | null>;
  getStorageIntentByOrderId(orderId: string): Promise<StorageIntentRecord | null>;
  getStorageIntentById(intentId: string, tenantId: string): Promise<StorageIntentRecord | null>;
  getStorageCommerce(tenantId: string): Promise<StorageCommerceProjection>;
  getStorageProduct(catalogVersion: string, productId: string): Promise<StoragePackProduct>;
  getPendingStorageCapacityGb(tenantId: string, nowIso: string): Promise<number>;
  getLatestPendingPlanIntent(tenantId: string, nowIso: string): Promise<BillingIntentRecord | null>;
  listPendingPlanIntents(tenantId: string, nowIso: string): Promise<BillingIntentRecord[]>;
  getLedgerGrant(creditAccountId: string, referenceType: string, referenceId: string): Promise<Record<string, unknown> | null>;
  getEvent(providerEventId: string): Promise<{ processing_status?: string; billing_intent_id?: string | null } | null>;
  hasSignupBonus(creditAccountId: string, tenantId: string): Promise<boolean>;
  getProfileCreatedAt(tenantId: string): Promise<string | null>;
  getCreditAccount(creditAccountId: string): Promise<CreditRow>;
  postIntentCreate(payload: Record<string, unknown>): Promise<{ duplicate: boolean; intent?: BillingIntentRecord; intent_id?: string; context_id?: string }>;
  postIntentCheckoutCreated(payload: Record<string, unknown>): Promise<void>;
  postStorageIntentCreate(payload: Record<string, unknown>): Promise<{ duplicate: boolean; intent?: StorageIntentRecord; intent_id?: string }>;
  postStorageIntentCheckoutCreated(payload: Record<string, unknown>): Promise<void>;
  postStorageIntentFailed(payload: Record<string, unknown>): Promise<void>;
  postStorageIntentPayment(payload: Record<string, unknown>): Promise<{ matched: boolean; processing_status: string | null }>;
  postIntentPaymentApply(payload: Record<string, unknown>): Promise<{ processing_status: string; billing_intent_id: string | null; storage_handoff?: boolean }>;
  postEventStartProcessing(payload: Record<string, unknown>): Promise<{ duplicate: boolean; processing_status: string }>;
  postEventMeta(providerEventId: string): Promise<{ billing_intent_id: string | null; processing_status: string }>;
  postWebhookInvoicePayment(payload: Record<string, unknown>): Promise<Record<string, unknown>>;
  postWebhookSubscription(payload: Record<string, unknown>): Promise<{ processing_status: string }>;
  postWebhookIntentReconciliation(payload: Record<string, unknown>): Promise<{ processing_status: string; billing_intent_id: string | null }>;
  postWebhookInvoiceProjection(payload: Record<string, unknown>): Promise<{ processing_status: string; billing_intent_id: string | null }>;
  postWebhookPayoutRecorded(providerEventId: string): Promise<{ processing_status: string; billing_intent_id: null }>;
}

type FetchLike = typeof fetch;

export class AsteraProjectionHttpClient implements AsteraProjectionClient {
  readonly #origin: string;
  readonly #secret: string;
  readonly #fetch: FetchLike;

  constructor(origin: string, secret: string, fetchImpl: FetchLike = fetch) {
    const normalizedOrigin = origin.trim().replace(/\/+$/, '');
    const normalizedSecret = secret.trim();
    if (!normalizedOrigin) throw new Error('ASTERA_PROJECTION_API_URL_MISSING');
    if (!normalizedSecret) throw new Error('BILLING_PROJECTION_SECRET_MISSING');
    this.#origin = normalizedOrigin;
    this.#secret = normalizedSecret;
    this.#fetch = fetchImpl;
  }

  async postBillingEvent(payload: ProjectionEventsPayload): Promise<ProjectionEventsResult> {
    const body = {
      idempotency_key: payload.idempotency_key,
      correlation_id: payload.correlation_id,
      tenant_id: payload.tenant_id ?? 'system:billing',
      user_id: payload.user_id ?? 'system:billing',
      provider_event_id: payload.provider_event_id,
      event_type: payload.event_type,
      object_kind: payload.projection.object_kind,
      object_id: payload.projection.object_id,
      status: payload.projection.status,
      amount: payload.projection.amount,
      currency: payload.projection.currency,
      provider_created_at: payload.projection.square_created_at,
      billing_intent_id: payload.billing_intent_id,
      processing_status: payload.processing_status,
    };
    const response = await this.#post('/internal/billing/projections/events', body);
    const result = response as { duplicate?: boolean; processing_status?: string };
    return {
      duplicate: result.duplicate === true,
      processing_status: typeof result.processing_status === 'string' ? result.processing_status : payload.processing_status,
    };
  }

  async postIntentStatus(payload: ProjectionIntentStatusPayload): Promise<void> {
    await this.#post('/internal/billing/intents/status', {
      idempotency_key: payload.idempotency_key,
      correlation_id: payload.correlation_id,
      tenant_id: payload.tenant_id,
      user_id: payload.user_id,
      billing_intent_id: payload.billing_intent_id ?? payload.intent_id,
      status: payload.status,
      provider_payment_id: payload.provider_payment_id ?? null,
      failure_code: payload.failure_code ?? null,
    });
  }

  async postCreditGrant(payload: ProjectionCreditGrantPayload): Promise<void> {
    await this.#post('/internal/billing/grants/credits', payload);
  }

  async postStorageGrant(payload: ProjectionStorageGrantPayload): Promise<void> {
    await this.#post('/internal/billing/grants/storage', payload);
  }

  async postSubscription(payload: ProjectionSubscriptionPayload): Promise<void> {
    await this.#post('/internal/billing/projections/subscriptions', payload);
  }

  async getActor(tenantId: string, userId: string) {
    const body = await this.#post('/internal/billing/reads/actor', { tenant_id: tenantId, user_id: userId }) as {
      profile: UserProfileRow;
      credit: CreditRow;
    };
    return body;
  }

  async getCatalog(): Promise<ActiveCommercialCatalog> {
    return await this.#post('/internal/billing/reads/catalog', {}) as ActiveCommercialCatalog;
  }

  async getSubscription(tenantId: string): Promise<Record<string, unknown> | null> {
    try {
      const body = await this.#post('/internal/billing/reads/subscription', { tenant_id: tenantId }) as { subscription: Record<string, unknown> };
      return body.subscription;
    } catch (error) {
      if (error instanceof FunctionHttpError && error.status === 404) return null;
      throw error;
    }
  }

  async getBillingIntentByIdempotency(idempotencyKey: string): Promise<BillingIntentRecord | null> {
    return this.getBillingIntentLookup({ idempotency_key: idempotencyKey });
  }

  async getBillingIntentLookup(query: Record<string, string | undefined>): Promise<BillingIntentRecord | null> {
    const payload: Record<string, string> = {};
    for (const [key, value] of Object.entries(query)) {
      if (value?.trim()) payload[key] = value.trim();
    }
    if (Object.keys(payload).length === 0) return null;
    try {
      const body = await this.#post('/internal/billing/reads/intent', payload) as { intent: BillingIntentRecord };
      return body.intent;
    } catch (error) {
      if (error instanceof FunctionHttpError && error.status === 404) return null;
      throw error;
    }
  }

  async getStorageIntentByIdempotency(idempotencyKey: string): Promise<StorageIntentRecord | null> {
    try {
      const body = await this.#post('/internal/billing/reads/storage-intent', { idempotency_key: idempotencyKey }) as { intent: StorageIntentRecord };
      return body.intent;
    } catch (error) {
      if (error instanceof FunctionHttpError && error.status === 404) return null;
      throw error;
    }
  }

  async getStorageIntentByOrderId(orderId: string): Promise<StorageIntentRecord | null> {
    try {
      const body = await this.#post('/internal/billing/reads/storage-intent', { provider_order_id: orderId }) as { intent: StorageIntentRecord };
      return body.intent;
    } catch (error) {
      if (error instanceof FunctionHttpError && error.status === 404) return null;
      throw error;
    }
  }

  async getStorageIntentById(intentId: string, tenantId: string): Promise<StorageIntentRecord | null> {
    try {
      const body = await this.#post('/internal/billing/reads/storage-intent', {
        intent_id: intentId,
        tenant_id: tenantId,
      }) as { intent: StorageIntentRecord };
      return body.intent;
    } catch (error) {
      if (error instanceof FunctionHttpError && error.status === 404) return null;
      throw error;
    }
  }

  async getStorageCommerce(tenantId: string): Promise<StorageCommerceProjection> {
    const body = await this.#post('/internal/billing/reads/storage-commerce', { tenant_id: tenantId }) as { commerce: StorageCommerceProjection };
    return body.commerce;
  }

  async getStorageProduct(catalogVersion: string, productId: string): Promise<StoragePackProduct> {
    const body = await this.#post('/internal/billing/reads/storage-product', {
      catalog_version: catalogVersion,
      product_id: productId,
    }) as { product: StoragePackProduct };
    return body.product;
  }

  async getPendingStorageCapacityGb(tenantId: string, nowIso: string): Promise<number> {
    const body = await this.#post('/internal/billing/reads/pending-storage-capacity', {
      tenant_id: tenantId,
      now_iso: nowIso,
    }) as { pending_capacity_gb: number };
    return Number(body.pending_capacity_gb ?? 0);
  }

  async getLatestPendingPlanIntent(tenantId: string, nowIso: string): Promise<BillingIntentRecord | null> {
    const body = await this.#post('/internal/billing/reads/pending-plan-intents', {
      tenant_id: tenantId,
      now_iso: nowIso,
      limit: 1,
    }) as { intents: BillingIntentRecord[] };
    return Array.isArray(body.intents) && body.intents[0] ? body.intents[0] : null;
  }

  async listPendingPlanIntents(tenantId: string, nowIso: string): Promise<BillingIntentRecord[]> {
    const body = await this.#post('/internal/billing/reads/pending-plan-intents', {
      tenant_id: tenantId,
      now_iso: nowIso,
      limit: 50,
    }) as { intents: BillingIntentRecord[] };
    return Array.isArray(body.intents) ? body.intents : [];
  }

  async getLedgerGrant(creditAccountId: string, referenceType: string, referenceId: string): Promise<Record<string, unknown> | null> {
    try {
      const body = await this.#post('/internal/billing/reads/ledger-grant', {
        credit_account_id: creditAccountId,
        reference_type: referenceType,
        reference_id: referenceId,
      }) as { grant: Record<string, unknown> };
      return body.grant;
    } catch (error) {
      if (error instanceof FunctionHttpError && error.status === 404) return null;
      throw error;
    }
  }

  async getEvent(providerEventId: string): Promise<{ processing_status?: string; billing_intent_id?: string | null } | null> {
    try {
      const body = await this.#post('/internal/billing/reads/event', { provider_event_id: providerEventId }) as {
        event: { processing_status?: string; billing_intent_id?: string | null };
      };
      return body.event ?? null;
    } catch (error) {
      if (error instanceof FunctionHttpError && error.status === 404) return null;
      throw error;
    }
  }

  async hasSignupBonus(creditAccountId: string, tenantId: string): Promise<boolean> {
    const body = await this.#post('/internal/billing/reads/signup-bonus', {
      credit_account_id: creditAccountId,
      tenant_id: tenantId,
    }) as { exists: boolean };
    return body.exists === true;
  }

  async getProfileCreatedAt(tenantId: string): Promise<string | null> {
    try {
      const body = await this.#post('/internal/billing/reads/profile-created-at', { tenant_id: tenantId }) as { created_at: string };
      return body.created_at ?? null;
    } catch (error) {
      if (error instanceof FunctionHttpError && error.status === 404) return null;
      throw error;
    }
  }

  async getCreditAccount(creditAccountId: string): Promise<CreditRow> {
    const body = await this.#post('/internal/billing/reads/credit-account', { credit_account_id: creditAccountId }) as { credit: CreditRow };
    return body.credit;
  }

  async postIntentCreate(payload: Record<string, unknown>) {
    return await this.#post('/internal/billing/intents/create', payload) as {
      duplicate: boolean;
      intent?: BillingIntentRecord;
      intent_id?: string;
      context_id?: string;
    };
  }

  async postIntentCheckoutCreated(payload: Record<string, unknown>): Promise<void> {
    await this.#post('/internal/billing/intents/checkout-created', payload);
  }

  async postStorageIntentCreate(payload: Record<string, unknown>) {
    return await this.#post('/internal/billing/storage-intents/create', payload) as {
      duplicate: boolean;
      intent?: StorageIntentRecord;
      intent_id?: string;
    };
  }

  async postStorageIntentCheckoutCreated(payload: Record<string, unknown>): Promise<void> {
    await this.#post('/internal/billing/storage-intents/checkout-created', payload);
  }

  async postStorageIntentFailed(payload: Record<string, unknown>): Promise<void> {
    await this.#post('/internal/billing/storage-intents/failed', payload);
  }

  async postStorageIntentPayment(payload: Record<string, unknown>) {
    return await this.#post('/internal/billing/storage-intents/payment', payload) as {
      matched: boolean;
      processing_status: string | null;
    };
  }

  async postIntentPaymentApply(payload: Record<string, unknown>) {
    return await this.#post('/internal/billing/intents/payment-apply', payload) as {
      processing_status: string;
      billing_intent_id: string | null;
      storage_handoff?: boolean;
    };
  }

  async postEventStartProcessing(payload: Record<string, unknown>) {
    return await this.#post('/internal/billing/events/start-processing', payload) as {
      duplicate: boolean;
      processing_status: string;
    };
  }

  async postEventMeta(providerEventId: string) {
    return await this.#post('/internal/billing/events/meta', { provider_event_id: providerEventId }) as {
      billing_intent_id: string | null;
      processing_status: string;
    };
  }

  async postWebhookInvoicePayment(payload: Record<string, unknown>) {
    return await this.#post('/internal/billing/webhook/invoice-payment', payload) as Record<string, unknown>;
  }

  async postWebhookSubscription(payload: Record<string, unknown>) {
    return await this.#post('/internal/billing/webhook/subscription', payload) as { processing_status: string };
  }

  async postWebhookIntentReconciliation(payload: Record<string, unknown>) {
    return await this.#post('/internal/billing/webhook/intent-reconciliation', payload) as {
      processing_status: string;
      billing_intent_id: string | null;
    };
  }

  async postWebhookInvoiceProjection(payload: Record<string, unknown>) {
    return await this.#post('/internal/billing/webhook/invoice-projection', payload) as {
      processing_status: string;
      billing_intent_id: string | null;
    };
  }

  async postWebhookPayoutRecorded(providerEventId: string) {
    return await this.#post('/internal/billing/webhook/payout-recorded', { provider_event_id: providerEventId }) as {
      processing_status: string;
      billing_intent_id: null;
    };
  }

  async #post(path: string, payload: unknown): Promise<unknown> {
    const response = await this.#fetch(`${this.#origin}${path}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.#secret}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => ({})) as { error?: { code?: string; message?: string } };
    if (!response.ok) {
      throw new FunctionHttpError(
        response.status >= 500 ? 502 : response.status,
        body.error?.code ?? 'PROJECTION_REQUEST_FAILED',
        body.error?.message ?? 'Projection API request failed.',
      );
    }
    return body;
  }
}

export function requireProjectionClient(env: { projection?: AsteraProjectionClient | null }): AsteraProjectionClient {
  if (!env.projection) {
    throw new FunctionHttpError(503, 'PROJECTION_UNAVAILABLE', 'Projection Workerが設定されていません。');
  }
  return env.projection;
}

export function createAsteraProjectionClientFromEnv(env: {
  ASTERA_PROJECTION_API_URL?: string;
  BILLING_PROJECTION_SECRET?: string;
}): AsteraProjectionClient | null {
  const origin = env.ASTERA_PROJECTION_API_URL?.trim();
  const secret = env.BILLING_PROJECTION_SECRET?.trim();
  if (!origin || !secret) return null;
  return new AsteraProjectionHttpClient(origin, secret);
}
