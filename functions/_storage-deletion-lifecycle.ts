import type { D1Database } from './_account-projection';
import {
  getObject,
  StorageStoreError,
  type StorageActor,
  type StorageObjectRow,
} from './_storage-store';

export const STORAGE_UNDO_WINDOW_MS = 10 * 60 * 1000;
export const STORAGE_DELETION_LEASE_MS = 2 * 60 * 1000;
export const STORAGE_PRIMARY_DELETE_MAX_MS = 24 * 60 * 60 * 1000;
export const STORAGE_DELETION_BATCH_LIMIT = 25;

export type StorageDeletionCandidate = StorageObjectRow & {
  lease_at: string;
};

export type StorageDeletionReceipt = {
  id: string;
  object_id: string;
  tenant_id: string;
  user_id: string;
  topic_id: string;
  message_id: string;
  reason: string;
  deleted_at: string;
};

function changes(result: { meta?: Record<string, unknown> }): number {
  return Number(result.meta?.changes ?? 0);
}

function safeDate(value: string | null, code: string): number {
  const epoch = Date.parse(value ?? '');
  if (!Number.isFinite(epoch)) {
    throw new StorageStoreError(500, code, 'Storage deletion timestamp is invalid.');
  }
  return epoch;
}

export function storageUndoExpiresAt(deletedAt: string): string {
  return new Date(safeDate(deletedAt, 'ASTERA_STORAGE_DELETED_AT_INVALID') + STORAGE_UNDO_WINDOW_MS).toISOString();
}

export function isStorageUndoAvailable(deletedAt: string | null, now = Date.now()): boolean {
  if (!deletedAt) return false;
  const deleted = Date.parse(deletedAt);
  return Number.isFinite(deleted) && now < deleted + STORAGE_UNDO_WINDOW_MS;
}

export function primaryDeletionReceiptId(objectId: string): string {
  return `storage-primary-delete:${objectId}`;
}

export async function undoDeleteWithinWindow(
  db: D1Database,
  actor: StorageActor,
  id: string,
  now = new Date(),
) {
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) {
    throw new StorageStoreError(500, 'ASTERA_STORAGE_CLOCK_INVALID', 'Storage lifecycle clock is invalid.');
  }
  const restoredAt = now.toISOString();
  const cutoff = new Date(nowMs - STORAGE_UNDO_WINDOW_MS).toISOString();
  const result = await db.prepare(`
    UPDATE astera_storage_objects
       SET status = CASE WHEN error_code IS NOT NULL THEN 'corrupt' ELSE 'stored' END,
           deleted_at = NULL,
           restored_at = ?1,
           updated_at = ?1
     WHERE id = ?2
       AND tenant_id = ?3
       AND user_id = ?4
       AND status = 'soft_deleted'
       AND deleted_at IS NOT NULL
       AND deleted_at > ?5
  `).bind(restoredAt, id, actor.tenantId, actor.userId, cutoff).run();

  if (changes(result) === 1) return getObject(db, actor, id);

  const current = await getObject(db, actor, id);
  if (current.object.status !== 'soft_deleted') {
    throw new StorageStoreError(404, 'ASTERA_STORAGE_OBJECT_NOT_RESTORABLE', 'Storage object is not restorable.');
  }
  if (!isStorageUndoAvailable(current.object.deleted_at, nowMs)) {
    throw new StorageStoreError(409, 'ASTERA_STORAGE_UNDO_WINDOW_EXPIRED', 'Storage object undo window has expired.', {
      undo_expires_at: current.object.deleted_at ? storageUndoExpiresAt(current.object.deleted_at) : null,
    });
  }
  throw new StorageStoreError(409, 'ASTERA_STORAGE_UNDO_CONFLICT', 'Storage object could not be restored because its lifecycle state changed.');
}

export async function claimExpiredStorageDeletions(
  db: D1Database,
  now = new Date(),
  requestedLimit = STORAGE_DELETION_BATCH_LIMIT,
): Promise<StorageDeletionCandidate[]> {
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) {
    throw new StorageStoreError(500, 'ASTERA_STORAGE_CLOCK_INVALID', 'Storage lifecycle clock is invalid.');
  }
  const limit = Math.max(1, Math.min(100, Math.trunc(requestedLimit)));
  const undoCutoff = new Date(nowMs - STORAGE_UNDO_WINDOW_MS).toISOString();
  const staleLeaseCutoff = new Date(nowMs - STORAGE_DELETION_LEASE_MS).toISOString();
  const leaseAt = now.toISOString();
  const rows = (await db.prepare(`
    SELECT *
      FROM astera_storage_objects
     WHERE (
       status = 'soft_deleted'
       AND deleted_at IS NOT NULL
       AND deleted_at <= ?1
     ) OR (
       status = 'deleting'
       AND updated_at <= ?2
     )
     ORDER BY COALESCE(deleted_at, updated_at) ASC
     LIMIT ?3
  `).bind(undoCutoff, staleLeaseCutoff, limit).all<StorageObjectRow>()).results ?? [];

  const claimed: StorageDeletionCandidate[] = [];
  for (const row of rows) {
    let result;
    if (row.status === 'soft_deleted') {
      result = await db.prepare(`
        UPDATE astera_storage_objects
           SET status = 'deleting', updated_at = ?1
         WHERE id = ?2
           AND status = 'soft_deleted'
           AND deleted_at IS NOT NULL
           AND deleted_at <= ?3
      `).bind(leaseAt, row.id, undoCutoff).run();
    } else if (row.status === 'deleting') {
      result = await db.prepare(`
        UPDATE astera_storage_objects
           SET updated_at = ?1
         WHERE id = ?2
           AND status = 'deleting'
           AND updated_at = ?3
           AND updated_at <= ?4
      `).bind(leaseAt, row.id, row.updated_at, staleLeaseCutoff).run();
    } else {
      continue;
    }
    if (changes(result) === 1) {
      claimed.push({ ...row, status: 'deleting', updated_at: leaseAt, lease_at: leaseAt });
    }
  }
  return claimed;
}

