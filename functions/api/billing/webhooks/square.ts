import {
  FunctionHttpError,
  functionErrorResponse,
  requestCorrelationId,
  type AsteraFunctionEnv,
} from "../../../_account-projection";
import { verifySquareWebhook, type SquareEnv } from "../../../_square";

type Env = AsteraFunctionEnv & SquareEnv;
type PagesContext = { request: Request; env: Env };
type SquareEvent = {
  event_id?: string;
  type?: string;
  created_at?: string;
  data?: { type?: string; id?: string; object?: Record<string, unknown> };
};
type BillingIntentRow = {
  id: string;
  tenant_id: string;
  catalog_version: string;
  product_id: string;
  product_kind: "credit" | "plan";
  billing_cycle: "monthly" | "annual" | null;
  currency: string;
  amount: number;
  credit_amount: number;
  status: string;
  provider_order_id: string | null;
};
type TenantSubscriptionRow = {
  id: string;
  tenant_id: string;
  catalog_version: string;
  plan_id: string;
  billing_cycle: "monthly" | "annual";
  provider_subscription_id: string | null;
  status: string;
};
function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function text(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value.trim() : "";
}
function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (
    typeof value === "string" &&
    value.trim() &&
    Number.isFinite(Number(value))
  )
    return Number(value);
  return null;
}
async function updateEvent(
  env: Env,
  eventId: string,
  processingStatus: string,
  intentId: string | null,
): Promise<void> {
  await env.ASTERA_DB.prepare(
    `UPDATE billing_events SET billing_intent_id = ?1, processing_status = ?2, processed_at = ?3 WHERE provider_event_id = ?4`,
  )
    .bind(intentId, processingStatus, new Date().toISOString(), eventId)
    .run();
}
const intentSelect = `SELECT id, tenant_id, catalog_version, product_id, product_kind, billing_cycle, currency, amount, credit_amount, status, provider_order_id FROM billing_intents`;

