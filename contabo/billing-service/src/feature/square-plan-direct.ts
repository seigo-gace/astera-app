import { createHash } from 'node:crypto';
import { FunctionHttpError, type BillingServiceEnv } from '../part/billing-env.js';
import { createLibralVaultClientFromEnv, squareSandboxOriginOnly, type LibralVaultClient } from './libral-vault.js';

type SquareError = { code?: string; detail?: string };
type SquareCustomer = { id?: string; reference_id?: string; email_address?: string };
type SquareCard = { id?: string; customer_id?: string; reference_id?: string; enabled?: boolean };
type SquareCardsPage = { cards?: SquareCard[]; cursor?: string };
type SquareSubscription = {
  id?: string;
  customer_id?: string;
  card_id?: string;
  plan_variation_id?: string;
  status?: string;
  start_date?: string;
  charged_through_date?: string;
};
type SquareSubscriptionSearch = { subscriptions?: SquareSubscription[]; cursor?: string };

const TERMINAL_SQUARE_SUBSCRIPTION_STATUSES = new Set(['CANCELED', 'COMPLETED']);

function required(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new FunctionHttpError(503, `${name}_NOT_CONFIGURED`, `${name} is not configured.`);
  return normalized;
}

function errorMessage(errors: SquareError[] | undefined): string {
  return errors?.map((error) => [error.code, error.detail].filter(Boolean).join(': ')).join(' / ')
    || 'Square API request failed.';
}

function stableIdempotencyKey(intentId: string, operation: 'customer' | 'subscription'): string {
  const compact = intentId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 32);
  const prefix = operation === 'customer' ? 'cust' : 'sub';
  const key = `ast-${prefix}-${compact}`;
  if (!compact || key.length > 45) throw new FunctionHttpError(500, 'SQUARE_IDEMPOTENCY_KEY_INVALID', 'Square idempotency key is invalid.');
  return key;
}

function cardIdempotencyKey(intentId: string, sourceId: string): string {
  const compact = intentId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 16);
  const digest = createHash('sha256').update(sourceId, 'utf8').digest('hex').slice(0, 16);
  const key = `ast-card-${compact}-${digest}`;
  if (!compact || !sourceId || key.length > 45) throw new FunctionHttpError(500, 'SQUARE_IDEMPOTENCY_KEY_INVALID', 'Square idempotency key is invalid.');
  return key;
}

async function squareJson<T>(
  env: BillingServiceEnv,
  vault: LibralVaultClient,
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const provider = await vault.actionsHttp({
    secretId: required(env.VAULT_SQUARE_ACCESS_SECRET_ID, 'VAULT_SQUARE_ACCESS_SECRET_ID'),
    url: `${squareSandboxOriginOnly(env.SQUARE_ENVIRONMENT)}${path}`,
    method,
    secretHeader: 'Authorization',
    secretPrefix: 'Bearer ',
    headers: {
      'Square-Version': env.SQUARE_VERSION?.trim() || '2026-07-15',
      'Content-Type': 'application/json',
    },
    ...(body === undefined ? {} : { body }),
  });
  const payload = JSON.parse(provider.body || '{}') as T & { errors?: SquareError[] };
  if (!provider.ok) {
    const endpoint = path.split('?')[0] || path;
    const errors = Array.isArray(payload.errors)
      ? payload.errors.map((error) => ({ code: error.code, detail: error.detail }))
      : [];
    console.error(JSON.stringify({ event: 'square_api_request_failed', method, endpoint, status: provider.status, errors }));
    throw new FunctionHttpError(
      provider.status >= 500 ? 502 : 422,
      'SQUARE_API_REQUEST_FAILED',
      errorMessage(payload.errors),
      { provider: 'square', method, endpoint, status: provider.status, errors },
    );
  }
  return payload;
}

async function searchCustomers(
  env: BillingServiceEnv,
  vault: LibralVaultClient,
  filter: { reference_id?: { exact: string }; email_address?: { exact: string } },
): Promise<SquareCustomer[]> {
  const payload = await squareJson<{ customers?: SquareCustomer[] }>(env, vault, 'POST', '/v2/customers/search', {
    query: { filter },
    limit: 100,
  });
  return Array.isArray(payload.customers) ? payload.customers : [];
}

function exactCustomers(customers: SquareCustomer[], field: 'reference_id' | 'email_address', value: string): SquareCustomer[] {
  return customers.filter((customer) => String(customer[field] ?? '').trim() === value);
}

