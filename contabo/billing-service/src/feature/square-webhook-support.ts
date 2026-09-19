export const SQUARE_SUPPORTED_EVENT_TYPES = [
  'payment.created',
  'payment.updated',
  'invoice.canceled',
  'invoice.created',
  'invoice.deleted',
  'invoice.payment_made',
  'invoice.published',
  'invoice.refunded',
  'invoice.scheduled_charge_failed',
  'invoice.updated',
  'refund.created',
  'refund.updated',
  'subscription.created',
  'subscription.updated',
  'dispute.created',
  'dispute.state.updated',
  'payout.failed',
  'payout.paid',
  'payout.sent',
] as const;

export type SquareSupportedEventType = (typeof SQUARE_SUPPORTED_EVENT_TYPES)[number];

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

function moneyFrom(record: Record<string, unknown>) {
  const amountMoney = asRecord(record.amount_money ?? record.total_completed_amount_money);
  return {
    amount: numberValue(amountMoney.amount),
    currency: text(amountMoney, 'currency') || null,
  };
}

export function extractSquareEventProjection(event: {
  event_id?: string;
  type?: string;
  created_at?: string;
  data?: { type?: string; id?: string; object?: Record<string, unknown> };
}) {
  const eventType = event.type?.trim() ?? '';
  const root = asRecord(event.data?.object);
  let domain: Record<string, unknown> = {};
  let objectKind = 'unknown';
  if (eventType.startsWith('payment.')) {
    domain = asRecord(root.payment);
    objectKind = 'payment';
  } else if (eventType.startsWith('invoice.')) {
    domain = asRecord(root.invoice);
    objectKind = 'invoice';
  } else if (eventType.startsWith('subscription.')) {
    domain = asRecord(root.subscription);
    objectKind = 'subscription';
  } else if (eventType.startsWith('refund.')) {
    domain = asRecord(root.refund);
    objectKind = 'refund';
  } else if (eventType.startsWith('dispute.')) {
    domain = asRecord(root.dispute);
    objectKind = 'dispute';
  } else if (eventType.startsWith('payout.')) {
    domain = asRecord(root.payout);
    objectKind = 'payout';
  }
  const money = moneyFrom(domain);
  return {
    provider_event_id: event.event_id?.trim() ?? '',
    event_type: eventType,
    object_kind: objectKind,
    object_id: text(domain, 'id') || text(asRecord(event.data), 'id') || null,
    status: text(domain, 'status') || null,
    amount: money.amount,
    currency: money.currency,
    square_created_at: event.created_at?.trim() || null,
  };
}
