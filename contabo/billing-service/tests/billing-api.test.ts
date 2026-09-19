import crypto from 'node:crypto';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { redactSquareWebhookPayload } from '../dist/feature/square-redactor.js';
import { SQUARE_SUPPORTED_EVENT_TYPES } from '../dist/feature/square-webhook-support.js';
import { handleSquareIngress, handleSquareWebhook } from '../dist/system/handlers-ingress.js';
import { createMemoryD1 } from '../dist/component/d1-memory.js';
import type { BillingServiceEnv } from '../dist/part/billing-env.js';
import { createSquareCheckout } from '../dist/feature/square.js';
import type { AsteraProjectionClient } from '../dist/feature/astera-projection.js';
import type { LibralVaultClient } from '../dist/feature/libral-vault.js';
import { recoverExactReconciliationIntent, writeWebhookInvoicePayment } from '../workers/projection/src/billing-writes.js';

const NOTIFICATION_URL = 'https://api.asterav8.jp/billing/webhooks/square';

function squareEvent(eventId: string, eventType: string) {
  return {
    merchant_id: 'merchant-1',
    type: eventType,
    event_id: eventId,
    created_at: '2026-09-17T00:00:00Z',
    data: {
      type: eventType.split('.')[0],
      id: 'obj-1',
      object: {
        payment: {
          id: 'payment-1',
          order_id: 'order-unknown',
          status: 'COMPLETED',
          amount_money: { amount: 1000, currency: 'JPY' },
          card_details: { card: { last_4: '4242' } },
          buyer_email_address: 'buyer@example.com',
        },
      },
    },
  };
}

function mockVault(valid: boolean): LibralVaultClient {
  return {
    hmacVerify: vi.fn().mockResolvedValue({ valid }),
    actionsHttp: vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        payment_link: {
          id: 'plink-1',
          order_id: 'order-1',
          url: 'https://square.link/checkout/abc',
          created_at: '2026-09-17T00:00:00Z',
        },
      }),
    }),
  };
}

function mockProjection(db?: ReturnType<typeof createMemoryD1>): AsteraProjectionClient & { postBillingEvent: ReturnType<typeof vi.fn> } {
  const getEventFromDb = (eventId: string) => {
    const row = db?.tables.get('billing_events')?.find((entry) => entry.provider_event_id === eventId);
    if (!row) return null;
    return {
      processing_status: String(row.processing_status ?? ''),
      billing_intent_id: (row.billing_intent_id as string | null) ?? null,
    };
  };
  return {
    postBillingEvent: vi.fn().mockResolvedValue({ duplicate: false, processing_status: 'recorded' }),
    postIntentStatus: vi.fn().mockResolvedValue(undefined),
    postCreditGrant: vi.fn().mockResolvedValue(undefined),
    postStorageGrant: vi.fn().mockResolvedValue(undefined),
    postSubscription: vi.fn().mockResolvedValue(undefined),
    getActor: vi.fn().mockRejectedValue(new Error('not used')),
    getCatalog: vi.fn().mockRejectedValue(new Error('not used')),
    getSubscription: vi.fn().mockResolvedValue(null),
    getBillingIntentByIdempotency: vi.fn().mockResolvedValue(null),
    getBillingIntentLookup: vi.fn().mockResolvedValue(null),
    getStorageIntentByIdempotency: vi.fn().mockResolvedValue(null),
    getStorageIntentByOrderId: vi.fn().mockResolvedValue(null),
    getStorageIntentById: vi.fn().mockResolvedValue(null),
    getStorageCommerce: vi.fn().mockRejectedValue(new Error('not used')),
    getStorageProduct: vi.fn().mockRejectedValue(new Error('not used')),
    getPendingStorageCapacityGb: vi.fn().mockResolvedValue(0),
    getLedgerGrant: vi.fn().mockResolvedValue(null),
    getEvent: vi.fn().mockImplementation(async (eventId: string) => getEventFromDb(eventId)),
    hasSignupBonus: vi.fn().mockResolvedValue(false),
    getProfileCreatedAt: vi.fn().mockResolvedValue(null),
    getCreditAccount: vi.fn().mockRejectedValue(new Error('not used')),
    postIntentCreate: vi.fn().mockResolvedValue({ duplicate: false }),
    postIntentCheckoutCreated: vi.fn().mockResolvedValue(undefined),
    postStorageIntentCreate: vi.fn().mockResolvedValue({ duplicate: false }),
    postStorageIntentCheckoutCreated: vi.fn().mockResolvedValue(undefined),
    postStorageIntentFailed: vi.fn().mockResolvedValue(undefined),
    postStorageIntentPayment: vi.fn().mockResolvedValue({ matched: false, processing_status: null }),
    postIntentPaymentApply: vi.fn().mockResolvedValue({ processing_status: 'unmatched_order', billing_intent_id: null }),
    postEventStartProcessing: vi.fn().mockImplementation(async (payload: Record<string, unknown>) => {
      const eventId = String(payload.provider_event_id ?? '');
      const existing = getEventFromDb(eventId);
      if (existing?.processing_status && existing.processing_status !== 'processing') {
        return { duplicate: true, processing_status: existing.processing_status };
      }
      return { duplicate: false, processing_status: 'processing' };
    }),
    postEventMeta: vi.fn().mockResolvedValue({ billing_intent_id: null, processing_status: 'recorded' }),
    postWebhookInvoicePayment: vi.fn().mockResolvedValue({ processing_status: 'ignored_missing_subscription_id' }),
    postWebhookSubscription: vi.fn().mockResolvedValue({ processing_status: 'ignored_missing_subscription_id' }),
    postWebhookIntentReconciliation: vi.fn().mockResolvedValue({ processing_status: 'recorded', billing_intent_id: null }),
    postWebhookInvoiceProjection: vi.fn().mockResolvedValue({ processing_status: 'recorded', billing_intent_id: null }),
    postWebhookPayoutRecorded: vi.fn().mockResolvedValue({ processing_status: 'recorded', billing_intent_id: null }),
  };
}

