import {
  FunctionHttpError,
  functionErrorResponse,
  requestCorrelationId,
  requireAsteraActor,
  type AsteraFunctionEnv,
} from '../../../../_account-projection';
import { binaryError, storageBinaryFetch, type StorageBinaryEnv } from '../../../../_storage-binary-client';
import { getObject, StorageStoreError } from '../../../../_storage-store';
import { storageExpectedChunkBytes, storageFileSize } from '../../../../_storage-upload';

type Env = AsteraFunctionEnv & StorageBinaryEnv;
type C = { request: Request; env: Env; params: { object?: string; index?: string } };
const norm = (error: unknown) => error instanceof StorageStoreError
  ? new FunctionHttpError(error.status, error.code, error.message, error.details)
  : error;

export async function onRequestPut(c: C) {
  const cid = requestCorrelationId(c.request);
  try {
    const actor = await requireAsteraActor(c.request, c.env);
    const owner = { userId: actor.user.id, tenantId: actor.profile.tenant_id };
    const objectId = c.params.object?.trim() || '';
    if (!objectId) throw new FunctionHttpError(400, 'STORAGE_OBJECT_ID_REQUIRED', 'Storage Object IDが必要です。');
    const index = Number(c.params.index);
    const row = (await getObject(c.env.ASTERA_DB, owner, objectId)).object as Record<string, unknown>;
    if (row.status !== 'pending') throw new FunctionHttpError(409, 'STORAGE_UPLOAD_NOT_PENDING', 'このStorage Uploadは受付中ではありません。');
    const fileSize = storageFileSize(row.file_size);
    const expectedBytes = storageExpectedChunkBytes(fileSize, index);
    const contentLength = c.request.headers.get('content-length');
    if (contentLength !== null && Number(contentLength) !== expectedBytes) {
      throw new FunctionHttpError(422, 'STORAGE_UPLOAD_CHUNK_SIZE_MISMATCH', 'Upload Chunk Sizeが不正です。');
    }
    if (!c.request.body) throw new FunctionHttpError(422, 'STORAGE_UPLOAD_CHUNK_BODY_REQUIRED', 'Upload Chunk本文が必要です。');

    const headers = new Headers({
      'X-Astera-User-ID': owner.userId,
      'X-Astera-File-Size': String(fileSize),
      'X-Correlation-ID': cid,
    });
    const upstream = await storageBinaryFetch(c.env, `/internal/v1/storage-binary/uploads/${encodeURIComponent(objectId)}/chunks/${index}`, {
      method: 'PUT',
      headers,
      body: c.request.body,
    });
    if (!upstream.ok) throw await binaryError(upstream);
    const body = await upstream.json();
    return Response.json(body, { status: 200, headers: { 'Cache-Control': 'no-store', 'X-Correlation-ID': cid } });
  } catch (error) {
    return functionErrorResponse(norm(error), cid);
  }
}

export function onRequest(c: C) {
  return c.request.method === 'PUT'
    ? onRequestPut(c)
    : Promise.resolve(Response.json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'PUTのみ対応しています。' } }, { status: 405 }));
}