async function handlePaymentEvent(
  env: Env,
  event: SquareEvent,
): Promise<string> {
  const eventId = event.event_id as string;
  const payment = asRecord(asRecord(event.data?.object).payment);
  const orderId = text(payment, "order_id");
  const paymentId = text(payment, "id");
  const status = text(payment, "status").toUpperCase();
  const amountMoney = asRecord(payment.amount_money);
  const paidAmount = numberValue(amountMoney.amount);
  const paidCurrency = text(amountMoney, "currency");
  if (!orderId) {
    await updateEvent(env, eventId, "ignored_missing_order_id", null);
    return "ignored_missing_order_id";
  }
  const intent = await env.ASTERA_DB.prepare(
    `${intentSelect} WHERE provider_order_id = ?1 LIMIT 1`,
  )
    .bind(orderId)
    .first<BillingIntentRow>();
  if (!intent) {
    await updateEvent(env, eventId, "unmatched_order", null);
    return "unmatched_order";
  }
  if (
    paidAmount === null ||
    paidAmount !== Number(intent.amount) ||
    paidCurrency !== intent.currency
  ) {
    await env.ASTERA_DB.batch([
      env.ASTERA_DB.prepare(
        `UPDATE billing_intents SET status='reconciliation_required', provider_payment_id=?1, failure_code='PAYMENT_AMOUNT_OR_CURRENCY_MISMATCH', updated_at=?2 WHERE id=?3`,
      ).bind(paymentId || null, new Date().toISOString(), intent.id),
      env.ASTERA_DB.prepare(
        `UPDATE billing_events SET billing_intent_id=?1, processing_status='reconciliation_required', processed_at=?2 WHERE provider_event_id=?3`,
      ).bind(intent.id, new Date().toISOString(), eventId),
    ]);
    return "reconciliation_required";
  }
  if (status === "COMPLETED") {
    if (intent.product_kind === "credit") {
      const creditAccount = await env.ASTERA_DB.prepare(
        `SELECT id FROM credit_accounts WHERE tenant_id=?1 LIMIT 1`,
      )
        .bind(intent.tenant_id)
        .first<{ id: string }>();
      if (!creditAccount?.id)
        throw new FunctionHttpError(
          503,
          "CREDIT_ACCOUNT_NOT_FOUND",
          "Credit Accountを確認できません。",
        );
      const now = new Date().toISOString();
      const transactionId = `billing-grant:${intent.id}`;
      const fingerprint = JSON.stringify({
        event_id: eventId,
        payment_id: paymentId,
        order_id: orderId,
        amount: paidAmount,
        currency: paidCurrency,
        credits: Number(intent.credit_amount),
        catalog_version: intent.catalog_version,
        product_id: intent.product_id,
      });
      await env.ASTERA_DB.batch([
        env.ASTERA_DB.prepare(
          `UPDATE credit_accounts SET available_balance=available_balance+?1, version=version+1, updated_at=?2 WHERE id=?3 AND NOT EXISTS (SELECT 1 FROM credit_ledger WHERE reference_type='billing_intent' AND reference_id=?4 AND kind='grant')`,
        ).bind(Number(intent.credit_amount), now, creditAccount.id, intent.id),
        env.ASTERA_DB.prepare(
          `INSERT OR IGNORE INTO credit_ledger (transaction_id, credit_account_id, kind, amount, idempotency_key, reference_type, reference_id, request_fingerprint, created_at) VALUES (?1, ?2, 'grant', ?3, ?4, 'billing_intent', ?5, ?6, ?7)`,
        ).bind(
          transactionId,
          creditAccount.id,
          Number(intent.credit_amount),
          `square:${eventId}:grant`,
          intent.id,
          fingerprint,
          now,
        ),
        env.ASTERA_DB.prepare(
          `UPDATE billing_intents SET status='completed', provider_payment_id=?1, completed_at=?2, failure_code=NULL, updated_at=?2 WHERE id=?3`,
        ).bind(paymentId || null, now, intent.id),
        env.ASTERA_DB.prepare(
          `UPDATE billing_events SET billing_intent_id=?1, processing_status='processed', processed_at=?2 WHERE provider_event_id=?3`,
        ).bind(intent.id, now, eventId),
      ]);
      return "processed";
    }
    const mapped = await env.ASTERA_DB.prepare(
      `SELECT provider_subscription_id, status FROM tenant_subscriptions WHERE tenant_id=?1 AND plan_id=?2 AND billing_cycle=?3 AND provider_subscription_id IS NOT NULL LIMIT 1`,
    )
      .bind(
        intent.tenant_id,
        intent.product_id,
        intent.billing_cycle || "monthly",
      )
      .first<{ provider_subscription_id: string; status: string }>();
    const now = new Date().toISOString();
    if (
      mapped?.provider_subscription_id &&
      !["cancelled", "failed"].includes(mapped.status)
    ) {
      await env.ASTERA_DB.batch([
        env.ASTERA_DB.prepare(
          `UPDATE billing_intents SET status='completed', provider_payment_id=?1, completed_at=COALESCE(completed_at,?2), failure_code=NULL, updated_at=?2 WHERE id=?3`,
        ).bind(paymentId || null, now, intent.id),
        env.ASTERA_DB.prepare(
          `UPDATE billing_events SET billing_intent_id=?1, processing_status='processed', processed_at=?2 WHERE provider_event_id=?3`,
        ).bind(intent.id, now, eventId),
      ]);
      return "processed";
    }
    await env.ASTERA_DB.batch([
      env.ASTERA_DB.prepare(
        `UPDATE billing_intents SET status='reconciliation_required', provider_payment_id=?1, failure_code='SUBSCRIPTION_ID_RECONCILIATION_REQUIRED', updated_at=?2 WHERE id=?3`,
      ).bind(paymentId || null, now, intent.id),
      env.ASTERA_DB.prepare(
        `UPDATE billing_events SET billing_intent_id=?1, processing_status='reconciliation_required', processed_at=?2 WHERE provider_event_id=?3`,
      ).bind(intent.id, now, eventId),
    ]);
    return "reconciliation_required";
  }
  if (status === "FAILED" || status === "CANCELED" || status === "CANCELLED") {
    const finalState = status === "FAILED" ? "failed" : "cancelled";
    await env.ASTERA_DB.batch([
      env.ASTERA_DB.prepare(
        `UPDATE billing_intents SET status=?1, provider_payment_id=?2, failure_code=?3, updated_at=?4 WHERE id=?5`,
      ).bind(
        finalState,
        paymentId || null,
        `SQUARE_PAYMENT_${status}`,
        new Date().toISOString(),
        intent.id,
      ),
      env.ASTERA_DB.prepare(
        `UPDATE billing_events SET billing_intent_id=?1, processing_status='processed', processed_at=?2 WHERE provider_event_id=?3`,
      ).bind(intent.id, new Date().toISOString(), eventId),
    ]);
    return "processed";
  }
  await env.ASTERA_DB.batch([
    env.ASTERA_DB.prepare(
      `UPDATE billing_intents SET status='payment_pending', provider_payment_id=?1, updated_at=?2 WHERE id=?3`,
    ).bind(paymentId || null, new Date().toISOString(), intent.id),
    env.ASTERA_DB.prepare(
      `UPDATE billing_events SET billing_intent_id=?1, processing_status='pending', processed_at=?2 WHERE provider_event_id=?3`,
    ).bind(intent.id, new Date().toISOString(), eventId),
  ]);
  return "pending";
}

