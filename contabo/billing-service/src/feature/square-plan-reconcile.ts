import { FunctionHttpError, type BillingServiceEnv } from '../part/billing-env.js';
import type { AsteraProjectionClient, BillingIntentRecord } from './astera-projection.js';
import { ensureMonthlyIncludedGrantForTenant } from './credit-grants-projection.js';
import { createLibralVaultClientFromEnv } from './libral-vault.js';
import { getSquareSubscriptionSnapshot } from './square-order-reference.js';
import { getSquareCustomerReference } from './square-plan-direct.js';

type InvoiceMoney = { amount: number; currency: string };
const ALLOWED_INTENT_STATUSES = new Set(['creating_checkout', 'checkout_created', 'payment_pending']);
const ALLOWED_SUBSCRIPTION_STATUSES = new Set(['active', 'pending']);

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function required(value: unknown, code: string): string {
  const normalized = text(value);
  if (!normalized) throw new FunctionHttpError(502, code, 'Required billing value is missing.');
  return normalized;
}

function invoicePaidMoney(invoice: Record<string, unknown>): InvoiceMoney {
  const requests = Array.isArray(invoice.payment_requests) ? invoice.payment_requests : [];
  const completed = requests.map((entry) => {
    const request = entry && typeof entry === 'object' && !Array.isArray(entry) ? entry as Record<string, unknown> : {};
    const money = request.total_completed_amount_money;
    return money && typeof money === 'object' && !Array.isArray(money) ? money as Record<string, unknown> : null;
  }).filter((money): money is Record<string, unknown> => money !== null);
  if (completed.length !== 1) throw new FunctionHttpError(502, 'SQUARE_INVOICE_AMOUNT_MISSING', 'Invoice paid amount is not exact.');
  const amount = Number(completed[0].amount);
  const currency = text(completed[0].currency);
  if (!Number.isSafeInteger(amount) || amount <= 0 || !currency) {
    throw new FunctionHttpError(502, 'SQUARE_INVOICE_AMOUNT_INVALID', 'Invoice paid amount is invalid.');
  }
  return { amount, currency };
}

function exactCandidate(intents: BillingIntentRecord[]): BillingIntentRecord {
  const candidates = intents.filter((intent) => text(intent.product_kind) === 'plan' && ALLOWED_INTENT_STATUSES.has(text(intent.status)));
  if (candidates.length !== 1) {
    throw new FunctionHttpError(502, candidates.length === 0 ? 'PENDING_PLAN_INTENT_NOT_FOUND' : 'PENDING_PLAN_INTENT_AMBIGUOUS', 'Pending Plan Intent was not exact.');
  }
  return candidates[0]!;
}

