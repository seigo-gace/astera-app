import { requireProjectionClient } from './astera-projection.js';
import { type BillingServiceEnv } from '../part/billing-env.js';
import type { SquareEnv } from './square.js';

type Env = BillingServiceEnv & SquareEnv;

export type StoragePaymentInput = {
  eventId: string;
  orderId: string;
  paymentId: string;
  status: string;
  paidAmount: number | null;
  paidCurrency: string;
};

export async function handleStoragePaymentIfMatched(env: Env, input: StoragePaymentInput): Promise<string | null> {
  const projection = requireProjectionClient(env);
  const result = await projection.postStorageIntentPayment({
    provider_event_id: input.eventId,
    provider_order_id: input.orderId,
    provider_payment_id: input.paymentId,
    payment_status: input.status,
    paid_amount: input.paidAmount,
    paid_currency: input.paidCurrency,
  });
  if (!result.matched) return null;
  return result.processing_status ?? 'processed';
}
