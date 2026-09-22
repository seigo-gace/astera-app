import { FunctionHttpError, type BillingServiceEnv } from '../part/billing-env.js';
import { handleStoragePaymentIfMatched } from './storage-square.js';
import { requireProjectionClient } from './astera-projection.js';
import { reconcilePaidPlanInvoice } from './square-plan-reconcile.js';
import type { SquareEnv } from './square.js';
import {
  SQUARE_SUPPORTED_EVENT_TYPES as SUPPORTED_EVENT_TYPES,
  extractSquareEventProjection as extractProjection,
} from './square-webhook-support.js';

export type SquareHandlerEnv = BillingServiceEnv & SquareEnv;

export type SquareEvent = {
  event_id?: string;
  type?: string;
  created_at?: string;
  data?: { type?: string; id?: string; object?: Record<string, unknown> };
};

export const SQUARE_SUPPORTED_EVENT_TYPES = SUPPORTED_EVENT_TYPES;
export type SquareSupportedEventType = (typeof SQUARE_SUPPORTED_EVENT_TYPES)[number];

export type SquareEventProjection = {
  provider_event_id: string;
  event_type: string;
  object_kind: string;
  object_id: string | null;
  status: string | null;
  amount: number | null;
  currency: string | null;
  square_created_at: string | null;
};

export const extractSquareEventProjection = extractProjection;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === 'string' ? value.trim() : '';
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

async function handlePaymentEvent(env: SquareHandlerEnv, event: SquareEvent): Promise<string> {
  const projection = requireProjectionClient(env);
  const eventId = event.event_id as string;
  const payment = asRecord(asRecord(event.data?.object).payment);
  const orderId = text(payment, 'order_id');
  const paymentId = text(payment, 'id');
  const status = text(payment, 'status').toUpperCase();
  const amountMoney = asRecord(payment.amount_money);
  const paidAmount = numberValue(amountMoney.amount);
  const paidCurrency = text(amountMoney, 'currency');

  const fingerprint = JSON.stringify({
    event_id: eventId,
    payment_id: paymentId,
    order_id: orderId,
    amount: paidAmount,
    currency: paidCurrency,
  });

  const applyResult = await projection.postIntentPaymentApply({
    provider_event_id: eventId,
    provider_order_id: orderId,
    provider_payment_id: paymentId,
    payment_status: status,
    paid_amount: paidAmount,
    paid_currency: paidCurrency,
    grant_idempotency_key: `square:${eventId}:grant`,
    grant_fingerprint: fingerprint,
  });

  if (applyResult.processing_status === 'unmatched_order') {
    const storageStatus = await handleStoragePaymentIfMatched(env, {
      eventId,
      orderId,
      paymentId,
      status,
      paidAmount,
      paidCurrency,
    });
    if (storageStatus) return storageStatus;
  }

  return applyResult.processing_status;
}

async function handleInvoicePaymentEvent(
  env: SquareHandlerEnv,
  event: SquareEvent,
  correlationId: string,
): Promise<string> {
  const projection = requireProjectionClient(env);
  const eventId = event.event_id as string;
  const invoice = asRecord(
    asRecord(event.data?.object).invoice,
  );
  const subscriptionId = text(
    invoice,
    'subscription_id',
  );

  if (!subscriptionId) {
    throw new FunctionHttpError(
      502,
      'SQUARE_INVOICE_REFERENCE_INCOMPLETE',
      'Square invoice reference is incomplete.',
    );
  }

  return reconcilePaidPlanInvoice(
    env,
    projection,
    {
      eventId,
      invoice,
      subscriptionId,
      correlationId,
    },
  );
}

async function handleSubscriptionEvent(env: SquareHandlerEnv, event: SquareEvent): Promise<string> {
  const projection = requireProjectionClient(env);
  const eventId = event.event_id as string;
  const subscription = asRecord(asRecord(event.data?.object).subscription);
  const result = await projection.postWebhookSubscription({
    provider_event_id: eventId,
    provider_subscription_id: text(subscription, 'id'),
    subscription_status: text(subscription, 'status'),
    start_date: text(subscription, 'start_date') || null,
    charged_through_date: text(subscription, 'charged_through_date') || null,
  });
  return result.processing_status;
}

async function handleRefundEvent(env: SquareHandlerEnv, event: SquareEvent): Promise<string> {
  const projection = requireProjectionClient(env);
  const eventId = event.event_id as string;
  const refund = asRecord(asRecord(event.data?.object).refund);
  const result = await projection.postWebhookIntentReconciliation({
    provider_event_id: eventId,
    provider_payment_id: text(refund, 'payment_id'),
    failure_code: 'SQUARE_REFUND_RECEIVED',
    event_processing_status: 'recorded',
  });
  return result.processing_status;
}

