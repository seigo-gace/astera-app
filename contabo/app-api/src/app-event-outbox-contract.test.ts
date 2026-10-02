import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertActiveOutboxClaim,
  isSendingLeaseExpired,
  outboxClaim,
  recoverExpiredSendingOutbox,
  transitionOutbox,
  validateOutboxRecord,
  type AppEventOutboxRecord,
} from './app-event-outbox-contract.js';

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
      event: 'FILE_UPLOAD_READY',
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

function sendingRecord(): AppEventOutboxRecord {
  return transitionOutbox(record(), 'sending', '2026-10-02T09:21:00Z', {
    leaseExpiresAt: '2026-10-02T09:22:00Z',
  });
}

test('pending -> sending requires a bounded lease and increments the fencing attempt', () => {
  assert.throws(
    () => transitionOutbox(record(), 'sending', '2026-10-02T09:21:00Z'),
    /LEASE_REQUIRED/,
  );
  const next = sendingRecord();
  assert.equal(next.state, 'sending');
  assert.equal(next.attempt, 1);
  assert.equal(next.leaseExpiresAt, '2026-10-02T09:22:00Z');
  assert.equal(next.idempotencyKey, 'event:evt-1');
});

test('sending -> retry_wait clears lease, requires future retry time and retains TGserver operation identity', () => {
  const sending = sendingRecord();
  const retry = transitionOutbox(sending, 'retry_wait', '2026-10-02T09:21:30Z', {
    nextRetryAt: '2026-10-02T09:22:30Z',
    tgsOperationId: 'op-1',
  });
  assert.equal(retry.state, 'retry_wait');
  assert.equal(retry.nextRetryAt, '2026-10-02T09:22:30Z');
  assert.equal(retry.leaseExpiresAt, undefined);
  assert.equal(retry.tgsOperationId, 'op-1');
  assert.equal(retry.attempt, 1);
});

test('retry_wait -> sending clears retry timestamp, installs a fresh lease and increments attempt', () => {
  const retry = record('retry_wait');
  retry.nextRetryAt = '2026-10-02T09:22:30Z';
  retry.attempt = 1;
  const sending = transitionOutbox(retry, 'sending', '2026-10-02T09:22:30Z', {
    leaseExpiresAt: '2026-10-02T09:23:30Z',
  });
  assert.equal(sending.state, 'sending');
  assert.equal(sending.nextRetryAt, undefined);
  assert.equal(sending.leaseExpiresAt, '2026-10-02T09:23:30Z');
  assert.equal(sending.attempt, 2);
});

test('expired sending lease can be recovered to retry_wait after process restart', () => {
  const sending = sendingRecord();
  assert.equal(isSendingLeaseExpired(sending, '2026-10-02T09:21:59Z'), false);
  assert.equal(isSendingLeaseExpired(sending, '2026-10-02T09:22:00Z'), true);
  assert.throws(
    () => recoverExpiredSendingOutbox(sending, '2026-10-02T09:21:59Z', '2026-10-02T09:23:00Z'),
    /LEASE_NOT_EXPIRED/,
  );
  const recovered = recoverExpiredSendingOutbox(sending, '2026-10-02T09:22:00Z', '2026-10-02T09:23:00Z');
  assert.equal(recovered.state, 'retry_wait');
  assert.equal(recovered.attempt, 1);
  assert.equal(recovered.leaseExpiresAt, undefined);
  assert.equal(recovered.nextRetryAt, '2026-10-02T09:23:00Z');
});

test('claim token fences stale sender completion and rejects an expired claim', () => {
  const firstSending = sendingRecord();
  const firstClaim = outboxClaim(firstSending);
  assert.doesNotThrow(() => assertActiveOutboxClaim(firstSending, firstClaim, '2026-10-02T09:21:59Z'));
  assert.throws(
    () => assertActiveOutboxClaim(firstSending, firstClaim, '2026-10-02T09:22:00Z'),
    /CLAIM_EXPIRED/,
  );

  const recovered = recoverExpiredSendingOutbox(firstSending, '2026-10-02T09:22:00Z', '2026-10-02T09:23:00Z');
  const secondSending = transitionOutbox(recovered, 'sending', '2026-10-02T09:23:00Z', {
    leaseExpiresAt: '2026-10-02T09:24:00Z',
  });
  assert.equal(secondSending.attempt, 2);
  assert.throws(
    () => assertActiveOutboxClaim(secondSending, firstClaim, '2026-10-02T09:23:30Z'),
    /CLAIM_STALE/,
  );
});

test('invalid lease and retry timestamps fail closed', () => {
  const pending = record();
  assert.throws(
    () => transitionOutbox(pending, 'sending', '2026-10-02T09:21:00Z', { leaseExpiresAt: '2026-10-02T09:21:00Z' }),
    /LEASE_INVALID/,
  );
  const sending = sendingRecord();
  assert.throws(
    () => transitionOutbox(sending, 'retry_wait', '2026-10-02T09:21:30Z', { nextRetryAt: '2026-10-02T09:21:30Z' }),
    /RETRY_AT_INVALID/,
  );
});

test('delivered and dead_letter are terminal', () => {
  const delivered = record('delivered');
  assert.throws(() => transitionOutbox(delivered, 'sending', '2026-10-02T09:30:00Z', { leaseExpiresAt: '2026-10-02T09:31:00Z' }), /TRANSITION_FORBIDDEN/);
  const dead = record('dead_letter');
  assert.throws(() => transitionOutbox(dead, 'sending', '2026-10-02T09:30:00Z', { leaseExpiresAt: '2026-10-02T09:31:00Z' }), /TRANSITION_FORBIDDEN/);
});

test('outbox event identity must match embedded event identity', () => {
  const invalid = record();
  invalid.eventId = 'different';
  assert.throws(() => validateOutboxRecord(invalid), /EVENT_ID_MISMATCH/);
});

test('outbox rejects event names outside the closed registry', () => {
  const invalid = record();
  invalid.event.event = 'FILE_STORED';
  assert.throws(() => validateOutboxRecord(invalid), /APP_EVENT_NOT_REGISTERED:FILE_STORED/);
});

test('outbox rejects unknown runtime states instead of trusting TypeScript casts', () => {
  const invalid = record() as AppEventOutboxRecord & { state: string };
  invalid.state = 'teleported';
  assert.throws(() => validateOutboxRecord(invalid as AppEventOutboxRecord), /OUTBOX_STATE_INVALID/);
});

test('TGserver operation identity rejects control characters and oversized values', () => {
  const invalidControl = record('delivered');
  invalidControl.tgsOperationId = 'op\nsecret';
  assert.throws(() => validateOutboxRecord(invalidControl), /OUTBOX_TGS_OPERATION_ID_INVALID/);

  const invalidLong = record('delivered');
  invalidLong.tgsOperationId = `op-${'x'.repeat(600)}`;
  assert.throws(() => validateOutboxRecord(invalidLong), /OUTBOX_TGS_OPERATION_ID_INVALID/);
});
