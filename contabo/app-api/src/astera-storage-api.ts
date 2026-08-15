import type { Hono } from 'hono';
import type { Pool } from 'pg';
import { createReadStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { constantTimeTokenEqual, type RuntimeConfig } from './config.js';
import { assertProjectAccess } from './workspace-api.js';
import { TgserverStorageClient, TgserverStorageError } from './tgserver-storage-client.js';
import { VaultClient } from './vault-client.js';
import {
  createStorageEncryptedUpload,
  decryptStorageObjectToFile,
  StorageObjectCryptoError,
  type StorageVaultLike,
} from './storage-object-crypto.js';

const MAX_FILE_BYTES = 4 * 1024 * 1024 * 1024;
const STORAGE_STATES = new Set(['active', 'save_suspended', 'grace_period', 'ending']);
const INTEGRITY_ERROR_CODES = new Set([
  'STORAGE_GCM_AUTH_FAILED',
  'STORAGE_SHA256_MISMATCH',
  'STORAGE_PLAINTEXT_SIZE_MISMATCH',
  'STORAGE_WRAPPED_DEK_BINDING_MISMATCH',
  'STORAGE_WRAPPED_DEK_INVALID',
  'STORAGE_CONTENT_IV_INVALID',
  'STORAGE_AUTH_TAG_INVALID',
]);

type StorageActor = { userId: string; tenantId: string };
type StorageObjectRow = {
  id: string; tenant_id: string; user_id: string; project_id: string | null; folder_id: string | null;
  topic_id: string | number | null; message_id: string | number | null; file_name: string; mime_type: string;
  file_size: string | number; checksum_sha256: string | null; checksum_verified_at: Date | null;
  encryption_profile: string | null; dek_wrap_ciphertext: string | null; dek_wrap_iv: string | null;
  content_iv_base64: string | null; auth_tag_base64: string | null; encrypted_at: Date | null;
  retention_policy: string | null; source_result_id: string | null;
  version: number; contract_capacity_bytes_snapshot: string | number; status: string; error_code: string | null;
  deleted_at: Date | null; restored_at: Date | null; primary_deleted_at: Date | null; created_at: Date; updated_at: Date;
};

class StorageApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message); this.name = 'StorageApiError';
  }
}

function actorFromHeaders(headers: Headers): StorageActor {
  if (headers.get('x-astera-internal-authenticated') !== '1') throw new StorageApiError(401, 'TRUSTED_ACTOR_CONTEXT_REQUIRED', 'Trusted actor is required.');
  const userId = headers.get('x-astera-user-id')?.trim() || '';
  const tenantId = headers.get('x-astera-tenant-id')?.trim() || '';
  const status = headers.get('x-astera-account-status')?.trim() || '';
  if (!userId || !tenantId || status !== 'active') throw new StorageApiError(403, 'TRUSTED_ACTOR_CONTEXT_INVALID', 'Actor is invalid.');
  return { userId, tenantId };
}

function correlationId(headers: Headers): string {
  return headers.get('x-correlation-id')?.trim() || headers.get('x-request-id')?.trim() || crypto.randomUUID();
}

function responseError(error: unknown, requestId: string): Response {
  const normalized = error instanceof StorageApiError ? error
    : error instanceof TgserverStorageError ? new StorageApiError(error.status, error.code, error.code)
      : error instanceof StorageObjectCryptoError ? new StorageApiError(500, error.code, 'Storage cryptographic operation failed.')
        : new StorageApiError(500, 'ASTERA_STORAGE_FAILED', 'Astera Storage operation failed.');
  return Response.json({ error: { code: normalized.code, message: normalized.message, correlation_id: requestId, retryable: normalized.status >= 500 } }, {"status":normalized.status,"headers":{"cache-control":"no-store","x-correlation-id":requestId}});
}

function storageCapacity(headers: Headers, write = false): number {
  if (headers.get('x-astera-storage-entitled') !== '1') throw new StorageApiError(403, 'ASTERA_STORAGE_ENTITLEMENT_REQUIRED', 'Astera Storage contract is required.');
  const value = Number(headers.get('x-astera-storage-capacity-bytes'));
  if (!Number.isSafeInteger(value) || value <= 0) throw new StorageApiError(403, 'ASTERA_STORAGE_CAPACITY_REQUIRED', 'Astera Storage capacity is not active.');
  const state = headers.get('x-astera-storage-state')?.trim() || '';
  if (!STORAGE_STATES.has(state)) throw new StorageApiError(403, 'ASTERA_STORAGE_STATE_INVALID', 'Astera Storage state is invalid.');
  const writeAllowed = headers.get('x-astera-storage-write-allowed') === '1';
  if (write && (state !== 'active' || !writeAllowed)) {
    throw new StorageApiError(409, 'ASTERA_STORAGE_SAVE_SUSPENDED', 'Astera Storage is read-only for the current contract state.');
  }
  return value;
}

