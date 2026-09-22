import { FunctionHttpError } from '../part/billing-env.js';
import {
  squareSandboxOriginOnly,
  type LibralVaultClient,
} from './libral-vault.js';

type Env = {
  SQUARE_ENVIRONMENT?: string;
  SQUARE_VERSION?: string;
  VAULT_SQUARE_ACCESS_SECRET_ID?: string;
};

function json(body: string): any {
  try {
    return JSON.parse(body || '{}');
  } catch {
    return {};
  }
}

function secretId(env: Env): string {
  const id = env.VAULT_SQUARE_ACCESS_SECRET_ID?.trim();
  if (!id) {
    throw new FunctionHttpError(
      503,
      'SQUARE_SECRET_MISSING',
      'Square secret missing.',
    );
  }
  return id;
}

function squareHeaders(env: Env): Record<string, string> {
  return {
    'Square-Version':
      env.SQUARE_VERSION?.trim() || '2026-07-15',
    'Content-Type': 'application/json',
  };
}

function squareUrl(
  env: Env,
  path: string,
): string {
  return (
    squareSandboxOriginOnly(env.SQUARE_ENVIRONMENT) +
    path
  );
}

async function request(
  env: Env,
  vault: LibralVaultClient,
  method: string,
  path: string,
  body?: Record<string, unknown>,
) {
  return vault.actionsHttp({
    secretId: secretId(env),
    url: squareUrl(env, path),
    method,
    secretHeader: 'Authorization',
    secretPrefix: 'Bearer ',
    headers: squareHeaders(env),
    ...(body === undefined ? {} : { body }),
  });
}

function validateReference(
  orderId: string,
  intentId: string,
): void {
  if (!orderId.trim()) {
    throw new FunctionHttpError(
      500,
      'SQUARE_ORDER_ID_MISSING',
      'Square order ID missing.',
    );
  }

  if (!intentId.trim() || intentId.length > 40) {
    throw new FunctionHttpError(
      500,
      'SQUARE_ORDER_REFERENCE_INVALID',
      'Invalid intent reference.',
    );
  }
}

async function getOrderVersion(
  env: Env,
  vault: LibralVaultClient,
  orderId: string,
): Promise<number> {
  const r = await request(
    env,
    vault,
    'GET',
    '/v2/orders/' + encodeURIComponent(orderId),
  );

  const j = json(r.body);
  const version = Number(j.order?.version);

  if (!r.ok || !Number.isSafeInteger(version)) {
    throw new FunctionHttpError(
      502,
      'SQUARE_ORDER_READ_FAILED',
      'Square order read failed.',
    );
  }

  return version;
}

async function updateOrderReference(
  env: Env,
  vault: LibralVaultClient,
  orderId: string,
  intentId: string,
  version: number,
): Promise<void> {
  const r = await request(
    env,
    vault,
    'PUT',
    '/v2/orders/' + encodeURIComponent(orderId),
    {
      idempotency_key: 'astera-ref:' + intentId,
      order: {
        version,
        reference_id: intentId,
      },
    },
  );

  if (!r.ok) {
    throw new FunctionHttpError(
      502,
      'SQUARE_ORDER_REFERENCE_FAILED',
      'Square order reference update failed.',
    );
  }
}

async function verifyOrderReference(
  env: Env,
  vault: LibralVaultClient,
  orderId: string,
  intentId: string,
): Promise<void> {
  const r = await request(
    env,
    vault,
    'GET',
    '/v2/orders/' + encodeURIComponent(orderId),
  );

  const j = json(r.body);

  if (!r.ok || j.order?.reference_id !== intentId) {
    throw new FunctionHttpError(
      502,
      'SQUARE_ORDER_REFERENCE_MISMATCH',
      'Square order reference readback mismatch.',
      j,
    );
  }
}

export async function bindSquareOrderReference(
  env: Env,
  vault: LibralVaultClient,
  orderId: string,
  intentId: string,
): Promise<void> {
  validateReference(orderId, intentId);

  const version = await getOrderVersion(
    env,
    vault,
    orderId,
  );

  await updateOrderReference(
    env,
    vault,
    orderId,
    intentId,
    version,
  );

  await verifyOrderReference(
    env,
    vault,
    orderId,
    intentId,
  );
}

async function getSquareOrderReference(
  env: Env,
  vault: LibralVaultClient,
  orderId: string,
): Promise<string | null> {
  const r = await request(
    env,
    vault,
    'GET',
    '/v2/orders/' + encodeURIComponent(orderId.trim()),
  );

  const j = json(r.body);

  if (!r.ok || !j.order) {
    throw new FunctionHttpError(
      502,
      'SQUARE_ORDER_READ_FAILED',
      'Square order read failed.',
    );
  }

  const referenceId = String(
    j.order.reference_id ?? '',
  ).trim();

  return referenceId || null;
}

