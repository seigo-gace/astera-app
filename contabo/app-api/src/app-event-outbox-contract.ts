import type { AppEventEnvelope } from './app-event-contract.js';
import { validateAppEvent } from './app-event-contract.js';

export type AppEventOutboxState =
  | 'pending'
  | 'sending'
  | 'delivered'
  | 'retry_wait'
  | 'dead_letter';

export type AppEventOutboxRecord = {
  id: string;
  eventId: string;
  idempotencyKey: string;
  event: AppEventEnvelope;
  state: AppEventOutboxState;
  attempt: number;
  nextRetryAt?: string;
  leaseExpiresAt?: string;
  tgsOperationId?: string;
  createdAt: string;
  updatedAt: string;
};

export type AppEventOutboxClaim = Readonly<{
  id: string;
  eventId: string;
  attempt: number;
  leaseExpiresAt: string;
}>;

const ALLOWED_TRANSITIONS: Readonly<Record<AppEventOutboxState, readonly AppEventOutboxState[]>> = {
  pending: ['sending', 'dead_letter'],
  sending: ['delivered', 'retry_wait', 'dead_letter'],
  retry_wait: ['sending', 'dead_letter'],
  delivered: [],
  dead_letter: [],
};

function instant(value: string | undefined, code: string): number {
  if (!value?.trim()) throw new Error(code);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(code);
  return parsed;
}

export function validateOutboxRecord(record: AppEventOutboxRecord): AppEventOutboxRecord {
  validateAppEvent(record.event);
  if (!record.id.trim()) throw new Error('APP_EVENT_OUTBOX_ID_REQUIRED');
  if (!record.eventId.trim()) throw new Error('APP_EVENT_OUTBOX_EVENT_ID_REQUIRED');
  if (record.eventId !== record.event.eventId) throw new Error('APP_EVENT_OUTBOX_EVENT_ID_MISMATCH');
  if (!record.idempotencyKey.trim()) throw new Error('APP_EVENT_OUTBOX_IDEMPOTENCY_KEY_REQUIRED');
  if (!Number.isSafeInteger(record.attempt) || record.attempt < 0) throw new Error('APP_EVENT_OUTBOX_ATTEMPT_INVALID');

  const createdAt = instant(record.createdAt, 'APP_EVENT_OUTBOX_CREATED_AT_INVALID');
  const updatedAt = instant(record.updatedAt, 'APP_EVENT_OUTBOX_UPDATED_AT_INVALID');
  if (updatedAt < createdAt) throw new Error('APP_EVENT_OUTBOX_TIME_REGRESSION');

  if (record.state === 'retry_wait') {
    const nextRetryAt = instant(record.nextRetryAt, 'APP_EVENT_OUTBOX_RETRY_AT_REQUIRED');
    if (nextRetryAt <= updatedAt) throw new Error('APP_EVENT_OUTBOX_RETRY_AT_INVALID');
  } else if (record.nextRetryAt) {
    throw new Error('APP_EVENT_OUTBOX_RETRY_AT_FORBIDDEN');
  }

  if (record.state === 'sending') {
    const leaseExpiresAt = instant(record.leaseExpiresAt, 'APP_EVENT_OUTBOX_LEASE_REQUIRED');
    if (leaseExpiresAt <= updatedAt) throw new Error('APP_EVENT_OUTBOX_LEASE_INVALID');
    if (record.attempt < 1) throw new Error('APP_EVENT_OUTBOX_SENDING_ATTEMPT_INVALID');
  } else if (record.leaseExpiresAt) {
    throw new Error('APP_EVENT_OUTBOX_LEASE_FORBIDDEN');
  }

  return record;
}

export function assertOutboxTransition(from: AppEventOutboxState, to: AppEventOutboxState): void {
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new Error(`APP_EVENT_OUTBOX_TRANSITION_FORBIDDEN:${from}->${to}`);
  }
}