export async function releaseStorageDeletionClaim(
  db: D1Database,
  candidate: StorageDeletionCandidate,
  errorCode: string,
  now = new Date(),
): Promise<boolean> {
  const result = await db.prepare(`
    UPDATE astera_storage_objects
       SET status = 'soft_deleted', error_code = ?1, updated_at = ?2
     WHERE id = ?3
       AND status = 'deleting'
       AND updated_at = ?4
  `).bind(errorCode.slice(0, 160), now.toISOString(), candidate.id, candidate.lease_at).run();
  return changes(result) === 1;
}

export async function readPrimaryDeletionReceipt(
  db: D1Database,
  objectId: string,
): Promise<StorageDeletionReceipt | null> {
  return db.prepare(`
    SELECT id, object_id, tenant_id, user_id, topic_id, message_id, reason, deleted_at
      FROM astera_storage_deletion_receipts
     WHERE id = ?1
     LIMIT 1
  `).bind(primaryDeletionReceiptId(objectId)).first<StorageDeletionReceipt>();
}

export async function recordPrimaryDeletionReceipt(
  db: D1Database,
  candidate: StorageDeletionCandidate,
  now = new Date(),
): Promise<StorageDeletionReceipt> {
  if (!candidate.topic_id || !candidate.message_id) {
    throw new StorageStoreError(500, 'ASTERA_STORAGE_PRIMARY_DELETE_REF_MISSING', 'Storage primary deletion references are missing.');
  }
  const id = primaryDeletionReceiptId(candidate.id);
  const deletedAt = now.toISOString();
  await db.prepare(`
    INSERT OR IGNORE INTO astera_storage_deletion_receipts(
      id, object_id, tenant_id, user_id, topic_id, message_id, reason, deleted_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'primary_purge_completed', ?7)
  `).bind(
    id,
    candidate.id,
    candidate.tenant_id,
    candidate.user_id,
    candidate.topic_id,
    candidate.message_id,
    deletedAt,
  ).run();
  const receipt = await readPrimaryDeletionReceipt(db, candidate.id);
  if (!receipt) {
    throw new StorageStoreError(500, 'ASTERA_STORAGE_DELETE_RECEIPT_FAILED', 'Storage primary deletion receipt could not be persisted.');
  }
  return receipt;
}

export async function completeStoragePrimaryDeletion(
  db: D1Database,
  candidate: StorageDeletionCandidate,
  receipt: StorageDeletionReceipt,
  now = new Date(),
): Promise<boolean> {
  const result = await db.prepare(`
    UPDATE astera_storage_objects
       SET status = 'deleted',
           primary_deleted_at = ?1,
           error_code = NULL,
           topic_id = NULL,
           message_id = NULL,
           telegram_file_id = NULL,
           checksum_verified_at = NULL,
           encryption_profile = NULL,
           dek_wrap_ciphertext = NULL,
           dek_wrap_iv = NULL,
           content_iv_base64 = NULL,
           auth_tag_base64 = NULL,
           encrypted_at = NULL,
           updated_at = ?2
     WHERE id = ?3
       AND status = 'deleting'
       AND updated_at = ?4
  `).bind(receipt.deleted_at, now.toISOString(), candidate.id, candidate.lease_at).run();
  if (changes(result) === 1) return true;

  const row = await db.prepare(`SELECT status, primary_deleted_at FROM astera_storage_objects WHERE id = ?1 LIMIT 1`)
    .bind(candidate.id)
    .first<{ status: string; primary_deleted_at: string | null }>();
  if (row?.status === 'deleted' && row.primary_deleted_at) return true;
  throw new StorageStoreError(409, 'ASTERA_STORAGE_DELETE_LEASE_LOST', 'Storage deletion lease was lost before finalization.');
}

export function storagePrimaryDeletionAgeMs(candidate: StorageDeletionCandidate, now = Date.now()): number {
  return Math.max(0, now - safeDate(candidate.deleted_at, 'ASTERA_STORAGE_DELETED_AT_INVALID'));
}