async function resolveCustomer(
  env: BillingServiceEnv,
  vault: LibralVaultClient,
  input: { tenantId: string; email: string; intentId: string },
): Promise<string> {
  const byReference = exactCustomers(
    await searchCustomers(env, vault, { reference_id: { exact: input.tenantId } }),
    'reference_id',
    input.tenantId,
  );
  if (byReference.length > 1) throw new FunctionHttpError(409, 'DUPLICATE_CUSTOMER_REFERENCE', 'Square customer reference_id is duplicated.');
  if (byReference.length === 1) {
    const customerId = String(byReference[0]?.id ?? '').trim();
    if (!customerId) throw new FunctionHttpError(502, 'SQUARE_CUSTOMER_ID_MISSING', 'Square customer ID is missing.');
    return customerId;
  }

  const byEmail = exactCustomers(
    await searchCustomers(env, vault, { email_address: { exact: input.email } }),
    'email_address',
    input.email,
  );
  if (byEmail.length > 1) throw new FunctionHttpError(409, 'DUPLICATE_CUSTOMER_EMAIL', 'Square customer email is duplicated.');
  if (byEmail.length === 1) {
    const customer = byEmail[0]!;
    const customerId = String(customer.id ?? '').trim();
    const referenceId = String(customer.reference_id ?? '').trim();
    if (!customerId) throw new FunctionHttpError(502, 'SQUARE_CUSTOMER_ID_MISSING', 'Square customer ID is missing.');
    if (referenceId && referenceId !== input.tenantId) {
      throw new FunctionHttpError(409, 'SQUARE_CUSTOMER_REFERENCE_CONFLICT', 'Square customer belongs to another tenant reference.');
    }
    if (!referenceId) {
      const updated = await squareJson<{ customer?: SquareCustomer }>(env, vault, 'PUT', `/v2/customers/${encodeURIComponent(customerId)}`, {
        reference_id: input.tenantId,
      });
      if (updated.customer?.id !== customerId || updated.customer?.reference_id !== input.tenantId) {
        throw new FunctionHttpError(502, 'SQUARE_CUSTOMER_REFERENCE_UPDATE_MISMATCH', 'Square customer reference update did not match.');
      }
    }
    return customerId;
  }

  const created = await squareJson<{ customer?: SquareCustomer }>(env, vault, 'POST', '/v2/customers', {
    idempotency_key: stableIdempotencyKey(input.intentId, 'customer'),
    reference_id: input.tenantId,
    email_address: input.email,
  });
  const customerId = String(created.customer?.id ?? '').trim();
  if (!customerId || created.customer?.reference_id !== input.tenantId || created.customer?.email_address !== input.email) {
    throw new FunctionHttpError(502, 'SQUARE_CUSTOMER_CREATE_MISMATCH', 'Square customer response did not match the request.');
  }
  return customerId;
}

async function assertNoExistingSquareSubscription(
  env: BillingServiceEnv,
  vault: LibralVaultClient,
  customerId: string,
): Promise<void> {
  let cursor = '';
  const seenCursors = new Set<string>();
  do {
    if (cursor) {
      if (seenCursors.has(cursor)) {
        throw new FunctionHttpError(502, 'SQUARE_SUBSCRIPTION_SEARCH_CURSOR_LOOP', 'Square subscription search cursor repeated.');
      }
      seenCursors.add(cursor);
    }
    const payload = await squareJson<SquareSubscriptionSearch>(env, vault, 'POST', '/v2/subscriptions/search', {
      query: { filter: { customer_ids: [customerId] } },
      limit: 100,
      ...(cursor ? { cursor } : {}),
    });
    for (const subscription of Array.isArray(payload.subscriptions) ? payload.subscriptions : []) {
      const subscriptionId = String(subscription.id ?? '').trim();
      const returnedCustomerId = String(subscription.customer_id ?? '').trim();
      const status = String(subscription.status ?? '').trim().toUpperCase();
      if (!subscriptionId || returnedCustomerId !== customerId || !status) {
        throw new FunctionHttpError(502, 'SQUARE_SUBSCRIPTION_SEARCH_MISMATCH', 'Square subscription search response did not match the customer.');
      }
      if (!TERMINAL_SQUARE_SUBSCRIPTION_STATUSES.has(status)) {
        throw new FunctionHttpError(409, 'SQUARE_SUBSCRIPTION_ALREADY_EXISTS', 'A live Square subscription already exists for this customer.');
      }
    }
    cursor = String(payload.cursor ?? '').trim();
  } while (cursor);
}

