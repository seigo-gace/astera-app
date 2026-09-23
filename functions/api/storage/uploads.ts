import {
  FunctionHttpError,
  functionErrorResponse,
  requestCorrelationId,
  requireAsteraActor,
  type AsteraFunctionEnv,
} from '../../_account-projection';
import { loadStorageContractProjection } from '../../_storage-contract';
import { getObject, reserveObject, assertStorageRefs, StorageStoreError } from '../../_storage-store';
import {
  deterministicStorageUploadObjectId,
  optionalStorageText,
  safeStorageFileName,
  STORAGE_UPLOAD_CHUNK_BYTES,
  storageChunkCount,
  storageFileSize,
} from '../../_storage-upload';

type C = { request: Request; env: AsteraFunctionEnv };
const norm = (error: unknown) => error instanceof StorageStoreError
  ? new FunctionHttpError(error.status, error.code, error.message, error.details)
  : error;

function objectBody(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function sameNullable(left: unknown, right: string | null): boolean {
  return (typeof left === 'string' && left.trim() ? left.trim() : null) === right;
}

export async function onRequestPost(c: C) {
  const cid = requestCorrelationId(c.request);
  try {
    const actor = await requireAsteraActor(c.request, c.env);
    const owner = { userId: actor.user.id, tenantId: actor.profile.tenant_id };
    const contract = await loadStorageContractProjection(c.env.ASTERA_DB, owner.tenantId);
    if (!contract.entitled) throw new FunctionHttpError(403, 'ASTERA_STORAGE_NOT_ENTITLED', 'Astera Storage契約がありません。');
    if (!contract.writeAllowed) throw new FunctionHttpError(409, 'ASTERA_STORAGE_SAVE_SUSPENDED', 'Astera Storageは現在Read-onlyです。');

    const body = objectBody(await c.request.json().catch(() => null));
    if (body.private_mode === true || body.private_mode === 1 || body.private_mode === '1') {
      throw new FunctionHttpError(409, 'PRIVATE_MODE_STORAGE_FORBIDDEN', 'Private ModeではAstera Storageへ保存できません。');
    }
    const fileName = safeStorageFileName(typeof body.file_name === 'string' ? body.file_name : '');
    const fileSize = storageFileSize(body.file_size);
    const mimeType = (typeof body.mime_type === 'string' && body.mime_type.trim()
      ? body.mime_type
      : 'application/octet-stream').split(';')[0]!.trim().slice(0, 160);
    const projectId = optionalStorageText(body.project_id);
    const folderId = optionalStorageText(body.folder_id);
    const sourceResultId = optionalStorageText(body.source_result_id);
    const idempotencyKey = c.request.headers.get('Idempotency-Key')?.trim() || '';
    const objectId = await deterministicStorageUploadObjectId(owner.userId, idempotencyKey);

    let existing: Record<string, unknown> | null = null;
    try {
      existing = (await getObject(c.env.ASTERA_DB, owner, objectId)).object as Record<string, unknown>;
    } catch (error) {
      if (!(error instanceof StorageStoreError) || error.code !== 'ASTERA_STORAGE_OBJECT_NOT_FOUND') throw error;
    }

    if (existing) {
      const matches = existing.file_name === fileName
        && Number(existing.file_size) === fileSize
        && existing.mime_type === mimeType
        && sameNullable(existing.project_id, projectId)
        && sameNullable(existing.folder_id, folderId)
        && sameNullable(existing.source_result_id, sourceResultId);
      if (!matches) {
        throw new FunctionHttpError(409, 'STORAGE_UPLOAD_IDEMPOTENCY_CONFLICT', '同じIdempotency-Keyが異なるFile情報で再利用されています。');
      }
      const status = typeof existing.status === 'string' ? existing.status : '';
      if (status === 'stored') {
        return Response.json({ object: existing, upload: { object_id: objectId, state: 'stored', chunk_size: STORAGE_UPLOAD_CHUNK_BYTES, chunk_count: storageChunkCount(fileSize) }, idempotent: true }, { status: 200, headers: { 'Cache-Control': 'no-store', 'X-Correlation-ID': cid } });
      }
      if (status === 'pending') {
        return Response.json({ object: existing, upload: { object_id: objectId, state: 'pending', chunk_size: STORAGE_UPLOAD_CHUNK_BYTES, chunk_count: storageChunkCount(fileSize) }, idempotent: true }, { status: 200, headers: { 'Cache-Control': 'no-store', 'X-Correlation-ID': cid } });
      }
      throw new FunctionHttpError(409, 'STORAGE_UPLOAD_IDEMPOTENCY_EXHAUSTED', 'このUpload IDは再利用できません。新しいUploadを開始してください。');
    }

    await assertStorageRefs(c.env.ASTERA_DB, owner, projectId, sourceResultId);
    const reserved = await reserveObject(c.env.ASTERA_DB, owner, {
      id: objectId,
      projectId,
      folderId,
      fileName,
      mimeType,
      fileSize,
      sourceResultId,
      capacityBytes: contract.capacityBytes,
    });
    return Response.json({ object: reserved, upload: { object_id: objectId, state: 'pending', chunk_size: STORAGE_UPLOAD_CHUNK_BYTES, chunk_count: storageChunkCount(fileSize) }, idempotent: false }, { status: 201, headers: { 'Cache-Control': 'no-store', 'X-Correlation-ID': cid } });
  } catch (error) {
    return functionErrorResponse(norm(error), cid);
  }
}

export function onRequest(c: C) {
  return c.request.method === 'POST'
    ? onRequestPost(c)
    : Promise.resolve(Response.json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'POSTのみ対応しています。' } }, { status: 405 }));
}