export async function reconcilePaidPlanInvoice(
  env: BillingServiceEnv,
  projection: AsteraProjectionClient,
  input: {
    eventId: string;
    invoice: Record<string, unknown>;
    subscriptionId: string;
    correlationId: string;
  },
): Promise<string> {
  const vault = env.vault ?? createLibralVaultClientFromEnv(env);
  if (!vault) throw new FunctionHttpError(503, 'VAULT_NOT_CONFIGURED', 'Vault internal client is not configured.');
  const invoiceMoney = invoicePaidMoney(input.invoice);
  const subscription = await getSquareSubscriptionSnapshot(env, vault, input.subscriptionId);
  if (subscription.id !== input.subscriptionId || !subscription.customerId) {
    throw new FunctionHttpError(502, 'SQUARE_SUBSCRIPTION_REFERENCE_INCOMPLETE', 'Square subscription reference is incomplete.');
  }
  if (!ALLOWED_SUBSCRIPTION_STATUSES.has(subscription.status)) {
    throw new FunctionHttpError(502, 'SQUARE_SUBSCRIPTION_STATUS_INVALID', 'Square subscription status is not allowed.');
  }

  const tenantId = await getSquareCustomerReference(env, subscription.customerId);
  if (!tenantId) throw new FunctionHttpError(502, 'SQUARE_CUSTOMER_REFERENCE_MISSING', 'Square customer reference_id is missing.');
  const mapped = await projection.getSubscription(tenantId);
  if (!mapped || text(mapped.provider_subscription_id) !== input.subscriptionId) {
    throw new FunctionHttpError(502, 'PROJECTION_SUBSCRIPTION_MISMATCH', 'Projection subscription mapping did not match.');
  }
  const intent = exactCandidate(await projection.listPendingPlanIntents(tenantId, new Date().toISOString()));
  const intentId = required(intent.id, 'BILLING_INTENT_ID_MISSING');
  const userId = required(intent.user_id, 'BILLING_USER_MISSING');
  if (text(intent.tenant_id) !== tenantId) throw new FunctionHttpError(502, 'BILLING_TENANT_MISMATCH', 'Billing tenant did not match.');

  const catalog = await projection.getCatalog();
  const catalogVersion = required(intent.catalog_version, 'BILLING_CATALOG_MISSING');
  const planId = required(intent.product_id, 'BILLING_PLAN_MISSING');
  const billingCycle = required(intent.billing_cycle, 'BILLING_CYCLE_MISSING');
  const amount = Number(intent.amount);
  const currency = required(intent.currency, 'BILLING_CURRENCY_MISSING');
  if (catalog.catalog_version !== catalogVersion) throw new FunctionHttpError(502, 'BILLING_CATALOG_VERSION_MISMATCH', 'Billing catalog version mismatch.');
  const plan = catalog.plans.find((entry) => entry.active && entry.plan_id === planId);
  const variant = plan?.billing_variants.find((entry) => entry.active && entry.billing_cycle === billingCycle);
  if (!plan || !variant) throw new FunctionHttpError(502, 'PLAN_CATALOG_MISMATCH', 'Plan catalog did not match.');
  if (variant.recurring_amount !== amount || invoiceMoney.amount !== amount) {
    throw new FunctionHttpError(502, 'PLAN_AMOUNT_MISMATCH', 'Plan amount did not match.');
  }
  if (plan.currency !== currency || invoiceMoney.currency !== currency) {
    throw new FunctionHttpError(502, 'PLAN_CURRENCY_MISMATCH', 'Plan currency did not match.');
  }
  if (!variant.square_plan_variation_id || subscription.planVariationId !== variant.square_plan_variation_id) {
    throw new FunctionHttpError(502, 'SQUARE_PLAN_VARIATION_MISMATCH', 'Square plan variation did not match.');
  }
  if (text(mapped.plan_id) !== planId || (text(mapped.billing_cycle) || 'monthly') !== billingCycle || text(mapped.catalog_version) !== catalogVersion) {
    throw new FunctionHttpError(502, 'PROJECTION_SUBSCRIPTION_CATALOG_MISMATCH', 'Projection subscription catalog did not match.');
  }

  await projection.postSubscription({
    tenant_id: tenantId,
    user_id: userId,
    catalog_version: catalogVersion,
    plan_id: planId,
    billing_cycle: billingCycle,
    provider_subscription_id: input.subscriptionId,
    status: subscription.status,
    current_period_start: subscription.startDate,
    current_period_end: subscription.chargedThroughDate,
    cancel_at_period_end: false,
    idempotency_key: `square:${input.eventId}:subscription`,
    correlation_id: input.correlationId,
  });
  await projection.postIntentStatus({
    intent_id: intentId,
    billing_intent_id: intentId,
    tenant_id: tenantId,
    user_id: userId,
    status: 'completed',
    failure_code: null,
    idempotency_key: `square:${input.eventId}:intent-completed`,
    correlation_id: input.correlationId,
  });
  const actor = await projection.getActor(tenantId, userId);
  await ensureMonthlyIncludedGrantForTenant(projection, tenantId, userId, actor.credit.id, {
    eventId: input.eventId,
    correlationId: input.correlationId,
  });
  const webhook = await projection.postWebhookInvoicePayment({
    provider_event_id: input.eventId,
    provider_order_id: '',
    provider_subscription_id: input.subscriptionId,
  }) as { processing_status?: string };
  return text(webhook.processing_status) || 'processed';
}
