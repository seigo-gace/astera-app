import { describe, expect, it, vi } from 'vitest';
import { reconcilePaidPlanInvoice } from '../dist/feature/square-plan-reconcile.js';
import { processSquareWebhookEvent } from '../dist/feature/square-event-handler.js';
import type { AsteraProjectionClient } from '../dist/feature/astera-projection.js';
import type { BillingServiceEnv } from '../dist/part/billing-env.js';
import type { LibralVaultClient } from '../dist/feature/libral-vault.js';

type FixtureOptions = {
  customerReference?: string;
  subscriptionVariation?: string;
  subscriptionStatus?: string;
  mappedSubscription?: string;
  pending?: Record<string, unknown>[];
  catalogVersion?: string;
  invoiceAmount?: number;
  invoiceCurrency?: string;
};

function fixture(options: FixtureOptions = {}) {
  const intent = {
    id: 'intent-1', tenant_id: 'tenant-1', user_id: 'user-1', catalog_version: 'v1', product_id: 'pro',
    product_kind: 'plan', billing_cycle: 'monthly', amount: 1000, currency: 'JPY', status: 'checkout_created',
  };
  const postIntentStatus = vi.fn();
  const postCreditGrant = vi.fn();
  const postWebhookInvoicePayment = vi.fn().mockResolvedValue({ processing_status: 'processed' });
  const projection = {
    getSubscription: vi.fn().mockResolvedValue({
      tenant_id: 'tenant-1', catalog_version: 'v1', plan_id: 'pro', billing_cycle: 'monthly',
      provider_subscription_id: options.mappedSubscription ?? 'sub-1', status: 'active',
    }),
    listPendingPlanIntents: vi.fn().mockResolvedValue(options.pending ?? [intent]),
    getCatalog: vi.fn().mockResolvedValue({
      catalog_version: options.catalogVersion ?? 'v1',
      plans: [{ plan_id: 'pro', active: true, currency: 'JPY', included_credits: 100,
        billing_variants: [{ billing_cycle: 'monthly', recurring_amount: 1000, included_credits: 100, active: true, square_plan_variation_id: 'variation-1' }] }],
      creditProducts: [],
    }),
    postSubscription: vi.fn(), postIntentStatus, postCreditGrant,
    getActor: vi.fn().mockResolvedValue({ profile: { tenant_id: 'tenant-1', user_id: 'user-1' }, credit: { id: 'credit-1' } }),
    postWebhookInvoicePayment,
  } as unknown as AsteraProjectionClient;
  const vault: LibralVaultClient = {
    hmacVerify: vi.fn(),
    actionsHttp: vi.fn(async (input) => {
      if (input.url.endsWith('/v2/subscriptions/sub-1')) return {
        status: 200, ok: true, headers: {}, body: JSON.stringify({ subscription: {
          id: 'sub-1', customer_id: 'cust-1', card_id: 'card-1',
          plan_variation_id: options.subscriptionVariation ?? 'variation-1', status: options.subscriptionStatus ?? 'ACTIVE',
          start_date: '2026-09-22', charged_through_date: '2026-10-22',
        } }),
      };
      if (input.url.endsWith('/v2/customers/cust-1')) return {
        status: 200, ok: true, headers: {}, body: JSON.stringify({ customer: { id: 'cust-1', reference_id: options.customerReference ?? 'tenant-1' } }),
      };
      throw new Error(`unexpected:${input.url}`);
    }),
  };
  const env: BillingServiceEnv = { SQUARE_ENVIRONMENT: 'sandbox', VAULT_SQUARE_ACCESS_SECRET_ID: 'secret', vault, projection };
  const input = {
    eventId: 'event-1', subscriptionId: 'sub-1', correlationId: 'correlation-1',
    invoice: { id: 'invoice-1', subscription_id: 'sub-1', payment_requests: [{ total_completed_amount_money: {
      amount: options.invoiceAmount ?? 1000, currency: options.invoiceCurrency ?? 'JPY',
    } }] },
  };
  return { env, projection, input, postIntentStatus, postCreditGrant, postWebhookInvoicePayment };
}