function safeName(raw: string): string {
  let decoded = raw;
  try { decoded = decodeURIComponent(raw); } catch { /* use raw */ }
  const value = decoded.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim().slice(0, 240);
  if (!value) throw new StorageApiError(422, 'STORAGE_FILE_NAME_INVALID', 'File name is invalid.');
  return value;
}

function optionalUuid(value: string | undefined, code: string): string | null {
  const normalized = value?.trim() || '';
  if (!normalized) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)) throw new StorageApiError(422, code, code);
  return normalized;
}

function checksum(value: string | undefined): string | null {
  const normalized = value?.trim().toLowerCase() || '';
  if (!normalized) return null;
  if (!/^[0-9a-f]{64}$/.test(normalized)) throw new StorageApiError(422, 'STORAGE_SHA256_INVALID', 'SHA-256 is invalid.');
  return normalized;
}

function objectPayload(row: StorageObjectRow): Record<string, unknown> {
  return {
    object_id: row.id, file_id: row.id, project_id: row.project_id, folder_id: row.folder_id,
    file_name: row.file_name, mime_type: row.mime_type, file_size: Number(row.file_size), hash: row.checksum_sha256,
    checksum_verified_at: row.checksum_verified_at?.toISOString() ?? null,
    encryption_profile: row.encryption_profile, retention_policy: row.retention_policy, source_result_id: row.source_result_id,
    version: row.version, status: row.status, error_code: row.error_code,
    created_at: row.created_at.toISOString(), updated_at: row.updated_at.toISOString(), deleted_at: row.deleted_at?.toISOString() ?? null,
  };
}

async function ownedObject(pool: Pool, actor: StorageActor, objectId: string): Promise<StorageObjectRow> {
  const result = await pool.query<StorageObjectRow>(
    `SELECT * FROM astera_storage_objects WHERE id=$1 AND tenant_id=$2 AND user_id=$3 LIMIT 1`,
    [objectId, actor.tenantId, actor.userId],
  );
  const row = result.rows[0];
  if (!row) throw new StorageApiError(404, 'ASTERA_STORAGE_OBJECT_NOT_FOUND', 'Storage object not found.');
  return row;
}

async function validateSourceResult(pool: Pool, actor: StorageActor, sourceResultId: string | null): Promise<void> {
  if (!sourceResultId) return;
  const result = await pool.query<{ project_id: string | null; created_by_user_id: string | null; private_mode: boolean }>(
    `SELECT project_id, created_by_user_id, private_mode FROM results WHERE id=$1 AND tenant_id=$2 LIMIT 1`,
    [sourceResultId, actor.tenantId],
  );
  const row = result.rows[0];
  if (!row || row.private_mode) throw new StorageApiError(404, 'STORAGE_SOURCE_RESTT_NOT_FOUND', 'Source Result is unavailable.');
  if (row.project_id) await assertProjectAccess(pool, actor.tenantId, actor.userId, row.project_id, 'viewer');
  else if (row.created_by_user_id && row.created_by_user_id !== actor.userId) throw new StorageApiError(404, 'STORAGE_SOURCE_RESTT_NOT_FOUND', 'Source Result is unavailable.');
}

function internalAuthorized(headers: Headers, config: RuntimeConfig): boolean {
  const auth = headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  return Boolean(token && constantTimeTokenEqual(token, config.internalServiceToken));
}

function requireEncryptionMetadata(row: StorageObjectRow): void {
  if (row.encryption_profile !== 'AES-256-GCM' || !row.dek_wrap_ciphertext || !row.dek_wrap_iv || !row.content_iv_base64 || !row.auth_tag_base64 || !row.checksum_sha256) {
    throw new StorageApiError(409, 'ASTERA_STORAGE_ENCRYPTION_METADATA_REQUIRED', 'Storage encryption metadata is incomplete.');
  }
}