async function handleInvoicePaymentEvent(
  env: Env,
  event: SquareEvent,
): Promise<string> {
  const eventId = event.event_id as string;
  const invoice = asRecord(asRecord(event.data?.object).invoice);
  const orderId = text(invoice, "order_id");
  const subscriptionId = text(invoice, "subscription_id");
  if (!subscriptionId) {
    await updateEvent(env, eventId, "ignored_missing_subscription_id", null);
    return "ignored_missing_subscription_id";
  }
  const existingBySubscription = await env.ASTERA_DB.prepare(
    `SELECT id,tenant_id,catalog_version,plan_id,billing_cycle,provider_subscription_id,status FROM tenant_subscriptions WHERE provider_subscription_id=?1 LIMIT 1`,
  )
    .bind(subscriptionId)
    .first<TenantSubscriptionRow>();
  if (!orderId) {
    if (existingBySubscription) {
      await updateEvent(env, eventId, "processed", null);
      return "processed";
    }
    await updateEvent(env, eventId, "ignored_missing_order_id", null);
    return "ignored_missing_order_id";
  }
  const intent = await env.ASTERA_DB.prepare(
    `${intentSelect} WHERE provider_order_id=?1 AND product_kind='plan' LIMIT 1`,
  )
    .bind(orderId)
    .first<BillingIntentRow>();
  if (!intent) {
    if (existingBySubscription) {
      await updateEvent(env, eventId, "processed", null);
      return "processed";
    }
    await updateEvent(env, eventId, "unmatched_subscription_invoice", null);
    return "unmatched_subscription_invoice";
  }
  const current = await env.ASTERA_DB.prepare(
    `SELECT id,tenant_id,catalog_version,plan_id,billing_cycle,provider_subscription_id,status FROM tenant_subscriptions WHERE tenant_id=?1 LIMIT 1`,
  )
    .bind(intent.tenant_id)
    .first<TenantSubscriptionRow>();
  const now = new Date().toISOString();
  if (
    current?.provider_subscription_id &&
    current.provider_subscription_id !== subscriptionId &&
    !["cancelled", "failed", "none"].includes(current.status)
  ) {
    await env.ASTERA_DB.batch([
      env.ASTERA_DB.prepare(
        `UPDATE billing_intents SET status='reconciliation_required', failure_code='SUBSCRIPTION_CHANGE_REQUIRES_SWAP', updated_at=?1 WHERE id=?2`,
      ).bind(now, intent.id),
      env.ASTERA_DB.prepare(
        `UPDATE billing_events SET billing_intent_id=?1, processing_status='reconciliation_required', processed_at=?2 WHERE provider_event_id=?3`,
      ).bind(intent.id, now, eventId),
    ]);
    return "reconciliation_required";
  }
  const cycle = intent.billing_cycle || "monthly";
  const localId = current?.id || crypto.randomUUID();
  const subscriptionWrite = current
    ? env.ASTERA_DB.prepare(
        `UPDATE tenant_subscriptions SET catalog_version=?1, plan_id=?2, billing_cycle=?3, provider_subscription_id=?4, status='active', cancel_at_period_end=0, updated_at=?5 WHERE id=?6`,
      ).bind(
        intent.catalog_version,
        intent.product_id,
        cycle,
        subscriptionId,
        now,
        current.id,
      )
    : env.ASTERA_DB.prepare(
        `INSERT INTO tenant_subscriptions (id,tenant_id,catalog_version,plan_id,billing_cycle,provider_subscription_id,status,current_period_start,current_period_end,cancel_at_period_end,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,'active',NULL,NULL,0,?7,?7)`,
      ).bind(
        localId,
        intent.tenant_id,
        intent.catalog_version,
        intent.product_id,
        cycle,
        subscriptionId,
        now,
      );
  await env.ASTERA_DB.batch([
    subscriptionWrite,
    env.ASTERA_DB.prepare(
      `UPDATE billing_intents SET status='completed', completed_at=COALESCE(completed_at,?1), failure_code=NULL, updated_at=?1 WHERE id=?2`,
    ).bind(now, intent.id),
    env.ASTERA_DB.prepare(
      `UPDATE billing_events SET billing_intent_id=?1, processing_status='processed', processed_at=?2 WHERE provider_event_id=?3`,
    ).bind(intent.id, now, eventId),
  ]);
  return "processed";
}