function testEnv(
  db = createMemoryD1(),
  vault: LibralVaultClient = mockVault(true),
  projection: AsteraProjectionClient | null = null,
): BillingServiceEnv {
  return {
    SQUARE_WEBHOOK_NOTIFICATION_URL: NOTIFICATION_URL,
    VAULT_SQUARE_WEBHOOK_HMAC_SECRET_ID: 'square-webhook-hmac-secret-id',
    VAULT_SQUARE_ACCESS_SECRET_ID: 'square-access-secret-id',
    SQUARE_LOCATION_ID: 'LOC1',
    SQUARE_ENVIRONMENT: 'sandbox',
    APP_PUBLIC_ORIGIN: 'https://localhost',
    BILLING_APP_SECRET: 'billing-test-secret',
    ASTERA_DB: db,
    vault,
    projection,
  };
}

describe('square direct webhook', () => {
  it('accepts valid square signature (mock vault valid:true) → 2xx', async () => {
    const eventId = crypto.randomUUID();
    const payload = JSON.stringify(squareEvent(eventId, 'payment.created'));
    const request = new Request('http://127.0.0.1/webhooks/square', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-square-hmacsha256-signature': 'valid-signature-base64',
      },
      body: payload,
    });
    const response = await handleSquareWebhook(request, testEnv(createMemoryD1(), mockVault(true), mockProjection(createMemoryD1())));
    expect(response.status).toBe(202);
  });

  it('rejects invalid signature with 401 and does not call projection', async () => {
    const projection = mockProjection();
    const payload = JSON.stringify(squareEvent(crypto.randomUUID(), 'payment.created'));
    const request = new Request('http://127.0.0.1/webhooks/square', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-square-hmacsha256-signature': 'bad-signature',
      },
      body: payload,
    });
    const response = await handleSquareWebhook(request, testEnv(createMemoryD1(), mockVault(false), projection));
    expect(response.status).toBe(401);
    expect(projection.postBillingEvent).not.toHaveBeenCalled();
  });

  it('rejects missing signature with 401', async () => {
    const payload = JSON.stringify(squareEvent(crypto.randomUUID(), 'payment.created'));
    const request = new Request('http://127.0.0.1/webhooks/square', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: payload,
    });
    const vault = mockVault(true);
    const response = await handleSquareWebhook(request, testEnv(createMemoryD1(), vault));
    expect(response.status).toBe(401);
    expect(vault.hmacVerify).not.toHaveBeenCalled();
  });

  it('ignores valid signed unsupported webhook event with 200', async () => {
    const payload = JSON.stringify(squareEvent(crypto.randomUUID(), 'customer.created'));
    const request = new Request('http://127.0.0.1/webhooks/square', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-square-hmacsha256-signature': 'valid-signature-base64',
      },
      body: payload,
    });
    const response = await handleSquareWebhook(request, testEnv(createMemoryD1(), mockVault(true), mockProjection(createMemoryD1())));
    expect(response.status).toBe(200);
    const json = await response.json() as { processing_status: string; accepted: boolean };
    expect(json.accepted).toBe(true);
    expect(json.processing_status).toBe('ignored_event_type');
  });

  it('returns 400 when event_id/type missing', async () => {
    const payload = JSON.stringify({ merchant_id: 'm', data: {} });
    const request = new Request('http://127.0.0.1/webhooks/square', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-square-hmacsha256-signature': 'sig',
      },
      body: payload,
    });
    const response = await handleSquareWebhook(request, testEnv());
    expect(response.status).toBe(400);
  });

  it('returns idempotent response for duplicate event_id', async () => {
    const db = createMemoryD1();
    const eventId = crypto.randomUUID();
    const payload = JSON.stringify(squareEvent(eventId, 'payment.updated'));
    const makeRequest = () => new Request('http://127.0.0.1/webhooks/square', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-square-hmacsha256-signature': 'sig',
      },
      body: payload,
    });
    db.tables.set('billing_events', [{
      provider_event_id: eventId,
      processing_status: 'processed',
      billing_intent_id: null,
    }]);
    const response = await handleSquareWebhook(makeRequest(), testEnv(db, mockVault(true), mockProjection(db)));
    expect(response.status).toBe(200);
    const json = await response.json() as { duplicate: boolean };
    expect(json.duplicate).toBe(true);
  });

  it('retired gateway ingress returns 410', async () => {
    const response = await handleSquareIngress(new Request('http://127.0.0.1/ingress/square-payments', { method: 'POST' }), testEnv());
    expect(response.status).toBe(410);
  });
});