export function registerAsteraStorageApi(
  app: Hono,
  pool: Pool,
  config: RuntimeConfig,
  tgs = new TgserverStorageClient(config),
  vault: StorageVaultLike = new VaultClient(config),
): void {
  app.get('/api/storage/usage', async (context) => {
    const requestId = correlationId(context.req.raw.headers);
    try {
      const actor = actorFromHeaders(context.req.raw.headers);
      const capacityBytes = storageCapacity(context.req.raw.headers);
      const result = await pool.query<{ used: string; reserved: string; pending_deletion: string }>(
        `SELECT
           COALESCE(SUM(CASE WHEN status='stored' THEN file_size ELSE 0 END),0)::text AS used,
           COALESCE(SUM(CASE WHEN status='pending' THEN file_size ELSE 0 END),0)::text AS reserved,
           COALESCE(SUM(CASE WHEN status IN ('soft_deleted','deleting') THEN file_size ELSE 0 END),0)::text AS pending_deletion
         FROM astera_storage_objects WHERE tenant_id=$1 AND user_id=$2`,
        [actor.tenantId, actor.userId],
      );
      const usedBytes = Number(result.rows[0]?.used || 0);
      const reservedBytes = Number(result.rows[0]?.reserved || 0);
      const pendingDeletionBytes = Number(result.rows[0]?.pending_deletion || 0);
      const occupiedBytes = usedBytes + reservedBytes + pendingDeletionBytes;
      if (![usedBytes, reservedBytes, pendingDeletionBytes, occupiedBytes].every(Number.isSafeInteger)) {
        throw new StorageApiError(500, 'ASTERA_STORAGE_USAGE_OVERFLOW', 'Storage usage cannot be represented safely.');
      }
      return context.json({
        capacity_bytes: capacityBytes,
        used_bytes: usedBytes,
        reserved_bytes: reservedBytes,
        pending_deletion_bytes: pendingDeletionBytes,
        remaining_bytes: Math.max(0, capacityBytes - occupiedBytes),
        state: context.req.header('x-astera-storage-state'),
        write_allowed: context.req.header('x-astera-storage-write-allowed') === '1',
      }, 200, { 'cache-control': 'no-store', 'x-correlation-id': requestId });
    } catch (error) { return responseError(error, requestId); }
  });

  app.get('/api/storage/objects', async (context) => {
    const requestId = correlationId(context.req.raw.headers);
    try {
      const actor = actorFromHeaders(context.req.raw.headers); storageCapacity(context.req.raw.headers);
      const includeDeleted = context.req.query('include_deleted') === '1';
      const projectId = optionalUuid(context.req.query('project_id'), 'STORAGE_PROJECT_ID_INVALID');
      if (projectId) await assertProjectAccess(pool, actor.tenantId, actor.userId, projectId, 'viewer');
      const result = await pool.query<StorageObjectRow>(
        `SELECT * FROM astera_storage_objects
         WHERE tenant_id=$1 AND user_id=$2 AND ($3::uuid IS NULL OR project_id=$3)
           AND ($4::boolean OR status NOT IN ('soft_deleted','deleted'))
         ORDER BY created_at DESC LIMIT 200`,
        [actor.tenantId, actor.userId, projectId, includeDeleted],
      );
      return context.json({ objects: result.rows.map(objectPayload) }, 200, { 'cache-control': 'no-store', 'x-correlation-id': requestId });
    } catch (error) { return responseError(error, requestId); }
  });

  app.post('/api/storage/objects', async (context) => {
    const requestId = correlationId(context.req.raw.headers);
    let objectId = '';
    let storedRef: { topic_id: number; message_id: number } | null = null;
    let encryptionCompletion: Promise<{ plaintextSha256: string; authTagBase64: string }> | null = null;
    let encryptedStream: ReadableStream<Uint8Array> | null = null;
    try {
      const actor = actorFromHeaders(context.req.raw.headers);
      const capacityBytes = storageCapacity(context.req.raw.headers, true);
      if (context.req.header('x-astera-private-mode') === '1') throw new StorageApiError(409, 'PRIVATE_MODE_STORAGE_FORBIDDEN', 'Private Mode cannot use Astera Storage.');
      if (!tgs.configured) throw new StorageApiError(503, 'TGS_STORAGE_NOT_CONFIGURED', 'TGserver Storage is not configured.');
      const fileSize = Number(context.req.header('x-astera-file-size') || context.req.header('content-length'));
      if (!Number.isSafeInteger(fileSize) || fileSize < 0) throw new StorageApiError(422, 'STORAGE_FILE_SIZE_INVALID', 'File size is invalid.');
      if (fileSize > MAX_FILE_BYTES) throw new StorageApiError(413, 'STORAGE_FILE_TOO_LARGE', 'File exceeds 4 GiB.');
      const body = context.req.raw.body;
      if (!body) throw new StorageApiError(422, 'STORAGE_FILE_BODY_REQUIRED', 'File body is required.');
      const fileName = safeName(context.req.header('x-astera-file-name') || '');
      const mimeType = (context.req.header('x-astera-mime-type') || context.req.header('content-type') || 'application/octet-stream').split(';')[0].trim().slice(0, 160);
      const projectId = optionalUuid(context.req.header('x-astera-project-id'), 'STORAGE_PROJECT_ID_INVALID');
      const sourceResultId = optionalUuid(context.req.header('x-astera-source-result-id'), 'STORAGE_SOURCE_RESULT_ID_INVALID');
      const folderId = (context.req.header('x-astera-folder-id') || '').trim().slice(0, 160) || null;
      const expectedSha256 = checksum(context.req.header('x-astera-sha256'));
      if (projectId) await assertProjectAccess(pool, actor.tenantId, actor.userId, projectId, 'editor');
      await validateSourceResult(pool, actor, sourceResultId);
      objectId = crypto.randomUUID();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`astera-storage:${actor.tenantId}`]);
        const usage = await client.query<{ used: string }>(
          `SELECT COALESCE(SUM(file_size),0)::text AS used FROM astera_storage_objects
           WHERE tenant_id=$1 AND status IN ('pending','stored','soft_deleted','deleting')`,
          [actor.tenantId],
        );
        const used = Number(usage.rows[0]?.used || 0);
        if (!Number.isSafeInteger(used) || used + fileSize > capacityBytes) throw new StorageApiError(409, 'ASTERA_STORAGE_QUOTA_EXCEEDED', 'Storage quota exceeded.');
        await client.query(
          `INSERT INTO astera_storage_objects
           (id,tenant_id,user_id,project_id,folder_id,file_name,mime_type,file_size,source_result_id,contract_capacity_bytes_snapshot,status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending')`,
          [objectId, actor.tenantId, actor.userId, projectId, folderId, fileName, mimeType, fileSize, sourceResultId, capacityBytes],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined); throw error;
      } finally { client.release(); }

      const encrypted = await createStorageEncryptedUpload(objectId, body, vault);
      encryptionCompletion = encrypted.completion;
      encryptedStream = encrypted.stream;
      await pool.query(
        `UPDATE astera_storage_objects
         SET encryption_profile=$1,dek_wrap_ciphertext=$2,dek_wrap_iv=$3,content_iv_base64=$4,encrypted_at=NOW(),updated_at=NOW()
         WHERE id=$5 AND tenant_id=$6 AND user_id=$7 AND status='pending'`,
        [encrypted.metadata.encryptionProfile, encrypted.metadata.wrappedDek.ciphertext, encrypted.metadata.wrappedDek.iv,
          encrypted.metadata.contentIvBase64, objectId, actor.tenantId, actor.userId],
      );
      const stored = await tgs.upload({ objectId, userId: actor.userId, fileName, fileSize, body: encrypted.stream, signal: context.req.raw.signal });
      encryptedStream = null;
      storedRef = { topic_id: stored.topic_id, message_id: stored.message_id };
      const cryptoResult = await encrypted.completion;
      encryptionCompletion = null;
      if (expectedSha256 && expectedSha256 !== cryptoResult.plaintextSha256) {
        await tgs.delete({ userId: actor.userId, topicId: stored.topic_id, messageId: stored.message_id }).catch(() => undefined);
        storedRef = null;
        throw new StorageApiError(422, 'STORAGE_SHA256_MISMATCH', 'Uploaded SHA-256 does not match the declared checksum.');
      }
      const updated = await pool.query<StorageObjectRow>(
        `UPDATE astera_storage_objects
         SET topic_id=$1,message_id=$2,checksum_sha256=$3,checksum_verified_at=NOW(),auth_tag_base64=$4,
             status='stored',error_code=NULL,updated_at=NOW()
         WHERE id=$5 AND tenant_id=$6 AND user_id=$7 AND status='pending' RETURNING *`,
        [stored.topic_id, stored.message_id, cryptoResult.plaintextSha256, cryptoResult.authTagBase64, objectId, actor.tenantId, actor.userId],
      );
      const row = updated.rows[0];
      if (!row) throw new StorageApiError(500, 'ASTERA_STORAGE_COMMIT_FAILED', 'Storage metadata commit failed.');
      storedRef = null;
      return context.json({ object: objectPayload(row), queue: stored.waited_in_queue ? 'waited' : 'direct' }, 201, { 'cache-control': 'no-store', 'x-correlation-id': requestId });
    } catch (error) {
      if (encryptedStream) await encryptedStream.cancel().catch(() => undefined);
      if (encryptionCompletion) void encryptionCompletion.catch(() => undefined);
      if (storedRef) {
        const actor = actorFromHeaders(context.req.raw.headers);
        await tgs.delete({ userId: actor.userId, topicId: storedRef.topic_id, messageId: storedRef.message_id }).catch(() => undefined);
      }
      if (objectId) {
        const code = error instanceof StorageApiError ? error.code
          : error instanceof TgserverStorageError ? error.code
            : error instanceof StorageObjectCryptoError ? error.code : 'TGS_STORAGE_UPLOAD_FAILED';
        await pool.query(`UPDATE astera_storage_objects SET status='error',error_code=$1,updated_at=NOW() WHERE id=$2`, [code, objectId]).catch(() => undefined);
      }
      return responseError(error, requestId);
    }
  });

  app.get('/api/storage/objects/:object', async (context) => {
    const requestId = correlationId(context.req.raw.headers);
    try { const actor = actorFromHeaders(context.req.raw.headers); storageCapacity(context.req.raw.headers); return context.json({ object: objectPayload(await ownedObject(pool,actor,context.req.param('object'))) },200,{ 'cache-control':'no-store','x-correlation-id':requestId }); }
    catch(error){ return responseError(error,requestId); }
  });

  app.get('/api/storage/objects/:object/download', async (context) => {
    const requestId = correlationId(context.req.raw.headers);
    let outputPath = '';
    try {
      const actor=actorFromHeaders(context.req.raw.headers); storageCapacity(context.req.raw.headers);
      const row=await ownedObject(pool,actor,context.req.param('object'));
      if(row.status!=='stored'||!row.topic_id||!row.message_id) throw new StorageApiError(409,'ASTERA_STORAGE_OBJECT_NOT_DOWNLOADABLEE','Object is not downloadable.');
      requireEncryptionMetadata(row);
      const upstream=await tgs.download({userId:actor.userId,topicId:Number(row.topic_id),messageId:Number(row.message_id),fileName:row.file_name,signal:context.req.raw.signal});
      if(!upstream.body) throw new StorageApiError(502,'TGS_STORAGE_EMPTY_BODY','TGserver returned an empty Storage body.');
      const tempDir=join(tmpdir(),'astera-storage-download');
      await mkdir(tempDir,{recursive:true});
      outputPath=join(tempDir,`${row.id}-${crypto.randomUUID()}.plain`);
      try {
        await decryptStorageObjectToFile({
          objectId:row.id,
          encryptedBody:upstream.body,
          outputPath,
          wrappedDek:{ciphertext:row.dek_wrap_ciphertext!,iv:row.dek_wrap_iv!},
          contentIvBase64:row.content_iv_base64!,
          authTagBase64:row.auth_tag_base64!,
          expectedSha256:row.checksum_sha256!,
          expectedPlaintextBytes:Number(row.file_size),
          vault,
        });
      } catch(error) {
        if(error instanceof StorageObjectCryptoError && INTEGRITY_ERROR_CODES.has(error.code)) {
          await pool.query(`UPDATE astera_storage_objects SET status='corrupt',error_code=$1,updated_at=NOW() WHERE id=$2`,[error.code,row.id]).catch(()=>undefined);
          throw new StorageApiError(409,'ASTERA_STORAGE_OBJECT_CORRUPT','Storage object failed integrity verification.');
        }
        throw error;
      }
      await pool.query(`UPDATE astera_storage_objects SET checksum_verified_at=NOW(),error_code=NULL,updated_at=NOW() WHERE id=$1`,[row.id]);
      const nodeStream=createReadStream(outputPath);
      const cleanup=()=>{void rm(outputPath,{force:true});};
      const abort=()=>nodeStream.destroy(new Error('client_cancelled'));
      context.req.raw.signal.addEventListener('abort',abort,{once:true});
      nodeStream.once('close',()=>{context.req.raw.signal.removeEventListener('abort',abort);cleanup();});
      nodeStream.once('error',cleanup);
      return new Response(Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>,{status:200,headers:{
        'content-type':row.mime_type,
        'content-length':String(row.file_size),
        'content-disposition':`attachment; filename*=UTF-8''${encodeURIComponent(row.file_name)}`,
        'cache-control':'no-store','x-correlation-id':requestId,
      }});
    } catch(error){ if(outputPath) await rm(outputPath,{force:true}).catch(()=>undefined); return responseError(error,requestId); }
  });

  app.delete('/api/storage/objects/:object', async (context) => {
    const requestId=correlationId(context.req.raw.headers);
    try {
      const actor=actorFromHeaders(context.req.raw.headers); storageCapacity(context.req.raw.headers);
      const result=await pool.query<StorageObjectRow>(`UPDATE astera_storage_objects SET status='soft_deleted',deleted_at=NOW(),updated_at=NOW() WHERE id=$1 AND tenant_id=$2 AND user_id=$3 AND status IN ('stored','corrupt') RETURNING *`,[context.req.param('object'),actor.tenantId,actor.userId]);
      if(!result.rows[0]) throw new StorageApiError(404,'ASTERA_STORAGE_OBJECT_NOT_FOUND','Storage object not found.');
      return context.json({object:objectPayload(result.rows[0]),undo_available:true},200,{'cache-control':'no-store','x-correlation-id':requestId});
    }catch(error){return responseError(error,requestId);}
  });

  app.post('/api/storage/objects/:object/undo-delete', async (context) => {
    const requestId=correlationId(context.req.raw.headers);
    try {
      const actor=actorFromHeaders(context.req.raw.headers); storageCapacity(context.req.raw.headers);
      const result=await pool.query<StorageObjectRow>(`UPDATE astera_storage_objects SET status=CASE WHEN error_code IS NULL THEN 'stored' ELSE 'corrupt' END,deleted_at=NULL,restored_at=NOW(),updated_at=NOW() WHERE id=$1 AND tenant_id=$2 AND user_id=$3 AND status='soft_deleted' RETURNING *`,[context.req.param('object'),actor.tenantId,actor.userId]);
      if(!result.rows[0]) throw new StorageApiError(404,'ASTERA_STORAGE_OBJECT_NOT_RESTORABLE','Storage object is not restorable.');
      return context.json({object:objectPayload(result.rows[0])},200,{'cache-control':'no-store','x-correlation-id':requestId});
    }catch(error){return responseError(error,requestId);}
  });

  app.post('/internal/v1/storage/objects/:object/purge', async (context) => {
    const requestId=correlationId(context.req.raw.headers);
    try {
      if(!internalAuthorized(context.req.raw.headers,config)) throw new StorageApiError(401,'INTERNAL_AUTHENTICATION_FAILED','Internal auth failed.');
      const result=await pool.query<StorageObjectRow>(`UPDATE astera_storage_objects SET status='deleting',updated_at=NOW() WHERE id=$1 AND status='soft_deleted' RETURNING *`,[context.req.param('object')]);
      const row=result.rows[0];
      if(!row||!row.topic_id||!row.message_id) throw new StorageApiError(404,'ASTERA_STORAGE_OBJECT_NOT_PURGEABLE','Object is not purgeable.');
      try {
        await tgs.delete({userId:row.user_id,topicId:Number(row.topic_id),messageId:Number(row.message_id),signal:context.req.raw.signal});
        const client=await pool.connect();
        try{
          await client.query('BEGIN');
          await client.query(`UPDATE astera_storage_objects SET status='deleted',primary_deleted_at=NOW(),error_code=NULL,updated_at=NOW() WHERE id=$1`,[row.id]);
          await client.query(`INSERT INTO astera_storage_deletion_receipts (id,object_id,tenant_id,user_id,topic_id,message_id,reason) VALUES ($1,$2,$3,$4,$5,$6,$7)`,[crypto.randomUUID(),row.id,row.tenant_id,row.user_id,Number(row.topic_id),Number(row.message_id),'lifecycle_purge']);
          await client.query('COMMIT');
        }catch(error){await client.query('ROLLBACK').catch(()=>undefined);throw error;}finally{client.release();}
        return context.json({deleted:true,object_id:row.id},200,{'cache-control':'no-store','x-correlation-id':requestId});
      }catch(error){await pool.query(`UPDATE astera_storage_objects SET status='error',error_code=$1,updated_at=NOW() WHERE id=$2`,[error instanceof TgserverStorageError?error.code:'TGS_STORAGE_DELETE_FAILED',row.id]).catch(()=>undefined);throw error;}
    }catch(error){return responseError(error,requestId);}
  });
}
