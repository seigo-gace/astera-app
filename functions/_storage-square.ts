import { type AsteraFunctionEnv } from './_account-projection';
import type { SquareEnv } from './_square';

type Env = AsteraFunctionEnv & SquareEnv;

type StorageIntentRow = {
  id: string;
  tenant_id: string;
  user_id: string;
  catalog_version: string;
  product_id: string;
  capacity_gb: number;
  price_jpy: number;
  status: string;
};

export type StoragePaymentInput = {
  eventId: string;
  orderId: string;
  paymentId: string;
  status: string;
  paidAmount: number | null;
  paidCurrency: string;
};

async function updateStorageEvent(env: Env, eventId: string, processingStatus: string): Promise<void> {
  await env.ASTERA_DB.prepare(
    `UPDATE billing_events
     SET billing_intent_id=NULL, processing_status=?1, processed_at=?2
     WHERE provider_event_id=?3`,
  ).bind(processingStatus, new Date().toISOString(), eventId).run();
}

export async function handleStoragePaymentIfMatched(env: Env, input: StoragePaymentInput): Promise<string | null> {
  const intent = await env.ASTERA_DB.prepare(
    `SELECT id, tenant_id, user_id, catalog_version, product_id, capacity_gb, price_jpy, status
     FROM astera_storage_pack_intents WHERE provider_order_id=?1 LIMIT 1`,
  ).bind(input.orderId).first<StorageIntentRow>();
  if (!intent) return null;

  const now = new Date().toISOString();
  if (input.paidAmount === null || input.paidAmount !== Number(intent.price_jpy) || input.paidCurrency !== 'JPY') {
    await env.ASTERA_DB.batch([
      env.ASTERA_DB.prepare(
        `UPDATE astera_storage_pack_intents
         SET status='reconciliation_required', provider_payment_id=?1,
             failure_code='PAYMENT_AMOUNT_OR_CURRENCY_MISMATCH', updated_at=?2
         WHERE id=?3`,
      ).bind(input.paymentId || null, now, intent.id),
      env.ASTERA_DB.prepare(
        `UPDATE billing_events
         SET billing_intent_id=NULL, processing_status='reconciliation_required', processed_at=?1
         WHERE provider_event_id=?2`,
      ).bind(now, input.eventId),
    ]);
    return 'reconciliation_required';
  }

  if (input.status === 'COMPLETED') {
    await env.ASTERA_DB.batch([
      env.ASTERA_DB.prepare(
        `INSERT OR IGNORE INTO astera_storage_pack_purchases
          (id, tenant_id, user_id, catalog_version, product_id, capacity_gb, price_jpy,
           provider_order_id, provider_payment_id, purchased_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)`,
      ).bind(
        intent.id,
        intent.tenant_id,
        intent.user_id,
        intent.catalog_version,
        intent.product_id,
        Number(intent.capacity_gb),
        Number(intent.price_jpy),
        input.orderId,
        input.paymentId || null,
        now,
      ),
      env.ASTERA_DB.prepare(
        `UPDATE astera_storage_pack_intents
         SET status='completed', provider_payment_id=?1, completed_at=COALESCE(completed_at,?2),
             failure_code=NULL, updated_at=?2
         WHERE id=?3`,
      ).bind(input.paymentId || null, now, intent.id),
      env.ASTERA_DB.prepare(
        `UPDATE billing_events
         SET billing_intent_id=NULL, processing_status='processed', processed_at=?1
         WHERE provider_event_id=?2`,
      ).bind(now, input.eventId),
    ]);
    return 'processed';
  }

  if (input.status === 'FAILED' || input.status === 'CANCELED' || input.status === 'CANCELLED') {
    const finalState = input.status === 'FAILED' ? 'failed' : 'cancelled';
    await env.ASTERA_DB.batch([
      env.ASTERA_DB.prepare(
        `UPDATE astera_storage_pack_intents
         SET status=?1, provider_payment_id=?2, failure_code=?3, updated_at=?4
         WHERE id=?5`,
      ).bind(finalState, input.paymentId || null, `SQUARE_PAYMENT_${input.status}`, now, intent.id),
      env.ASTERA_DB.prepare(
        `UPDATE billing_events
         SET billing_intent_id=NULL, processing_status='processed', processed_at=?1
         WHERE provider_event_id=?2`,
      ).bind(now, input.eventId),
    ]);
    return 'processed';
  }

  await env.ASTERA_DB.prepare(
    `UPDATE astera_storage_pack_intents
     SET status='payment_pending', provider_payment_id=?1, updated_at=?2
     WHERE id=?3`,
  ).bind(input.paymentId || null, now, intent.id).run();
  await updateStorageEvent(env, input.eventId, 'pending');
  return 'pending';
}