async function handleDisputeEvent(env: SquareHandlerEnv, event: SquareEvent): Promise<string> {
  const projection = requireProjectionClient(env);
  const eventId = event.event_id as string;
  const dispute = asRecord(asRecord(event.data?.object).dispute);
  const result = await projection.postWebhookIntentReconciliation({
    provider_event_id: eventId,
    provider_payment_id: text(dispute, 'payment_id'),
    failure_code: 'SQUARE_DISPUTE_RECEIVED',
    event_processing_status: 'recorded',
  });
  return result.processing_status;
}

async function handlePayoutEvent(env: SquareHandlerEnv, event: SquareEvent): Promise<string> {
  const projection = requireProjectionClient(env);
  const eventId = event.event_id as string;
  const result = await projection.postWebhookPayoutRecorded(eventId);
  return result.processing_status;
}

async function handleInvoiceProjectionEvent(env: SquareHandlerEnv, event: SquareEvent): Promise<string> {
  const projection = requireProjectionClient(env);
  const eventId = event.event_id as string;
  const invoice = asRecord(asRecord(event.data?.object).invoice);
  const result = await projection.postWebhookInvoiceProjection({
    provider_event_id: eventId,
    provider_order_id: text(invoice, 'order_id'),
    failure_code: 'INVOICE_SCHEDULED_CHARGE_FAILED',
  });
  return result.processing_status;
}

export async function processSquareWebhookEvent(
  env: SquareHandlerEnv,
  event: SquareEvent,
  correlationId: string = crypto.randomUUID(),
): Promise<{ processingStatus: string; duplicate: boolean }> {
  const projection = requireProjectionClient(env);
  const eventId = event.event_id?.trim();
  const eventType = event.type?.trim();
  if (!eventId || !eventType) {
    throw new FunctionHttpError(400, 'SQUARE_WEBHOOK_EVENT_INVALID', 'Square Event IDまたはTypeがありません。');
  }
  if (!SQUARE_SUPPORTED_EVENT_TYPES.includes(eventType as SquareSupportedEventType)) {
    const ignored = { processingStatus: 'ignored_event_type', duplicate: false };
    const projectionPayload = extractSquareEventProjection(event);
    await projection.postEventMeta(eventId).catch(() => ({ billing_intent_id: null, processing_status: 'ignored_event_type' }));
    await projection.postBillingEvent({
      provider_event_id: eventId,
      event_type: eventType,
      processing_status: 'ignored_event_type',
      billing_intent_id: null,
      projection: projectionPayload,
      idempotency_key: eventId,
      correlation_id: correlationId,
      tenant_id: null,
      user_id: null,
    }).catch(() => undefined);
    return ignored;
  }

  const existing = await projection.getEvent(eventId);
  if (existing?.processing_status && existing.processing_status !== 'processing') {
    return { processingStatus: existing.processing_status, duplicate: true };
  }

  const claim = await projection.postEventStartProcessing({
    provider_event_id: eventId,
    event_type: eventType,
    received_at: new Date().toISOString(),
  });
  if (claim.duplicate && claim.processing_status !== 'processing') {
    return { processingStatus: claim.processing_status, duplicate: true };
  }

  let processingStatus: string;
  if (eventType === 'payment.created' || eventType === 'payment.updated') {
    processingStatus = await handlePaymentEvent(env, event);
  } else if (eventType === 'invoice.payment_made') {
    processingStatus = await handleInvoicePaymentEvent(
      env,
      event,
      correlationId,
    );
  } else if (eventType === 'subscription.created' || eventType === 'subscription.updated') {
    processingStatus = await handleSubscriptionEvent(env, event);
  } else if (eventType === 'refund.created' || eventType === 'refund.updated') {
    processingStatus = await handleRefundEvent(env, event);
  } else if (eventType === 'dispute.created' || eventType === 'dispute.state.updated') {
    processingStatus = await handleDisputeEvent(env, event);
  } else if (eventType.startsWith('payout.')) {
    processingStatus = await handlePayoutEvent(env, event);
  } else if (eventType.startsWith('invoice.')) {
    processingStatus = await handleInvoiceProjectionEvent(env, event);
  } else {
    processingStatus = 'ignored_event_type';
  }

  const projectionPayload = extractSquareEventProjection(event);
  const intentMeta = await projection.postEventMeta(eventId).catch(() => ({ billing_intent_id: null, processing_status: processingStatus }));

  let tenantId: string | null = null;
  let userId: string | null = null;
  if (intentMeta.billing_intent_id) {
    const intent = await projection.getBillingIntentLookup({ intent_id: intentMeta.billing_intent_id });
    tenantId = typeof intent?.tenant_id === 'string' ? intent.tenant_id : null;
    userId = typeof intent?.user_id === 'string' ? intent.user_id : null;
  }

  const remote = await projection.postBillingEvent({
    provider_event_id: eventId,
    event_type: eventType,
    processing_status: processingStatus,
    billing_intent_id: intentMeta.billing_intent_id ?? null,
    projection: projectionPayload,
    idempotency_key: eventId,
    correlation_id: correlationId,
    tenant_id: tenantId,
    user_id: userId,
  });
  if (remote.duplicate) {
    return { processingStatus: remote.processing_status, duplicate: true };
  }

  return { processingStatus, duplicate: false };
}