export function transitionOutbox(
  record: AppEventOutboxRecord,
  next: AppEventOutboxState,
  now: string,
  options: { nextRetryAt?: string; leaseExpiresAt?: string; tgsOperationId?: string } = {},
): AppEventOutboxRecord {
  validateOutboxRecord(record);
  assertOutboxTransition(record.state, next);
  const transitionAt = instant(now, 'APP_EVENT_OUTBOX_UPDATED_AT_INVALID');
  if (transitionAt < Date.parse(record.updatedAt)) throw new Error('APP_EVENT_OUTBOX_TIME_REGRESSION');

  const transitioned: AppEventOutboxRecord = {
    ...record,
    state: next,
    attempt: next === 'sending' ? record.attempt + 1 : record.attempt,
    updatedAt: now,
  };

  delete transitioned.nextRetryAt;
  delete transitioned.leaseExpiresAt;

  if (next === 'retry_wait') {
    const nextRetryAt = instant(options.nextRetryAt, 'APP_EVENT_OUTBOX_RETRY_AT_REQUIRED');
    if (nextRetryAt <= transitionAt) throw new Error('APP_EVENT_OUTBOX_RETRY_AT_INVALID');
    transitioned.nextRetryAt = options.nextRetryAt!;
  }

  if (next === 'sending') {
    const leaseExpiresAt = instant(options.leaseExpiresAt, 'APP_EVENT_OUTBOX_LEASE_REQUIRED');
    if (leaseExpiresAt <= transitionAt) throw new Error('APP_EVENT_OUTBOX_LEASE_INVALID');
    transitioned.leaseExpiresAt = options.leaseExpiresAt!;
  }

  if (options.tgsOperationId) transitioned.tgsOperationId = options.tgsOperationId;

  return validateOutboxRecord(transitioned);
}

export function outboxClaim(record: AppEventOutboxRecord): AppEventOutboxClaim {
  validateOutboxRecord(record);
  if (record.state !== 'sending' || !record.leaseExpiresAt) throw new Error('APP_EVENT_OUTBOX_NOT_CLAIMED');
  return {
    id: record.id,
    eventId: record.eventId,
    attempt: record.attempt,
    leaseExpiresAt: record.leaseExpiresAt,
  };
}

export function assertActiveOutboxClaim(
  record: AppEventOutboxRecord,
  claim: AppEventOutboxClaim,
  now: string,
): void {
  validateOutboxRecord(record);
  if (
    record.state !== 'sending'
    || record.id !== claim.id
    || record.eventId !== claim.eventId
    || record.attempt !== claim.attempt
    || record.leaseExpiresAt !== claim.leaseExpiresAt
  ) {
    throw new Error('APP_EVENT_OUTBOX_CLAIM_STALE');
  }
  const checkedAt = instant(now, 'APP_EVENT_OUTBOX_CLAIM_TIME_INVALID');
  if (Date.parse(claim.leaseExpiresAt) <= checkedAt) throw new Error('APP_EVENT_OUTBOX_CLAIM_EXPIRED');
}

export function isSendingLeaseExpired(record: AppEventOutboxRecord, now: string): boolean {
  validateOutboxRecord(record);
  if (record.state !== 'sending' || !record.leaseExpiresAt) return false;
  return Date.parse(record.leaseExpiresAt) <= instant(now, 'APP_EVENT_OUTBOX_CLAIM_TIME_INVALID');
}

export function recoverExpiredSendingOutbox(
  record: AppEventOutboxRecord,
  now: string,
  nextRetryAt: string,
): AppEventOutboxRecord {
  validateOutboxRecord(record);
  if (record.state !== 'sending') throw new Error('APP_EVENT_OUTBOX_RECOVERY_STATE_INVALID');
  if (!isSendingLeaseExpired(record, now)) throw new Error('APP_EVENT_OUTBOX_LEASE_NOT_EXPIRED');
  return transitionOutbox(record, 'retry_wait', now, { nextRetryAt });
}
