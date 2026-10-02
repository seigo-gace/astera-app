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
  tgsOperationId?: string;
  createdAt: string;
  updatedAt: string;
};

const ALLOWED_TRANSITIONS: Readonly<Record<AppEventOutboxState, readonly AppEventOutboxState[]>> = {
  pending: ['sending', 'dead_letter'],
  sending: ['delivered', 'retry_wait', 'dead_letter'],
  retry_wait: ['sending', 'dead_letter'],
  delivered: [],
  dead_letter: [],
};

export function validateOutboxRecord(record: AppEventOutboxRecord): AppEventOutboxRecord {
  validateAppEvent(record.event);
  if (!record.id.trim()) throw new Error('APP_EVENT_OUTBOX_ID_REQUIRED');
  if (!record.eventId.trim()) throw new Error('APP_EVENT_OUTBOX_EVENT_ID_REQUIRED');
  if (record.eventId !== record.event.eventId) throw new Error('APP_EVENT_OUTBOX_EVENT_ID_MISMATCH');
  if (!record.idempotencyKey.trim()) throw new Error('APP_EVENT_OUTBOX_IDEMPOTENCY_KEY_REQUIRED');
  if (!Number.isSafeInteger(record.attempt) || record.attempt < 0) throw new Error('APP_EVENT_OUTBOX_ATTEMPT_INVALID');
  if (record.state === 'retry_wait' && !record.nextRetryAt) throw new Error('APP_EVENT_OUTBOX_RETRY_AT_REQUIRED');
  if (record.state !== 'retry_wait' && record.nextRetryAt) throw new Error('APP_EVENT_OUTBOX_RETRY_AT_FORBIDDEN');
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
  options: { nextRetryAt?: string; tgsOperationId?: string } = {},
): AppEventOutboxRecord {
  validateOutboxRecord(record);
  assertOutboxTransition(record.state, next);

  const transitioned: AppEventOutboxRecord = {
    ...record,
    state: next,
    attempt: next === 'sending' ? record.attempt + 1 : record.attempt,
    updatedAt: now,
  };

  delete transitioned.nextRetryAt;
  if (next === 'retry_wait') {
    if (!options.nextRetryAt) throw new Error('APP_EVENT_OUTBOX_RETRY_AT_REQUIRED');
    transitioned.nextRetryAt = options.nextRetryAt;
  }
  if (options.tgsOperationId) transitioned.tgsOperationId = options.tgsOperationId;

  return validateOutboxRecord(transitioned);
}
