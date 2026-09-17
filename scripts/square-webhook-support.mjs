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
];

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function text(record, key) {
  const value = record[key];
  return typeof value === 'string' ? value.trim() : '';
}

function numberValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function moneyFrom(record) {
  const amountMoney = asRecord(record.amount_money ?? record.total_completed_amount_money);
  return {
    amount: numberValue(amountMoney.amount),
    currency: text(amountMoney, 'currency') || null,
  };
}

export function extractSquareEventProjection(event) {
  const eventType = event.type?.trim() ?? '';
  const root = asRecord(event.data?.object);
  let domain = {};
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

export function parseStandardSignatures(header) {
  return header
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => (part.startsWith('v1,') ? part.slice(3) : part));
}

export async function verifyGatewayStandardWebhook(request, rawBody, secret, toleranceSeconds = 300) {
  const configured = secret?.trim();
  if (!configured) return false;
  const id = request.headers.get('webhook-id')?.trim();
  const timestamp = request.headers.get('webhook-timestamp')?.trim();
  const signatureHeader = request.headers.get('webhook-signature')?.trim();
  if (!id || !timestamp || !signatureHeader) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > toleranceSeconds) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(configured),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signedContent = `${id}.${timestamp}.${rawBody}`;
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedContent));
  const expected = new Uint8Array(digest);
  const candidates = parseStandardSignatures(signatureHeader);
  return candidates.some((candidate) => {
    try {
      const binary = atob(candidate);
      const received = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) received[index] = binary.charCodeAt(index);
      let diff = received.length ^ expected.length;
      const length = Math.max(received.length, expected.length);
      for (let index = 0; index < length; index += 1) {
        diff |= (received[index % received.length] ?? 0) ^ (expected[index % expected.length] ?? 0);
      }
      return diff === 0;
    } catch {
      return false;
    }
  });
}