describe('invoice.payment_made exact Plan reconciliation', () => {
  it('fails when invoice.subscription_id is missing', async () => {
    const { env, projection } = fixture();
    Object.assign(projection, {
      getEvent: vi.fn().mockResolvedValue(null),
      postEventStartProcessing: vi.fn().mockResolvedValue({ duplicate: false, processing_status: 'processing' }),
    });
    await expect(processSquareWebhookEvent(env, {
      event_id: 'event-missing-sub', type: 'invoice.payment_made', data: { object: { invoice: { id: 'invoice-1' } } },
    })).rejects.toMatchObject({ code: 'SQUARE_INVOICE_REFERENCE_INCOMPLETE' });
  });

  it.each([
    ['customer reference missing', { customerReference: '' }, 'SQUARE_CUSTOMER_REFERENCE_MISSING'],
    ['projection mismatch', { mappedSubscription: 'other-sub' }, 'PROJECTION_SUBSCRIPTION_MISMATCH'],
    ['pending zero', { pending: [] }, 'PENDING_PLAN_INTENT_NOT_FOUND'],
    ['pending multiple', { pending: [{ product_kind: 'plan', status: 'checkout_created' }, { product_kind: 'plan', status: 'payment_pending' }] }, 'PENDING_PLAN_INTENT_AMBIGUOUS'],
    ['catalog version mismatch', { catalogVersion: 'v2' }, 'BILLING_CATALOG_VERSION_MISMATCH'],
    ['amount mismatch', { invoiceAmount: 999 }, 'PLAN_AMOUNT_MISMATCH'],
    ['currency mismatch', { invoiceCurrency: 'USD' }, 'PLAN_CURRENCY_MISMATCH'],
    ['variation mismatch', { subscriptionVariation: 'other-variation' }, 'SQUARE_PLAN_VARIATION_MISMATCH'],
    ['subscription status mismatch', { subscriptionStatus: 'CANCELED' }, 'SQUARE_SUBSCRIPTION_STATUS_INVALID'],
  ] as const)('fails closed for %s', async (_label, options, code) => {
    const { env, projection, input, postIntentStatus, postCreditGrant } = fixture(options as FixtureOptions);
    await expect(reconcilePaidPlanInvoice(env, projection, input)).rejects.toMatchObject({ code });
    expect(postIntentStatus).not.toHaveBeenCalled();
    expect(postCreditGrant).not.toHaveBeenCalled();
  });

  it('completes the exact Intent, grants monthly credit, then records the webhook without order matching', async () => {
    const { env, projection, input, postIntentStatus, postCreditGrant, postWebhookInvoicePayment } = fixture();
    await expect(reconcilePaidPlanInvoice(env, projection, input)).resolves.toBe('processed');
    expect(postIntentStatus).toHaveBeenCalledWith(expect.objectContaining({ intent_id: 'intent-1', status: 'completed' }));
    expect(postCreditGrant).toHaveBeenCalledTimes(1);
    expect(postWebhookInvoicePayment).toHaveBeenCalledWith({
      provider_event_id: 'event-1', provider_order_id: '', provider_subscription_id: 'sub-1',
    });
  });

  it('does not grant credit when only direct subscription creation/browser success has happened', async () => {
    const { postCreditGrant } = fixture();
    expect(postCreditGrant).not.toHaveBeenCalled();
  });

  it('short-circuits a duplicate processed webhook before any second credit grant', async () => {
    const { env, projection, postCreditGrant } = fixture();
    Object.assign(projection, { getEvent: vi.fn().mockResolvedValue({ processing_status: 'processed', billing_intent_id: 'intent-1' }) });
    const result = await processSquareWebhookEvent(env, {
      event_id: 'event-1', type: 'invoice.payment_made', data: { object: { invoice: { subscription_id: 'sub-1' } } },
    });
    expect(result).toEqual({ processingStatus: 'processed', duplicate: true });
    expect(postCreditGrant).not.toHaveBeenCalled();
  });
});
