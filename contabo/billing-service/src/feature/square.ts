import { FunctionHttpError } from '../part/billing-env.js';
import { squareSandboxOriginOnly, type LibralVaultClient } from './libral-vault.js';

export type SquareEnv = {
  SQUARE_LOCATION_ID?: string;
  SQUARE_ENVIRONMENT?: string;
  SQUARE_VERSION?: string;
  VAULT_SQUARE_ACCESS_SECRET_ID?: string;
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

export type SquareCheckoutDeps = {
  env: SquareEnv;
  vault: LibralVaultClient;
};

export async function createSquareCheckout(deps: SquareCheckoutDeps, input: CreateCheckoutInput): Promise<{
  checkoutId: string;
  orderId: string;
  checkoutUrl: string;
  createdAt: string | null;
}> {
  const secretId = required(deps.env.VAULT_SQUARE_ACCESS_SECRET_ID, 'VAULT_SQUARE_ACCESS_SECRET_ID');
  const locationId = required(deps.env.SQUARE_LOCATION_ID, 'SQUARE_LOCATION_ID');
  const publicOrigin = safePublicOrigin(deps.env.APP_PUBLIC_ORIGIN);
  const origin = squareSandboxOriginOnly(deps.env.SQUARE_ENVIRONMENT);
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

  const requestBody = {
    idempotency_key: input.idempotencyKey,
    quick_pay: {
      name: input.displayName,
      price_money: { amount: Math.trunc(input.amount), currency: input.currency },
      location_id: locationId,
    },
    checkout_options: checkoutOptions,
    description: `Astera ${input.displayName}`,
    payment_note: `astera_billing_intent:${input.intentId}`,
  };

  const provider = await deps.vault.actionsHttp({
    secretId,
    url: `${origin}/v2/online-checkout/payment-links`,
    method: 'POST',
    secretHeader: 'Authorization',
    secretPrefix: 'Bearer ',
    headers: {
      'Square-Version': deps.env.SQUARE_VERSION?.trim() || '2026-07-15',
      'Content-Type': 'application/json',
    },
    body: requestBody,
  });

  const payload = JSON.parse(provider.body || '{}') as SquarePaymentLinkResponse;
  if (!provider.ok || !payload?.payment_link) {
    throw new FunctionHttpError(provider.status >= 500 ? 502 : 422, 'SQUARE_CHECKOUT_CREATE_FAILED', squareErrorMessage(payload?.errors), payload);
  }
  const checkoutId = payload.payment_link.id?.trim();
  const orderId = payload.payment_link.order_id?.trim();
  const checkoutUrl = payload.payment_link.url?.trim() || payload.payment_link.long_url?.trim();
  if (!checkoutId || !orderId || !checkoutUrl) {
    throw new FunctionHttpError(502, 'SQUARE_CHECKOUT_RESPONSE_INCOMPLETE', 'Square Checkout Responseに必須項目がありません。', payload);
  }
  const destination = new URL(checkoutUrl);
  const sandboxCheckout =
    deps.env.SQUARE_ENVIRONMENT?.trim().toLowerCase() !== 'production'
    && (destination.hostname === 'sandbox.square.link' || destination.hostname.endsWith('.squareupsandbox.com'));
  const productionCheckout =
    destination.hostname === 'square.link'
    || destination.hostname.endsWith('.square.site')
    || destination.hostname.endsWith('.squareup.com');
  if (destination.protocol !== 'https:' || !(sandboxCheckout || productionCheckout)) {
    throw new FunctionHttpError(502, 'SQUARE_CHECKOUT_URL_REJECTED', 'Squareの許可Host以外のCheckout URLを拒否しました。');
  }
  return {
    checkoutId,
    orderId,
    checkoutUrl: destination.toString(),
    createdAt: payload.payment_link.created_at?.trim() || null,
  };
}