async function findExistingIntentCard(
  env: BillingServiceEnv,
  vault: LibralVaultClient,
  customerId: string,
  intentId: string,
): Promise<string | null> {
  let cursor = '';
  const seenCursors = new Set<string>();
  const matches: SquareCard[] = [];
  do {
    if (cursor) {
      if (seenCursors.has(cursor)) {
        throw new FunctionHttpError(502, 'SQUARE_CARD_SEARCH_CURSOR_LOOP', 'Square card search cursor repeated.');
      }
      seenCursors.add(cursor);
    }
    const params = new URLSearchParams({
      customer_id: customerId,
      reference_id: intentId,
      include_disabled: 'true',
      sort_order: 'DESC',
    });
    if (cursor) params.set('cursor', cursor);
    const payload = await squareJson<SquareCardsPage>(env, vault, 'GET', `/v2/cards?${params.toString()}`);
    for (const card of Array.isArray(payload.cards) ? payload.cards : []) {
      const cardId = String(card.id ?? '').trim();
      const returnedCustomerId = String(card.customer_id ?? '').trim();
      const referenceId = String(card.reference_id ?? '').trim();
      if (!cardId || returnedCustomerId !== customerId || referenceId !== intentId) {
        throw new FunctionHttpError(502, 'SQUARE_CARD_SEARCH_MISMATCH', 'Square card search response did not match the intent.');
      }
      matches.push(card);
    }
    cursor = String(payload.cursor ?? '').trim();
  } while (cursor);

  if (matches.length > 1) {
    throw new FunctionHttpError(409, 'DUPLICATE_SQUARE_INTENT_CARD', 'Multiple Square cards exist for the same Billing Intent.');
  }
  if (matches.length === 0) return null;
  if (matches[0]?.enabled !== true) {
    throw new FunctionHttpError(409, 'SQUARE_INTENT_CARD_DISABLED', 'The Square card for this Billing Intent is disabled.');
  }
  return String(matches[0]?.id ?? '').trim();
}

export type DirectSubscriptionResult = {
  customerId: string;
  cardId: string;
  subscriptionId: string;
  status: string;
  startDate: string | null;
  chargedThroughDate: string | null;
};

export async function createDirectPlanSubscription(
  env: BillingServiceEnv,
  input: { intentId: string; tenantId: string; verifiedEmail: string; sourceId: string; planVariationId: string },
): Promise<DirectSubscriptionResult> {
  const vault = env.vault ?? createLibralVaultClientFromEnv(env);
  if (!vault) throw new FunctionHttpError(503, 'VAULT_NOT_CONFIGURED', 'Vault internal client is not configured.');
  const customerId = await resolveCustomer(env, vault, {
    tenantId: input.tenantId,
    email: input.verifiedEmail,
    intentId: input.intentId,
  });
  await assertNoExistingSquareSubscription(env, vault, customerId);

  let cardId = await findExistingIntentCard(env, vault, customerId, input.intentId);
  if (!cardId) {
    const cardPayload = await squareJson<{ card?: SquareCard }>(env, vault, 'POST', '/v2/cards', {
      idempotency_key: cardIdempotencyKey(input.intentId, input.sourceId),
      source_id: input.sourceId,
      card: {
        customer_id: customerId,
        reference_id: input.intentId,
        ...(env.SQUARE_ENVIRONMENT?.trim().toLowerCase() === 'sandbox'
          ? { billing_address: { postal_code: '94103' } }
          : {}),
      },
    });
    cardId = String(cardPayload.card?.id ?? '').trim();
    if (!cardId || cardPayload.card?.customer_id !== customerId || cardPayload.card?.reference_id !== input.intentId) {
      throw new FunctionHttpError(502, 'SQUARE_CARD_RESPONSE_MISMATCH', 'Square card response did not match the request.');
    }
  }

  const locationId = required(env.SQUARE_LOCATION_ID, 'SQUARE_LOCATION_ID');
  const subscriptionPayload = await squareJson<{ subscription?: SquareSubscription }>(env, vault, 'POST', '/v2/subscriptions', {
    idempotency_key: stableIdempotencyKey(input.intentId, 'subscription'),
    location_id: locationId,
    plan_variation_id: input.planVariationId,
    customer_id: customerId,
    card_id: cardId,
  });
  const subscription = subscriptionPayload.subscription;
  const subscriptionId = String(subscription?.id ?? '').trim();
  const status = String(subscription?.status ?? '').trim().toUpperCase();
  if (
    !subscriptionId
    || subscription?.customer_id !== customerId
    || subscription?.card_id !== cardId
    || subscription?.plan_variation_id !== input.planVariationId
    || !['PENDING', 'ACTIVE'].includes(status)
  ) {
    throw new FunctionHttpError(502, 'SQUARE_SUBSCRIPTION_RESPONSE_MISMATCH', 'Square subscription response did not match the request.');
  }
  return {
    customerId,
    cardId,
    subscriptionId,
    status: status.toLowerCase(),
    startDate: subscription?.start_date?.trim() || null,
    chargedThroughDate: subscription?.charged_through_date?.trim() || null,
  };
}

export async function getSquareCustomerReference(
  env: BillingServiceEnv,
  customerId: string,
): Promise<string> {
  const vault = env.vault ?? createLibralVaultClientFromEnv(env);
  if (!vault) throw new FunctionHttpError(503, 'VAULT_NOT_CONFIGURED', 'Vault internal client is not configured.');
  const payload = await squareJson<{ customer?: SquareCustomer }>(env, vault, 'GET', `/v2/customers/${encodeURIComponent(customerId)}`);
  if (payload.customer?.id !== customerId) throw new FunctionHttpError(502, 'SQUARE_CUSTOMER_RESPONSE_MISMATCH', 'Square customer response did not match.');
  return String(payload.customer.reference_id ?? '').trim();
}