export async function getSquareSubscriptionSnapshot(
  env: Env,
  vault: LibralVaultClient,
  subscriptionId: string,
) {
  const r = await request(
    env,
    vault,
    'GET',
    '/v2/subscriptions/' +
      encodeURIComponent(subscriptionId.trim()),
  );

  const j = json(r.body);
  const subscription = j.subscription;

  if (!r.ok || !subscription) {
    throw new FunctionHttpError(
      502,
      'SQUARE_SUBSCRIPTION_READ_FAILED',
      'Square subscription read failed.',
    );
  }

  const phases = Array.isArray(subscription.phases)
    ? subscription.phases
    : [];

  const orderTemplateIds: string[] = [
    ...new Set<string>(
      phases
        .map((phase: any) =>
          String(phase?.order_template_id ?? '').trim(),
        )
        .filter((value: string) => value.length > 0),
    ),
  ];

  return {
    id: String(subscription.id ?? '').trim(),
    customerId: String(subscription.customer_id ?? '').trim(),
    cardId: String(subscription.card_id ?? '').trim(),
    planVariationId: String(
      subscription.plan_variation_id ?? '',
    ).trim(),
    status: String(subscription.status ?? '')
      .trim()
      .toLowerCase(),
    startDate:
      String(subscription.start_date ?? '').trim() || null,
    chargedThroughDate:
      String(subscription.charged_through_date ?? '').trim() ||
      null,
    orderTemplateIds,
  };
}

export async function resolveSquareSubscriptionReference(
  env: Env,
  vault: LibralVaultClient,
  subscriptionId: string,
) {
  const snapshot =
    await getSquareSubscriptionSnapshot(
      env,
      vault,
      subscriptionId,
    );

  const references = new Set<string>();

  for (const orderId of snapshot.orderTemplateIds) {
    const referenceId =
      await getSquareOrderReference(
        env,
        vault,
        orderId,
      );

    if (referenceId) {
      references.add(referenceId);
    }
  }

  if (references.size !== 1) {
    throw new FunctionHttpError(
      502,
      'SQUARE_SUBSCRIPTION_REFERENCE_UNRESOLVED',
      'Square subscription reference is not exact.',
    );
  }

  return {
    ...snapshot,
    referenceId: [...references][0],
  };
}

const BILLING_INTENT_NOTE =
  /^astera_billing_intent:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export async function resolvePaidInvoiceIntentReference(
  env: Env,
  vault: LibralVaultClient,
  invoiceOrderId: string,
) {
  const orderResponse = await request(
    env,
    vault,
    'GET',
    '/v2/orders/' +
      encodeURIComponent(invoiceOrderId.trim()),
  );

  const orderJson = json(orderResponse.body);
  const tenders = Array.isArray(orderJson.order?.tenders)
    ? orderJson.order.tenders
    : [];

  if (!orderResponse.ok || !orderJson.order) {
    throw new FunctionHttpError(
      502,
      'SQUARE_INVOICE_ORDER_READ_FAILED',
      'Square invoice order read failed.',
    );
  }

  const paymentIds: string[] = [
    ...new Set<string>(
      tenders
        .map((tender: any) =>
          String(tender?.payment_id ?? '').trim(),
        )
        .filter((value: string) => value.length > 0),
    ),
  ];

  if (!paymentIds.length) {
    throw new FunctionHttpError(
      502,
      'SQUARE_INVOICE_PAYMENT_ID_MISSING',
      'Square invoice payment ID missing.',
    );
  }

  const matches: Array<{
    intentId: string;
    paymentId: string;
    amount: number;
    currency: string;
  }> = [];

  for (const paymentId of paymentIds) {
    const paymentResponse = await request(
      env,
      vault,
      'GET',
      '/v2/payments/' +
        encodeURIComponent(paymentId),
    );

    const paymentJson = json(paymentResponse.body);
    const payment = paymentJson.payment;

    if (!paymentResponse.ok || !payment) {
      throw new FunctionHttpError(
        502,
        'SQUARE_PAYMENT_READ_FAILED',
        'Square payment read failed.',
      );
    }

    if (
      String(payment.status ?? '')
        .trim()
        .toUpperCase() !== 'COMPLETED'
    ) {
      continue;
    }

    const match = BILLING_INTENT_NOTE.exec(
      String(payment.note ?? '').trim(),
    );

    if (!match) {
      continue;
    }

    const amount = Number(
      payment.amount_money?.amount ??
        payment.total_money?.amount,
    );
    const currency = String(
      payment.amount_money?.currency ??
        payment.total_money?.currency ??
        '',
    ).trim();

    if (
      !Number.isSafeInteger(amount) ||
      amount <= 0 ||
      !currency
    ) {
      throw new FunctionHttpError(
        502,
        'SQUARE_PAYMENT_AMOUNT_INVALID',
        'Square payment amount is invalid.',
      );
    }

    matches.push({
      intentId: match[1],
      paymentId,
      amount,
      currency,
    });
  }

  if (matches.length !== 1) {
    throw new FunctionHttpError(
      502,
      'SQUARE_PAYMENT_INTENT_REFERENCE_UNRESOLVED',
      'Square payment intent reference is not exact.',
    );
  }

  return matches[0];
}