describe('square event routing', () => {
  it('declares 19 supported Square event types', () => {
    expect(SQUARE_SUPPORTED_EVENT_TYPES).toHaveLength(19);
  });

  it.each(SQUARE_SUPPORTED_EVENT_TYPES)('routes event type %s', async (eventType) => {
    const eventId = crypto.randomUUID();
    const payload = JSON.stringify(squareEvent(eventId, eventType));
    const request = new Request('http://127.0.0.1/webhooks/square', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-square-hmacsha256-signature': 'sig',
      },
      body: payload,
    });
    const response = await handleSquareWebhook(
      request,
      testEnv(createMemoryD1(), mockVault(true), mockProjection(createMemoryD1())),
    );
    expect([200, 202]).toContain(response.status);
  });
});

describe('PII redaction', () => {
  it('redacts card and email fields before persistence path', () => {
    const redacted = redactSquareWebhookPayload(squareEvent('evt', 'payment.created')) as {
      data: { object: { payment: Record<string, unknown> } };
    };
    expect(redacted.data.object.payment.card_details).toBe('[REDACTED]');
    expect(redacted.data.object.payment.buyer_email_address).toBe('[REDACTED]');
  });
});

describe('checkout idempotency key', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('uses Idempotency-Key for Square checkout API call via Vault actions/http without returning token', async () => {
    const vault = mockVault(true);
    await createSquareCheckout({ env: testEnv(), vault }, {
      idempotencyKey: 'idem-key-123',
      intentId: 'intent-1',
      displayName: 'Test Product',
      amount: 1000,
      currency: 'JPY',
    });

    expect(vault.actionsHttp).toHaveBeenCalledTimes(1);
    const [call] = (vault.actionsHttp as ReturnType<typeof vi.fn>).mock.calls;
    expect(call[0].url).toBe('https://connect.squareupsandbox.com/v2/online-checkout/payment-links');
    expect(call[0].secretHeader).toBe('Authorization');
    expect(call[0].secretPrefix).toBe('Bearer ');
    const body = call[0].body as { idempotency_key: string };
    expect(body.idempotency_key).toBe('idem-key-123');
    const resolved = await (vault.actionsHttp as ReturnType<typeof vi.fn>).mock.results[0]?.value;
    expect(JSON.stringify(resolved)).not.toMatch(/sandbox-token|Bearer\s+[A-Za-z0-9._-]{8,}/);
  });
});

