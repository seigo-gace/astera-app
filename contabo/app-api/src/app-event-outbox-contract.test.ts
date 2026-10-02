import assert from 'node:assert/strict';
import test from 'node:test';
import { transitionOutbox, validateOutboxRecord, type AppEventOutboxRecord } from './app-event-outbox-contract.js';

function record(state: AppEventOutboxRecord['state'] = 'pending'): AppEventOutboxRecord {
  return {
    id: 'outbox-1',
    eventId: 'evt-1',
    idempotencyKey: 'event:evt-1',
    event: {
      schema: 'astera.app.event.v1',
      eventId: 'evt-1',
      occurredAt: '2026-10-02T09:20:00Z',
      scope: 'user',
      domain: 'file',
      event: 'FILE_STORED',
      severity: 'info',
      correlationId: 'corr-1',
      source: 'app-api',
      refs: { userRef: 'opaque-user-1', fileId: 'file-1' },
    },
    state,
    attempt: 0,
    createdAt: '2026-10-02T09:20:00Z',
    updatedAt: '2026-10-02T09:20:00Z',
  };
}

test('pending -> sending increments attempt and preserves stable idempotency identity', () => {
  const next = transitionOutbox(record(), 'sending', '2026-10-02T09:21:00Z');
  assert.equal(next.state, 'sending');
  assert.equal(next.attempt, 1);
  assert.equal(next.idempotencyKey, 'event:evt-1');
});

test('sending -> retry_wait requires retry time and can retain TGserver operation identity', () => {
  const sending = transitionOutbox(record(), 'sending', '2026-10-02T09:21:00Z');
  const retry = transitionOutbox(sending, 'retry_wait', '2026-10-02T09:21:30Z', {
    nextRetryAt: '2026-10-02T09:22:30Z',
    tgsOperationId: 'op-1',
  });
  assert.equal(retry.state, 'retry_wait');
  assert.equal(retry.nextRetryAt, '2026-10-02T09:22:30Z');
  assert.equal(retry.tgsOperationId, 'op-1');
  assert.equal(retry.attempt, 1);
});

test('retry_wait -> sending clears retry timestamp and increments attempt', () => {
  const retry = record('retry_wait');
  retry.nextRetryAt = '2026-10-02T09:22:30Z';
  retry.attempt = 1;
  const sending = transitionOutbox(retry, 'sending', '2026-10-02T09:22:30Z');
  assert.equal(sending.state, 'sending');
  assert.equal(sending.nextRetryAt, undefined);
  assert.equal(sending.attempt, 2);
});

test('delivered and dead_letter are terminal', () => {
  const delivered = record('delivered');
  assert.throws(() => transitionOutbox(delivered, 'sending', '2026-10-02T09:30:00Z'), /TRANSITION_FORBIDDEN/);
  const dead = record('dead_letter');
  assert.throws(() => transitionOutbox(dead, 'sending', '2026-10-02T09:30:00Z'), /TRANSITION_FORBIDDEN/);
});

test('outbox event identity must match embedded event identity', () => {
  const invalid = record();
  invalid.eventId = 'different';
  assert.throws(() => validateOutboxRecord(invalid), /EVENT_ID_MISMATCH/);
});
