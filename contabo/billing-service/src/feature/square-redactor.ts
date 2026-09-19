const REDACTED = '[REDACTED]';

const SQUARE_PII_KEY = /^(card_details|card|billing_address|shipping_address|address|buyer_email_address|email_address|phone_number|given_name|family_name|nickname|company_name|cardholder_name|postal_code|locality|administrative_district_level_1|administrative_district_level_2|country|cvv|pan|bin|exp_month|exp_year|fingerprint|last_4|card_brand|card_type|recipient_name|note)$/i;

const SQUARE_PII_KEY_FRAGMENT = /(card|address|phone|email|postal|locality|administrative|country|cardholder|fingerprint|cvv|pan|bin)/i;

function shouldRedactKey(key: string): boolean {
  if (SQUARE_PII_KEY.test(key)) return true;
  if (key.toLowerCase().endsWith('_email')) return true;
  if (key.toLowerCase().includes('email') && key.toLowerCase() !== 'merchant_id') return true;
  return SQUARE_PII_KEY_FRAGMENT.test(key) && !['amount_money', 'order_id', 'payment_id', 'subscription_id'].includes(key.toLowerCase());
}

export function redactSquareWebhookPayload<T>(value: T): T {
  return redactValue(value) as T;
}

function redactValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) return REDACTED;
    return value;
  }
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => redactValue(item));
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] = shouldRedactKey(key) ? REDACTED : redactValue(item);
  }
  return out;
}
