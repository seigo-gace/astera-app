import type { D1Database, D1PreparedStatement } from './_account-projection';
import {
  validateOutboxRecord,
  validateRegisteredAppEvent,
  type AppEventEnvelope,
  type AppEventOutboxClaim,
  type AppEventOutboxRecord,
  type AppEventOutboxState,
} from '../packages/contracts/src/app-events';

type OutboxRow = {
  id: string;
  event_id: string;
  idempotency_key: string;
  event_json: string;
  state: AppEventOutboxState;
  attempt: number;
  next_retry_at: string | null;
  lease_expires_at: string | null;
  tgs_operation_id: string | null;
  created_at: string;
  updated_at: string;
};

function iso(value: string, code: string): string {
  const trimmed = value.trim();
  const parsed = Date.parse(trimmed);
  if (!trimmed || !Number.isFinite(parsed)) throw new Error(code);
  return new Date(parsed).toISOString();
}

function rowRecord(row: OutboxRow): AppEventOutboxRecord {
  let event: AppEventEnvelope;
  try {
    event = JSON.parse(row.event_json) as AppEventEnvelope;
  } catch {
    throw new Error('APP_EVENT_OUTBOX_EVENT_JSON_INVALID');
  }
  const record: AppEventOutboxRecord = {
    id: row.id,
    eventId: row.event_id,
    idempotencyKey: row.idempotency_key,
    event,
    state: row.state,
    attempt: Number(row.attempt),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (row.next_retry_at) record.nextRetryAt = row.next_retry_at;
  if (row.lease_expires_at) record.leaseExpiresAt = row.lease_expires_at;
  if (row.tgs_operation_id) record.tgsOperationId = row.tgs_operation_id;
  return validateOutboxRecord(record);
}

function firstResult<T>(result: { results?: T[] }): T | null {
  return result.results?.[0] ?? null;
}

function boundedLimit(value: number): number {
  return Number.isInteger(value) ? Math.min(200, Math.max(1, value)) : 50;
}

/**
 * Returns a prepared INSERT so the business mutation owner can include this exact
 * statement in the same D1 batch/transaction as its authoritative state change.
 * This function deliberately does not call run() itself.
 */
export function prepareAppEventOutboxEnqueue(
  db: D1Database,
  event: AppEventEnvelope,
  now: string,
): D1PreparedStatement {
  validateRegisteredAppEvent(event);
  const createdAt = iso(now, 'APP_EVENT_OUTBOX_CREATED_AT_INVALID');
  const id = `outbox:${event.eventId}`;
  const idempotencyKey = `app-event:${event.eventId}`;
  return db.prepare(
    `INSERT INTO app_event_outbox
      (id,event_id,idempotency_key,scope,domain,event_json,state,attempt,next_retry_at,lease_expires_at,tgs_operation_id,created_at,updated_at)
     VALUES (?1,?2,?3,?4,?5,?6,'pending',0,NULL,NULL,NULL,?7,?7)`,
  ).bind(id, event.eventId, idempotencyKey, event.scope, event.domain, JSON.stringify(event), createdAt);
}

export async function listReadyAppEventOutboxIds(
  db: D1Database,
  now: string,
  limitRaw = 50,
): Promise<string[]> {
  const at = iso(now, 'APP_EVENT_OUTBOX_CLAIM_TIME_INVALID');
  const result = await db.prepare(
    `SELECT id FROM app_event_outbox
     WHERE state='pending' OR (state='retry_wait' AND next_retry_at<=?1)
     ORDER BY created_at ASC,id ASC LIMIT ?2`,
  ).bind(at, boundedLimit(limitRaw)).all<{ id: string }>();
  return (result.results ?? []).map((row) => row.id).filter(Boolean);
}

export async function listExpiredSendingAppEventOutboxIds(
  db: D1Database,
  now: string,
  limitRaw = 50,
): Promise<string[]> {
  const at = iso(now, 'APP_EVENT_OUTBOX_CLAIM_TIME_INVALID');
  const result = await db.prepare(
    `SELECT id FROM app_event_outbox
     WHERE state='sending' AND lease_expires_at IS NOT NULL AND lease_expires_at<=?1
     ORDER BY lease_expires_at ASC,id ASC LIMIT ?2`,
  ).bind(at, boundedLimit(limitRaw)).all<{ id: string }>();
  return (result.results ?? []).map((row) => row.id).filter(Boolean);
}

/**
 * Atomically claims one pending/due row. UPDATE ... RETURNING is the fencing point:
 * only one competing sender can increment attempt for the same eligible row.
 */
export async function claimAppEventOutbox(
  db: D1Database,
  id: string,
  now: string,
  leaseExpiresAt: string,
): Promise<AppEventOutboxRecord | null> {
  const at = iso(now, 'APP_EVENT_OUTBOX_CLAIM_TIME_INVALID');
  const lease = iso(leaseExpiresAt, 'APP_EVENT_OUTBOX_LEASE_INVALID');
  if (Date.parse(lease) <= Date.parse(at)) throw new Error('APP_EVENT_OUTBOX_LEASE_INVALID');
  const result = await db.prepare(
    `UPDATE app_event_outbox
     SET state='sending',attempt=attempt+1,next_retry_at=NULL,lease_expires_at=?1,updated_at=?2
     WHERE id=?3
       AND updated_at<=?2
       AND (state='pending' OR (state='retry_wait' AND next_retry_at<=?2))
     RETURNING id,event_id,idempotency_key,event_json,state,attempt,next_retry_at,lease_expires_at,tgs_operation_id,created_at,updated_at`,
  ).bind(lease, at, id).all<OutboxRow>();
  const row = firstResult(result);
  return row ? rowRecord(row) : null;
}

export async function markAppEventOutboxDelivered(
  db: D1Database,
  claim: AppEventOutboxClaim,
  now: string,
  tgsOperationId?: string,
): Promise<AppEventOutboxRecord> {
  const at = iso(now, 'APP_EVENT_OUTBOX_CLAIM_TIME_INVALID');
  const result = await db.prepare(
    `UPDATE app_event_outbox
     SET state='delivered',lease_expires_at=NULL,next_retry_at=NULL,tgs_operation_id=COALESCE(?1,tgs_operation_id),updated_at=?2
     WHERE id=?3 AND event_id=?4 AND state='sending' AND attempt=?5
       AND updated_at<=?2 AND lease_expires_at=?6 AND lease_expires_at>?2
     RETURNING id,event_id,idempotency_key,event_json,state,attempt,next_retry_at,lease_expires_at,tgs_operation_id,created_at,updated_at`,
  ).bind(tgsOperationId ?? null, at, claim.id, claim.eventId, claim.attempt, claim.leaseExpiresAt).all<OutboxRow>();
  const row = firstResult(result);
  if (!row) throw new Error('APP_EVENT_OUTBOX_CLAIM_STALE_OR_EXPIRED');
  return rowRecord(row);
}

export async function scheduleAppEventOutboxRetry(
  db: D1Database,
  claim: AppEventOutboxClaim,
  now: string,
  nextRetryAt: string,
  tgsOperationId?: string,
): Promise<AppEventOutboxRecord> {
  const at = iso(now, 'APP_EVENT_OUTBOX_CLAIM_TIME_INVALID');
  const retryAt = iso(nextRetryAt, 'APP_EVENT_OUTBOX_RETRY_AT_INVALID');
  if (Date.parse(retryAt) <= Date.parse(at)) throw new Error('APP_EVENT_OUTBOX_RETRY_AT_INVALID');
  const result = await db.prepare(
    `UPDATE app_event_outbox
     SET state='retry_wait',next_retry_at=?1,lease_expires_at=NULL,tgs_operation_id=COALESCE(?2,tgs_operation_id),updated_at=?3
     WHERE id=?4 AND event_id=?5 AND state='sending' AND attempt=?6
       AND updated_at<=?3 AND lease_expires_at=?7 AND lease_expires_at>?3
     RETURNING id,event_id,idempotency_key,event_json,state,attempt,next_retry_at,lease_expires_at,tgs_operation_id,created_at,updated_at`,
  ).bind(retryAt, tgsOperationId ?? null, at, claim.id, claim.eventId, claim.attempt, claim.leaseExpiresAt).all<OutboxRow>();
  const row = firstResult(result);
  if (!row) throw new Error('APP_EVENT_OUTBOX_CLAIM_STALE_OR_EXPIRED');
  return rowRecord(row);
}

export async function recoverExpiredAppEventOutbox(
  db: D1Database,
  id: string,
  now: string,
  nextRetryAt: string,
): Promise<AppEventOutboxRecord | null> {
  const at = iso(now, 'APP_EVENT_OUTBOX_CLAIM_TIME_INVALID');
  const retryAt = iso(nextRetryAt, 'APP_EVENT_OUTBOX_RETRY_AT_INVALID');
  if (Date.parse(retryAt) <= Date.parse(at)) throw new Error('APP_EVENT_OUTBOX_RETRY_AT_INVALID');
  const result = await db.prepare(
    `UPDATE app_event_outbox
     SET state='retry_wait',next_retry_at=?1,lease_expires_at=NULL,updated_at=?2
     WHERE id=?3 AND state='sending' AND updated_at<=?2
       AND lease_expires_at IS NOT NULL AND lease_expires_at<=?2
     RETURNING id,event_id,idempotency_key,event_json,state,attempt,next_retry_at,lease_expires_at,tgs_operation_id,created_at,updated_at`,
  ).bind(retryAt, at, id).all<OutboxRow>();
  const row = firstResult(result);
  return row ? rowRecord(row) : null;
}
