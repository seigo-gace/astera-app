import { describe, expect, it, vi } from 'vitest';
import { handleBillingCheckoutIntents } from '../dist/system/handlers-billing-checkout.js';
import { handlePlanSubscription } from '../dist/system/handlers-plan-subscription.js';
import type { AsteraProjectionClient } from '../dist/feature/astera-projection.js';
import type { BillingServiceEnv } from '../dist/part/billing-env.js';
import type { LibralVaultClient } from '../dist/feature/libral-vault.js';

const actor = {
  profile: { user_id: 'user-1', tenant_id: 'tenant-1', nickname: 'U', account_status: 'active', ui_language: 'ja-JP', created_at: '', updated_at: '' },
  credit: { id: 'credit-1', tenant_id: 'tenant-1', available_balance: 0, reserved_balance: 0, version: 1, updated_at: '' },
};
const plan = {
  plan_id: 'pro', id: 'pro', display_name: 'Pro', name: 'Pro', description: '', currency: 'JPY' as const,
  recurring_amount: 1000, recurring_interval: 'month', monthly_price_yen: 1000, price_label: '¥1,000 / 月',
  included_credits: 100, monthly_credits: 100, monthly_credits_label: '100', entitlement_ids: [], features: [],
  recommended: false, active: true, square_plan_variation_id: 'variation-1',
  billing_variants: [{ billing_cycle: 'monthly' as const, recurring_amount: 1000, recurring_interval: 'month' as const, included_credits: 100, price_label: '¥1,000 / 月', square_plan_variation_id: 'variation-1', active: true }],
};

function projection(overrides: Partial<AsteraProjectionClient> = {}): AsteraProjectionClient {
  return {
    getActor: vi.fn().mockResolvedValue(actor),
    getCatalog: vi.fn().mockResolvedValue({ catalog_version: 'v1', checksum: 'x', published_at: '', plans: [plan], creditProducts: [] }),
    getSubscription: vi.fn().mockResolvedValue(null),
    getBillingIntentByIdempotency: vi.fn().mockResolvedValue(null),
    getLatestPendingPlanIntent: vi.fn().mockResolvedValue(null),
    postIntentCreate: vi.fn().mockResolvedValue({ duplicate: false }),
    postSubscription: vi.fn(), postIntentStatus: vi.fn(),
    ...overrides,
  } as unknown as AsteraProjectionClient;
}

function vault(): LibralVaultClient {
  return { hmacVerify: vi.fn(), actionsHttp: vi.fn() };
}

function env(proj: AsteraProjectionClient, squareVault = vault()): BillingServiceEnv {
  return {
    BILLING_APP_SECRET: 'secret', projection: proj, vault: squareVault,
    SQUARE_LOCATION_ID: 'LOC1', SQUARE_ENVIRONMENT: 'sandbox', VAULT_SQUARE_ACCESS_SECRET_ID: 'square-secret',
  };
}

function request(path: string, body: unknown, verified = true): Request {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: {
      authorization: 'Bearer secret', 'content-type': 'application/json', 'idempotency-key': 'idem-1',
      'x-astera-tenant-id': 'tenant-1', 'x-astera-user-id': 'user-1', 'x-astera-user-email': 'verified@example.com',
      'x-astera-user-email-verified': verified ? 'true' : 'false',
    },
    body: JSON.stringify(body),
  });
}

describe('Plan direct endpoint gates', () => {
  it('creates a Plan Intent without invoking Hosted Checkout', async () => {
    const squareVault = vault();
    const response = await handleBillingCheckoutIntents(request('/api/billing/checkout-intents', { plan_id: 'pro', billing_cycle: 'monthly' }), env(projection(), squareVault));
    const body = await response.json() as any;
    expect(response.status).toBe(201);
    expect(body.payment_method).toBe('square_card');
    expect(body.checkout_url).toBeUndefined();
    expect(squareVault.actionsHttp).not.toHaveBeenCalled();
  });

  it('fails before Square when verified email is absent', async () => {
    const squareVault = vault();
    const response = await handlePlanSubscription(request('/api/billing/plan-subscriptions', { billing_intent_id: 'intent-1', source_id: 'token' }, false), env(projection(), squareVault));
    expect(response.status).toBe(403);
    expect((await response.json() as any).error.code).toBe('VERIFIED_EMAIL_REQUIRED');
    expect(squareVault.actionsHttp).not.toHaveBeenCalled();
  });

  it('fails before Square when an existing provider subscription is present', async () => {
    const squareVault = vault();
    const proj = projection({ getSubscription: vi.fn().mockResolvedValue({ provider_subscription_id: 'sub-existing', status: 'active' }) });
    const response = await handlePlanSubscription(request('/api/billing/plan-subscriptions', { billing_intent_id: 'intent-1', source_id: 'token' }), env(proj, squareVault));
    expect(response.status).toBe(409);
    expect((await response.json() as any).error.code).toBe('SUBSCRIPTION_ALREADY_EXISTS');
    expect(squareVault.actionsHttp).not.toHaveBeenCalled();
  });
});
