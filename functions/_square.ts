import { FunctionHttpError } from './_account-projection';

export type SquareEnv = {
  SQUARE_ACCESS_TOKEN?: string;
  SQUARE_LOCATION_ID?: string;
  SQUARE_ENVIRONMENT?: string;
  SQUARE_VERSION?: string;
  SQUARE_WEBHOOK_SIGNATURE_KEY?: string;
  SQUARE_WEBHOOK_URL?: string;
  APP_PUBLIC_ORIGIN?: string;
};

type SquareError = { code?: string; category?: string; detail?: string };

type SquarePaymentLinkResponse = {
  errors?: SquareError[];
  payment_link?: {
    id?: string;
    order_id?: string;
    url?: string;
    long_url?: string;
    created_at?: string;
  };
};

function required(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new FunctionHttpError(503, `${name}_NOT_CONFIGURED`, `${name}が設定されていません。`);
  return normalized;
}

function squareOrigin(environment: string | undefined): string {
  return environment?.trim().toLowerCase() === 'sandbox'
    ? 'https://connect.squareupsandbox.com'
    : 'https://connect.squareup.com';
}

function safePublicOrigin(value: string | undefined): string {
  const raw = required(value, 'APP_PUBLIC_ORIGIN');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new FunctionHttpError(503, 'APP_PUBLIC_ORIGIN_INVALID', 'APP_PUBLIC_ORIGINが有効なURLではありません。');
  }
  if (url.protocol !== 'https:' && url.hostname !== 'localhost') {
    throw new FunctionHttpError(503, 'APP_PUBLIC_ORIGIN_HTTPS_REQUIRED', 'APP_PUBLIC_ORIGINはHTTPSである必要があります。');
  }
  return url.origin;
}

function squareErrorMessage(errors: SquareError[] | undefined): string {
  if (!errors?.length) return 'Square API Requestに失敗しました。';
  return errors.map((error) => [error.code, error.detail].filter(Boolean).join(': ')).join(' / ');
}

export type CreateCheckoutInput = {
  idempotencyKey: string;
  intentId: string;
  displayName: string;
  amount: number;
  currency: 'JPY';
  subscriptionPlanVariationId?: string | null;
};

export async function createSquareCheckout(env: SquareEnv, input: CreateCheckoutInput): Promise<{
  checkoutId: string;
  orderId: string;
  checkoutUrl: string;
  createdAt: string | null;
}> {
  const accessToken = required(env.SQUARE_ACCESS_TOKEN, 'SQUARE_ACCESS_TOKEN');
  const locationId = required(env.SQUARE_LOCATION_ID, 'SQUARE_LOCATION_ID');
  const publicOrigin = safePublicOrigin(env.APP_PUBLIC_ORIGIN);
  const redirect = new URL('/account/billing/status', publicOrigin);
  redirect.searchParams.set('intent', input.intentId);
  const checkoutOptions: Record<string, unknown> = {
    redirect_url: redirect.toString(),
    allow_tipping: false,
    ask_for_shipping_address: false,
  };
  if (input.subscriptionPlanVariationId) {
    checkoutOptions.subscription_plan_id = input.subscriptionPlanVariationId;
  }

  const response = await fetch(`${squareOrigin(env.SQUARE_ENVIRONMENT)}/v2/online-checkout/payment-links`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Square-Version': env.SQUARE_VERSION?.trim() || '2026-07-15',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      idempotency_key: input.idempotencyKey,
      quick_pay: {
        name: input.displayName,
        price_money: { amount: Math.trunc(input.amount), currency: input.currency },
        location_id: locationId,
      },
      checkout_options: checkoutOptions,
      description: `Astera ${input.displayName}`,
      payment_note: `astera_billing_intent:${input.intentId}`,
    }),
  });
  const payload = await response.json().catch(() => null) as SquarePaymentLinkResponse | null;
  if (!response.ok || !payload?.payment_link) {
    throw new FunctionHttpError(response.status >= 500 ? 502 : 422, 'SQUARE_CHECKOUT_CREATE_FAILED', squareErrorMessage(payload?.errors), payload);
  }
  const checkoutId = payload.payment_link.id?.trim();
  const orderId = payload.payment_link.order_id?.trim();
  const checkoutUrl = payload.payment_link.url?.trim() || payload.payment_link.long_url?.trim();
  if (!checkoutId || !orderId || !checkoutUrl) {
    throw new FunctionHttpError(502, 'SQUARE_CHECKOUT_RESPONSE_INCOMPLETE', 'Square Checkout Responseに必須項目がありません。', payload);
  }
  const destination = new URL(checkoutUrl);
  if (destination.protocol !== 'https:' || !(destination.hostname === 'square.link' || destination.hostname.endsWith('.square.site') || destination.hostname.endsWith('.squareup.com'))) {
    throw new FunctionHttpError(502, 'SQUARE_CHECKOUT_URL_REJECTED', 'Squareの許可Host以外のCheckout URLを拒否しました。');
  }
  return {
    checkoutId,
    orderId,
    checkoutUrl: destination.toString(),
    createdAt: payload.payment_link.created_at?.trim() || null,
  };
}

function bytesToBase64(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let binary = '';
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function constantTimeEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  let diff = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    diff |= (a[index % a.length] ?? 0) ^ (b[index % b.length] ?? 0);
  }
  return diff === 0;
}

export async function verifySquareWebhook(env: SquareEnv, signature: string | null, rawBody: string): Promise<boolean> {
  if (!signature?.trim()) return false;
  const signatureKey = required(env.SQUARE_WEBHOOK_SIGNATURE_KEY, 'SQUARE_WEBHOOK_SIGNATURE_KEY');
  const notificationUrl = required(env.SQUARE_WEBHOOK_URL, 'SQUARE_WEBHOOK_URL');
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(signatureKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${notificationUrl}${rawBody}`));
  return constantTimeEqual(bytesToBase64(digest), signature.trim());
}
