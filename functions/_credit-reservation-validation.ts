import { FunctionHttpError } from './_account-projection';

export type CreditReservationInsertInput = {
  creditAccountId: string;
  estimatedAmount: number;
  status: string;
  expiresAt: string;
};

export type CreditAccountBalanceRow = {
  id: string;
  available_balance: number;
  reserved_balance: number;
};

export function assertPositiveIntegerEstimatedAmount(estimatedAmount: number): void {
  if (!Number.isInteger(estimatedAmount) || estimatedAmount <= 0) {
    throw new FunctionHttpError(400, 'CREDIT_RESERVATION_AMOUNT_INVALID', 'estimated_amountは正の整数である必要があります。');
  }
}

export function assertReservedInsertStatus(status: string): void {
  if (status !== 'reserved') {
    throw new FunctionHttpError(400, 'CREDIT_RESERVATION_STATUS_INVALID', 'Credit Reservationの新規Insertはstatus=reservedのみ許可されます。');
  }
}

export function assertFutureExpiresAt(expiresAt: string): void {
  const expiresAtMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
    throw new FunctionHttpError(400, 'CREDIT_RESERVATION_EXPIRES_AT_INVALID', 'expires_atは未来の日時である必要があります。');
  }
}

export function assertCreditAccountOwnership(creditAccountId: string, expectedCreditAccountId: string): void {
  if (creditAccountId !== expectedCreditAccountId) {
    throw new FunctionHttpError(403, 'CREDIT_ACCOUNT_OWNERSHIP_MISMATCH', 'Credit AccountとEstimateの所有者が一致しません。');
  }
}

export function assertSufficientAvailableBalance(
  account: CreditAccountBalanceRow,
  estimatedAmount: number,
): void {
  const available = Number(account.available_balance) - Number(account.reserved_balance);
  if (available < estimatedAmount) {
    throw new FunctionHttpError(409, 'CREDIT_INSUFFICIENT_FOR_RESERVATION', '実行直前のCredit確保に失敗しました。最新残高で再見積りしてください。');
  }
}

export async function validateCreditReservationBeforeInsert(
  db: D1Database,
  input: CreditReservationInsertInput,
  expectedCreditAccountId: string,
): Promise<CreditAccountBalanceRow> {
  assertPositiveIntegerEstimatedAmount(input.estimatedAmount);
  assertReservedInsertStatus(input.status);
  assertFutureExpiresAt(input.expiresAt);
  assertCreditAccountOwnership(input.creditAccountId, expectedCreditAccountId);

  const account = await db.prepare(
    `SELECT id, available_balance, reserved_balance
     FROM credit_accounts
     WHERE id = ?1
     LIMIT 1`,
  ).bind(input.creditAccountId).first<CreditAccountBalanceRow>();

  if (!account) {
    throw new FunctionHttpError(404, 'CREDIT_ACCOUNT_NOT_FOUND', 'Credit Accountが見つかりません。');
  }

  assertSufficientAvailableBalance(account, input.estimatedAmount);
  return account;
}

export function validateCreditReservationCommitTransition(
  previousStatus: string,
  nextStatus: string,
  estimatedAmount: number,
  committedAmount: number | null,
): void {
  if (previousStatus !== 'reserved' || nextStatus !== 'committed') {
    throw new FunctionHttpError(409, 'CREDIT_RESERVATION_COMMIT_STATE_INVALID', 'Credit Reservationはreservedからcommittedへの遷移のみCommitできます。');
  }
  if (committedAmount === null || !Number.isFinite(committedAmount) || committedAmount < 0 || committedAmount > estimatedAmount) {
    throw new FunctionHttpError(400, 'CREDIT_COMMIT_AMOUNT_INVALID', 'committed_amountは0以上estimated_amount以下である必要があります。');
  }
}

export function validateCreditReservationReleaseTransition(
  previousStatus: string,
  nextStatus: string,
): void {
  if (previousStatus !== 'reserved' || !['released', 'expired'].includes(nextStatus)) {
    throw new FunctionHttpError(409, 'CREDIT_RESERVATION_RELEASE_STATE_INVALID', 'Credit Reservationはreservedからreleased/expiredへの遷移のみReleaseできます。');
  }
}
