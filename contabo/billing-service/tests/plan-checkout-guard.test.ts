import { describe, expect, it, vi } from 'vitest';
import { assertOrReusePlanCheckout } from '../src/feature/plan-checkout-guard.js';
import type { AsteraProjectionClient, BillingIntentRecord } from '../src/feature/astera-projection.js';
import { FunctionHttpError } from '../src/part/billing-env.js';

function projectionMock(partial: Partial<AsteraProjectionClient>): AsteraProjectionClient {
  return partial as AsteraProjectionClient;
}

describe('assertOrReusePlanCheckout', () => {
  it('returns SUBSCRIPTION_ALREADY_ACTIVE before pending when subscription is live', async () => {
    const postIntentStatus = vi.fn(async () => undefined);
    const client = projectionMock({
      getSubscription: async () => ({
        plan_id: 'basic',
        billing_cycle: 'monthly',
        provider_subscription_id: 'sub_live',
        status: 'active',
      }),
      listPendingPlanIntents: async () => [
        {
          id: 'pending-1',
          status: 'checkout_created',
          checkout_url: 'https://sandbox.square.link/u/x',
          expires_at: '2099-01-01T00:00:00.000Z',
        } as BillingIntentRecord,
      ],
      getLatestPendingPlanIntent: async () => null,
      postIntentStatus,
    });

    await expect(
      assertOrReusePlanCheckout(client, {
        tenantId: 't1',
        userId: 'u1',
        planId: 'basic',
        billingCycle: 'monthly',
        correlationId: 'c1',
      }),
    ).rejects.toMatchObject({ code: 'SUBSCRIPTION_ALREADY_ACTIVE', status: 409 });

    expect(postIntentStatus).toHaveBeenCalled();
  });

  it('reuses genuine pending checkout when no live subscription', async () => {
    const pending = {
      id: 'pending-2',
      user_id: 'u1',
      product_id: 'basic',
      billing_cycle: 'monthly',
      status: 'checkout_created',
      checkout_url: 'https://sandbox.square.link/u/y',
      provider_checkout_id: 'CHK',
      provider_order_id: 'ORD',
      expires_at: '2099-01-01T00:00:00.000Z',
    } as BillingIntentRecord;
    const client = projectionMock({
      getSubscription: async () => null,
      getLatestPendingPlanIntent: async () => pending,
      listPendingPlanIntents: async () => [pending],
      postIntentStatus: async () => undefined,
    });

    const result = await assertOrReusePlanCheckout(client, {
      tenantId: 't1',
      userId: 'u1',
      planId: 'basic',
      billingCycle: 'monthly',
      correlationId: 'c1',
    });
    expect(result).toEqual({ reuse: true, intent: pending });
  });

  it('terminalizes expired pending and allows new checkout', async () => {
    const postIntentStatus = vi.fn(async () => undefined);
    const client = projectionMock({
      getSubscription: async () => null,
      getLatestPendingPlanIntent: async () =>
        ({
          id: 'expired-1',
          status: 'checkout_created',
          checkout_url: 'https://sandbox.square.link/u/z',
          expires_at: '2000-01-01T00:00:00.000Z',
        }) as BillingIntentRecord,
      listPendingPlanIntents: async () => [],
      postIntentStatus,
    });

    const result = await assertOrReusePlanCheckout(client, {
      tenantId: 't1',
      userId: 'u1',
      planId: 'basic',
      billingCycle: 'monthly',
      correlationId: 'c1',
    });
    expect(result).toBeNull();
    expect(postIntentStatus).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', failure_code: 'CHECKOUT_EXPIRED' }),
    );
  });

  it('does not treat completed as pending', async () => {
    const client = projectionMock({
      getSubscription: async () => null,
      getLatestPendingPlanIntent: async () =>
        ({
          id: 'done-1',
          status: 'completed',
          checkout_url: 'https://sandbox.square.link/u/done',
          expires_at: '2099-01-01T00:00:00.000Z',
        }) as BillingIntentRecord,
      listPendingPlanIntents: async () => [],
      postIntentStatus: async () => undefined,
    });

    const result = await assertOrReusePlanCheckout(client, {
      tenantId: 't1',
      userId: 'u1',
      planId: 'basic',
      billingCycle: 'monthly',
      correlationId: 'c1',
    });
    expect(result).toBeNull();
  });

  it('blocks reuse while a paid reconciliation intent is unresolved', async () => {
    const postIntentStatus = vi.fn(async () => undefined);
    const client = projectionMock({
      getSubscription: async () => null,
      getLatestPendingPlanIntent: async () =>
        ({
          id: 'recon-1',
          status: 'reconciliation_required',
          failure_code: 'SUBSCRIPTION_ID_RECONCILIATION_REQUIRED',
          provider_payment_id: 'pay-1',
          checkout_url: null,
          expires_at: '2099-01-01T00:00:00.000Z',
        }) as BillingIntentRecord,
      listPendingPlanIntents: async () => [],
      postIntentStatus,
    });

    await expect(
      assertOrReusePlanCheckout(client, {
        tenantId: 't1',
        userId: 'u1',
        planId: 'basic',
        billingCycle: 'monthly',
        correlationId: 'c1',
      }),
    ).rejects.toMatchObject({ code: 'PLAN_CHECKOUT_RECONCILIATION_REQUIRED', status: 409 });

    expect(postIntentStatus).not.toHaveBeenCalled();
  });
});

describe('FunctionHttpError shape', () => {
  it('exposes status/code', () => {
    const err = new FunctionHttpError(409, 'X', 'msg');
    expect(err.status).toBe(409);
    expect(err.code).toBe('X');
  });
});
