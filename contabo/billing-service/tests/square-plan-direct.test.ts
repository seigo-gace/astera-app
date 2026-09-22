import { describe, expect, it, vi } from 'vitest';
import { createDirectPlanSubscription } from '../dist/feature/square-plan-direct.js';
import type { BillingServiceEnv } from '../dist/part/billing-env.js';
import type { LibralVaultClient, VaultActionsHttpInput } from '../dist/feature/libral-vault.js';

const intentId = '11111111-1111-4111-8111-111111111111';
const envBase = {
  SQUARE_LOCATION_ID: 'LOC1',
  SQUARE_ENVIRONMENT: 'sandbox',
  VAULT_SQUARE_ACCESS_SECRET_ID: 'square-secret',
} satisfies BillingServiceEnv;

function response(body: unknown) {
  return { status: 200, ok: true, headers: {}, body: JSON.stringify(body) };
}

function vaultFor(options: { references?: unknown[]; emails?: unknown[]; cardMismatch?: boolean; subscriptionMismatch?: boolean } = {}) {
  const calls: VaultActionsHttpInput[] = [];
  const vault: LibralVaultClient = {
    hmacVerify: vi.fn(),
    actionsHttp: vi.fn(async (input) => {
      calls.push(input);
      if (input.url.endsWith('/v2/customers/search')) {
        const filter = (input.body as any).query.filter;
        return response({ customers: filter.reference_id ? (options.references ?? []) : (options.emails ?? []) });
      }
      if (input.url.endsWith('/v2/customers')) {
        return response({ customer: { id: 'cust-1', reference_id: 'tenant-1', email_address: 'verified@example.com' } });
      }
      if (input.url.endsWith('/v2/cards')) {
        return response({ card: { id: 'card-1', customer_id: options.cardMismatch ? 'wrong' : 'cust-1', reference_id: intentId } });
      }
      if (input.url.endsWith('/v2/subscriptions')) {
        return response({ subscription: { id: 'sub-1', customer_id: 'cust-1', card_id: 'card-1', plan_variation_id: options.subscriptionMismatch ? 'wrong' : 'variation-1', status: 'PENDING' } });
      }
      if (input.url.includes('/v2/customers/')) {
        return response({ customer: { id: 'cust-1', reference_id: 'tenant-1' } });
      }
      throw new Error(`unexpected:${input.url}`);
    }),
  };
  return { vault, calls };
}

async function create(vault: LibralVaultClient) {
  return createDirectPlanSubscription({ ...envBase, vault }, {
    intentId,
    tenantId: 'tenant-1',
    verifiedEmail: 'verified@example.com',
    sourceId: 'cnon:token',
    planVariationId: 'variation-1',
  });
}

describe('direct Square Plan subscription', () => {
  it('reuses the one exact customer reference and sends exact Card/Subscription bodies', async () => {
    const { vault, calls } = vaultFor({ references: [{ id: 'cust-1', reference_id: 'tenant-1' }] });
    await expect(create(vault)).resolves.toMatchObject({ subscriptionId: 'sub-1', cardId: 'card-1', status: 'pending' });
    expect(calls.some((call) => call.url.endsWith('/v2/customers'))).toBe(false);
    const card = calls.find((call) => call.url.endsWith('/v2/cards'))!.body as any;
    expect(card).toEqual({
      idempotency_key: `ast-card-${intentId.replaceAll('-', '')}`,
      source_id: 'cnon:token',
      card: { customer_id: 'cust-1', reference_id: intentId },
    });
    expect(String(card.idempotency_key)).toHaveLength(41);
    const subscription = calls.find((call) => call.url.endsWith('/v2/subscriptions'))!.body as any;
    expect(subscription).toEqual({
      idempotency_key: `ast-sub-${intentId.replaceAll('-', '')}`,
      location_id: 'LOC1',
      plan_variation_id: 'variation-1',
      customer_id: 'cust-1',
      card_id: 'card-1',
    });
  });

  it('creates a customer after exact reference and email searches both return zero', async () => {
    const { vault, calls } = vaultFor();
    await create(vault);
    const customer = calls.find((call) => call.url.endsWith('/v2/customers'))!.body as any;
    expect(customer).toMatchObject({ reference_id: 'tenant-1', email_address: 'verified@example.com' });
    expect(String(customer.idempotency_key)).toBe(`ast-cust-${intentId.replaceAll('-', '')}`);
  });

  it('reuses one exact email customer and binds the missing tenant reference', async () => {
    const { vault, calls } = vaultFor({ emails: [{ id: 'cust-1', email_address: 'verified@example.com' }] });
    await create(vault);
    const update = calls.find((call) => call.method === 'PUT' && call.url.endsWith('/v2/customers/cust-1'));
    expect(update?.body).toEqual({ reference_id: 'tenant-1' });
    expect(calls.some((call) => call.method === 'POST' && call.url.endsWith('/v2/customers'))).toBe(false);
  });

  it('fails closed for duplicate exact customer references', async () => {
    const { vault, calls } = vaultFor({ references: [
      { id: 'cust-1', reference_id: 'tenant-1' },
      { id: 'cust-2', reference_id: 'tenant-1' },
    ] });
    await expect(create(vault)).rejects.toMatchObject({ code: 'DUPLICATE_CUSTOMER_REFERENCE', status: 409 });
    expect(calls.some((call) => call.url.endsWith('/v2/cards'))).toBe(false);
  });

  it('fails closed when a CreateCard response mismatches', async () => {
    const { vault } = vaultFor({ references: [{ id: 'cust-1', reference_id: 'tenant-1' }], cardMismatch: true });
    await expect(create(vault)).rejects.toMatchObject({ code: 'SQUARE_CARD_RESPONSE_MISMATCH' });
  });

  it('fails closed when a CreateSubscription response mismatches', async () => {
    const { vault } = vaultFor({ references: [{ id: 'cust-1', reference_id: 'tenant-1' }], subscriptionMismatch: true });
    await expect(create(vault)).rejects.toMatchObject({ code: 'SQUARE_SUBSCRIPTION_RESPONSE_MISMATCH' });
  });

  it('uses the same deterministic idempotency keys on a retry', async () => {
    const { vault, calls } = vaultFor({ references: [{ id: 'cust-1', reference_id: 'tenant-1' }] });
    await create(vault);
    await create(vault);
    const cardKeys = calls.filter((call) => call.url.endsWith('/v2/cards')).map((call) => (call.body as any).idempotency_key);
    const subscriptionKeys = calls.filter((call) => call.url.endsWith('/v2/subscriptions')).map((call) => (call.body as any).idempotency_key);
    expect(new Set(cardKeys).size).toBe(1);
    expect(new Set(subscriptionKeys).size).toBe(1);
  });
});