async function handleSubscriptionEvent(
  env: Env,
  event: SquareEvent,
): Promise<string> {
  const eventId = event.event_id as string;
  const subscription = asRecord(asRecord(event.data?.object).subscription);
  const subscriptionId = text(subscription, "id");
  const status = text(subscription, "status").toLowerCase();
  if (!subscriptionId) {
    await updateEvent(env, eventId, "ignored_missing_subscription_id", null);
    return "ignored_missing_subscription_id";
  }
  const current = await env.ASTERA_DB.prepare(
    `SELECT id,tenant_id FROM tenant_subscriptions WHERE provider_subscription_id=?1 LIMIT 1`,
  )
    .bind(subscriptionId)
    .first<{ id: string; tenant_id: string }>();
  if (!current) {
    await updateEvent(env, eventId, "reconciliation_required", null);
    return "reconciliation_required";
  }
  const normalizedStatus =
    status === "active"
      ? "active"
      : status === "paused"
        ? "paused"
        : status === "canceled" ||
            status === "cancelled" ||
            status === "deactivated"
          ? "cancelled"
          : "pending";
  await env.ASTERA_DB.batch([
    env.ASTERA_DB.prepare(
      `UPDATE tenant_subscriptions SET status=?1, current_period_start=COALESCE(?2,current_period_start), current_period_end=COALESCE(?3,current_period_end), updated_at=?4 WHERE id=?5`,
    ).bind(
      normalizedStatus,
      text(subscription, "start_date") || null,
      text(subscription, "charged_through_date") || null,
      new Date().toISOString(),
      current.id,
    ),
    env.ASTERA_DB.prepare(
      `UPDATE billing_events SET processing_status='processed', processed_at=?1 WHERE provider_event_id=?2`,
    ).bind(new Date().toISOString(), eventId),
  ]);
  return "processed";
}

export async function onRequestPost(context: PagesContext): Promise<Response> {
  const requestId = requestCorrelationId(context.request);
  const rawBody = await context.request.text();
  try {
    const signature = context.request.headers.get(
      "x-square-hmacsha256-signature",
    );
    if (!(await verifySquareWebhook(context.env, signature, rawBody)))
      throw new FunctionHttpError(
        403,
        "SQUARE_WEBHOOK_SIGNATURE_INVALID",
        "Square Webhook署名を確認できません。",
      );
    const event = JSON.parse(rawBody) as SquareEvent;
    const eventId = event.event_id?.trim();
    const eventType = event.type?.trim();
    if (!eventId || !eventType)
      throw new FunctionHttpError(
        400,
        "SQUARE_WEBHOOK_EVENT_INVALID",
        "Square Event IDまたはTypeがありません。",
      );
    const existing = await context.env.ASTERA_DB.prepare(
      `SELECT processing_status FROM billing_events WHERE provider_event_id=?1 LIMIT 1`,
    )
      .bind(eventId)
      .first<{ processing_status: string }>();
    if (
      existing?.processing_status &&
      existing.processing_status !== "processing"
    )
      return Response.json(
        {
          accepted: true,
          duplicate: true,
          event_id: eventId,
          processing_status: existing.processing_status,
        },
        {
          headers: {
            "Cache-Control": "no-store",
            "X-Correlation-ID": requestId,
          },
        },
      );
    await context.env.ASTERA_DB.prepare(
      `INSERT OR IGNORE INTO billing_events (provider_event_id,billing_intent_id,signature_verified,event_type,received_at,processed_at,processing_status) VALUES (?1,NULL,1,?2,?3,NULL,'processing')`,
    )
      .bind(eventId, eventType, new Date().toISOString())
      .run();
    let processingStatus: string;
    if (eventType === "payment.created" || eventType === "payment.updated")
      processingStatus = await handlePaymentEvent(context.env, event);
    else if (eventType === "invoice.payment_made")
      processingStatus = await handleInvoicePaymentEvent(context.env, event);
    else if (
      eventType === "subscription.created" ||
      eventType === "subscription.updated"
    )
      processingStatus = await handleSubscriptionEvent(context.env, event);
    else {
      await updateEvent(context.env, eventId, "ignored_event_type", null);
      processingStatus = "ignored_event_type";
    }
    return Response.json(
      {
        accepted: true,
        event_id: eventId,
        processing_status: processingStatus,
      },
      {
        headers: { "Cache-Control": "no-store", "X-Correlation-ID": requestId },
      },
    );
  } catch (error) {
    return functionErrorResponse(error, requestId);
  }
}
export function onRequest(context: PagesContext): Promise<Response> {
  if (context.request.method !== "POST")
    return Promise.resolve(
      Response.json(
        {
          error: {
            code: "METHOD_NOT_ALLOWED",
            message: "POSTのみ対応しています。",
          },
        },
        { status: 405 },
      ),
    );
  return onRequestPost(context);
}
