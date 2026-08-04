export type BillingIntentStatus =
  | 'intent_created'
  | 'eligibility_verified'
  | 'checkout_created'
  | 'awaiting_payment'
  | 'payment_confirmed'
  | 'subscription_active'
  | 'reconciliation_required'
  | 'failed'
  | 'expired'
  | 'cancelled'
  | 'refunded';

export type CreditMutationKind =
  | 'grant'
  | 'reserve'
  | 'commit'
  | 'release'
  | 'refund'
  | 'adjustment';

export type CreditMutation = {
  transactionId: string;
  accountId: string;
  amount: number;
  kind: CreditMutationKind;
  idempotencyKey: string;
  referenceType: string;
  referenceId: string;
};

export type CreditState =
  | 'normal'
  | 'low'
  | 'critical'
  | 'insufficient'
  | 'purchase_pending'
  | 'credited'
  | 'resume_available'
  | 'resume_blocked';

export function validateCreditMutation(mutation: CreditMutation): string[] {
  const errors: string[] = [];
  if (!mutation.transactionId) errors.push('transactionId');
  if (!mutation.accountId) errors.push('accountId');
  if (!Number.isFinite(mutation.amount) || mutation.amount === 0) errors.push('amount');
  if (!mutation.idempotencyKey) errors.push('idempotencyKey');
  if (!mutation.referenceType) errors.push('referenceType');
  if (!mutation.referenceId) errors.push('referenceId');
  return errors;
}