describe('projection sync', () => {
  it('calls projection API once for accepted webhook when configured', async () => {
    const projection = mockProjection();
    const eventId = crypto.randomUUID();
    const payload = JSON.stringify(squareEvent(eventId, 'payment.created'));
    const request = new Request('http://127.0.0.1/webhooks/square', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-square-hmacsha256-signature': 'sig',
      },
      body: payload,
    });
    await handleSquareWebhook(request, testEnv(createMemoryD1(), mockVault(true), projection ?? mockProjection(createMemoryD1())));
    expect(projection.postBillingEvent).toHaveBeenCalledTimes(1);
    const [body] = projection.postBillingEvent.mock.calls[0]!;
    expect(body.idempotency_key).toBe(eventId);
    expect(body.correlation_id).toBeTruthy();
  });
});

describe('payment-first reconciliation recovery', () => {
  function makeRecoveryFixture(overrides: Record<string, unknown> = {}) {
    return {
      id: 'intent-recovery-1',
      tenant_id: 'tenant-1',
      user_id: 'user-1',
      catalog_version: 'catalog-v1',
      product_id: 'plan-1',
      product_kind: 'plan',
      billing_cycle: 'monthly',
      currency: 'JPY',
      amount: 1000,
      credit_amount: 0,
      status: 'reconciliation_required',
      provider_order_id: 'order-123',
      provider_payment_id: 'payment-1',
      failure_code: 'SUBSCRIPTION_ID_RECONCILIATION_REQUIRED',
      created_at: '2026-09-19T00:01:33Z',
      updated_at: '2026-09-19T00:01:34Z',
      ...overrides,
    };
  }

  it('recovers the exact pending intent when the matching subscription mapping arrives later', async () => {
    const db = createMemoryD1();
    const intentId = 'intent-recovery-1';
    db.tables.set('billing_intents', [makeRecoveryFixture({ id: intentId })]);
    db.tables.set('tenant_subscriptions', [{
      id: 'sub-row-1',
      tenant_id: 'tenant-1',
      catalog_version: 'catalog-v1',
      plan_id: 'plan-1',
      billing_cycle: 'monthly',
      provider_subscription_id: 'sub-abc',
      status: 'active',
      cancel_at_period_end: 0,
      created_at: '2026-09-19T00:02:00Z',
      updated_at: '2026-09-19T00:02:00Z',
    }]);

    const result = await writeWebhookInvoicePayment(db, {
      provider_event_id: 'invoice-evt-1',
      provider_order_id: 'order-123',
      provider_subscription_id: 'sub-abc',
    });

    expect(result.processing_status).toBe('processed');
    const intent = db.tables.get('billing_intents')!.find((row) => row.id === intentId)!;
    expect(intent.status).toBe('completed');
    expect(intent.provider_payment_id).toBe('payment-1');
  });

  it('recoverExactReconciliationIntent() succeeds only when all required exact conditions match', async () => {
    const db = createMemoryD1();
    const intentId = 'intent-direct-positive';
    db.tables.set('billing_intents', [makeRecoveryFixture({ id: intentId })]);
    db.tables.set('tenant_subscriptions', [{
      id: 'sub-row-positive',
      tenant_id: 'tenant-1',
      catalog_version: 'catalog-v1',
      plan_id: 'plan-1',
      billing_cycle: 'monthly',
      provider_subscription_id: 'sub-abc',
      status: 'active',
      cancel_at_period_end: 0,
      created_at: '2026-09-19T00:02:00Z',
      updated_at: '2026-09-19T00:02:00Z',
    }]);

    const result = await recoverExactReconciliationIntent(db, {
      provider_event_id: 'evt-positive',
      provider_order_id: 'order-123',
      provider_subscription_id: 'sub-abc',
    });

    expect(result).not.toBeNull();
    expect(result?.processing_status).toBe('processed');
    const intent = db.tables.get('billing_intents')!.find((row) => row.id === intentId)!;
    expect(intent.status).toBe('completed');
    expect(intent.failure_code).toBeNull();
  });

  it('recoverExactReconciliationIntent() returns null for wrong tenant', async () => {
    const db = createMemoryD1();
    db.tables.set('billing_intents', [makeRecoveryFixture({ tenant_id: 'tenant-9' })]);
    db.tables.set('tenant_subscriptions', [{
      id: 'sub-row-tenant',
      tenant_id: 'tenant-1',
      catalog_version: 'catalog-v1',
      plan_id: 'plan-1',
      billing_cycle: 'monthly',
      provider_subscription_id: 'sub-abc',
      status: 'active',
      cancel_at_period_end: 0,
      created_at: '2026-09-19T00:02:00Z',
      updated_at: '2026-09-19T00:02:00Z',
    }]);

    const result = await recoverExactReconciliationIntent(db, {
      provider_event_id: 'evt-tenant',
      provider_order_id: 'order-123',
      provider_subscription_id: 'sub-abc',
    });
    expect(result).toBeNull();
  });

  it('recoverExactReconciliationIntent() returns null for wrong order', async () => {
    const db = createMemoryD1();
    db.tables.set('billing_intents', [makeRecoveryFixture({ provider_order_id: 'order-777' })]);
    db.tables.set('tenant_subscriptions', [{
      id: 'sub-row-order',
      tenant_id: 'tenant-1',
      catalog_version: 'catalog-v1',
      plan_id: 'plan-1',
      billing_cycle: 'monthly',
      provider_subscription_id: 'sub-abc',
      status: 'active',
      cancel_at_period_end: 0,
      created_at: '2026-09-19T00:02:00Z',
      updated_at: '2026-09-19T00:02:00Z',
    }]);

    const result = await recoverExactReconciliationIntent(db, {
      provider_event_id: 'evt-order',
      provider_order_id: 'order-123',
      provider_subscription_id: 'sub-abc',
    });
    expect(result).toBeNull();
  });

  it('recoverExactReconciliationIntent() returns null for wrong subscription', async () => {
    const db = createMemoryD1();
    db.tables.set('billing_intents', [makeRecoveryFixture()]);
    db.tables.set('tenant_subscriptions', [{
      id: 'sub-row-sub',
      tenant_id: 'tenant-1',
      catalog_version: 'catalog-v1',
      plan_id: 'plan-1',
      billing_cycle: 'monthly',
      provider_subscription_id: 'sub-other',
      status: 'active',
      cancel_at_period_end: 0,
      created_at: '2026-09-19T00:02:00Z',
      updated_at: '2026-09-19T00:02:00Z',
    }]);

    const result = await recoverExactReconciliationIntent(db, {
      provider_event_id: 'evt-sub',
      provider_order_id: 'order-123',
      provider_subscription_id: 'sub-abc',
    });
    expect(result).toBeNull();
  });

  it('recoverExactReconciliationIntent() does not recover a different order when same tenant and plan exist', async () => {
    const db = createMemoryD1();
    const correctIntent = makeRecoveryFixture({ id: 'intent-correct', provider_order_id: 'order-123' });
    const wrongIntent = makeRecoveryFixture({ id: 'intent-wrong', provider_order_id: 'order-456' });
    db.tables.set('billing_intents', [correctIntent, wrongIntent]);
    db.tables.set('tenant_subscriptions', [{
      id: 'sub-row-multi',
      tenant_id: 'tenant-1',
      catalog_version: 'catalog-v1',
      plan_id: 'plan-1',
      billing_cycle: 'monthly',
      provider_subscription_id: 'sub-abc',
      status: 'active',
      cancel_at_period_end: 0,
      created_at: '2026-09-19T00:02:00Z',
      updated_at: '2026-09-19T00:02:00Z',
    }]);

    const result = await recoverExactReconciliationIntent(db, {
      provider_event_id: 'evt-multi',
      provider_order_id: 'order-123',
      provider_subscription_id: 'sub-abc',
    });

    expect(result).not.toBeNull();
    expect(result?.processing_status).toBe('processed');
    expect(db.tables.get('billing_intents')!.find((row) => row.id === 'intent-correct')!.status).toBe('completed');
    expect(db.tables.get('billing_intents')!.find((row) => row.id === 'intent-wrong')!.status).toBe('reconciliation_required');
  });

  it('recoverExactReconciliationIntent() returns null for plan mismatch', async () => {
    const db = createMemoryD1();
    db.tables.set('billing_intents', [makeRecoveryFixture({ product_id: 'plan-2' })]);
    db.tables.set('tenant_subscriptions', [{
      id: 'sub-row-plan',
      tenant_id: 'tenant-1',
      catalog_version: 'catalog-v1',
      plan_id: 'plan-1',
      billing_cycle: 'monthly',
      provider_subscription_id: 'sub-abc',
      status: 'active',
      cancel_at_period_end: 0,
      created_at: '2026-09-19T00:02:00Z',
      updated_at: '2026-09-19T00:02:00Z',
    }]);

    const result = await recoverExactReconciliationIntent(db, {
      provider_event_id: 'evt-plan',
      provider_order_id: 'order-123',
      provider_subscription_id: 'sub-abc',
    });
    expect(result).toBeNull();
  });

  it('recoverExactReconciliationIntent() returns null for billing cycle mismatch', async () => {
    const db = createMemoryD1();
    db.tables.set('billing_intents', [makeRecoveryFixture({ billing_cycle: 'yearly' })]);
    db.tables.set('tenant_subscriptions', [{
      id: 'sub-row-cycle',
      tenant_id: 'tenant-1',
      catalog_version: 'catalog-v1',
      plan_id: 'plan-1',
      billing_cycle: 'monthly',
      provider_subscription_id: 'sub-abc',
      status: 'active',
      cancel_at_period_end: 0,
      created_at: '2026-09-19T00:02:00Z',
      updated_at: '2026-09-19T00:02:00Z',
    }]);

    const result = await recoverExactReconciliationIntent(db, {
      provider_event_id: 'evt-cycle',
      provider_order_id: 'order-123',
      provider_subscription_id: 'sub-abc',
    });
    expect(result).toBeNull();
  });

  it('recoverExactReconciliationIntent() returns null when status is not reconciliation_required', async () => {
    const db = createMemoryD1();
    db.tables.set('billing_intents', [makeRecoveryFixture({ status: 'completed' })]);
    db.tables.set('tenant_subscriptions', [{
      id: 'sub-row-status',
      tenant_id: 'tenant-1',
      catalog_version: 'catalog-v1',
      plan_id: 'plan-1',
      billing_cycle: 'monthly',
      provider_subscription_id: 'sub-abc',
      status: 'active',
      cancel_at_period_end: 0,
      created_at: '2026-09-19T00:02:00Z',
      updated_at: '2026-09-19T00:02:00Z',
    }]);

    const result = await recoverExactReconciliationIntent(db, {
      provider_event_id: 'evt-status',
      provider_order_id: 'order-123',
      provider_subscription_id: 'sub-abc',
    });
    expect(result).toBeNull();
  });

  it('recoverExactReconciliationIntent() returns null when failure_code is not the required one', async () => {
    const db = createMemoryD1();
    db.tables.set('billing_intents', [makeRecoveryFixture({ failure_code: 'OTHER_FAILURE' })]);
    db.tables.set('tenant_subscriptions', [{
      id: 'sub-row-failure',
      tenant_id: 'tenant-1',
      catalog_version: 'catalog-v1',
      plan_id: 'plan-1',
      billing_cycle: 'monthly',
      provider_subscription_id: 'sub-abc',
      status: 'active',
      cancel_at_period_end: 0,
      created_at: '2026-09-19T00:02:00Z',
      updated_at: '2026-09-19T00:02:00Z',
    }]);

    const result = await recoverExactReconciliationIntent(db, {
      provider_event_id: 'evt-failure',
      provider_order_id: 'order-123',
      provider_subscription_id: 'sub-abc',
    });
    expect(result).toBeNull();
  });

  it('does not recover a different order when the provider_order_id does not match exactly', async () => {
    const db = createMemoryD1();
    db.tables.set('billing_intents', [makeRecoveryFixture({ provider_order_id: 'order-123' })]);
    db.tables.set('tenant_subscriptions', [{
      id: 'sub-row-2',
      tenant_id: 'tenant-1',
      catalog_version: 'catalog-v1',
      plan_id: 'plan-1',
      billing_cycle: 'monthly',
      provider_subscription_id: 'sub-abc',
      status: 'active',
      cancel_at_period_end: 0,
      created_at: '2026-09-19T00:02:00Z',
      updated_at: '2026-09-19T00:02:00Z',
    }]);

    const matched = await recoverExactReconciliationIntent(db, {
      provider_event_id: 'evt-no-match',
      provider_order_id: 'order-999',
      provider_subscription_id: 'sub-abc',
    });

    expect(matched).toBeNull();
  });
});
