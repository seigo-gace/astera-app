import {
  FunctionHttpError,
  functionErrorResponse,
  requestCorrelationId,
  requireAsteraActor,
  type AsteraFunctionEnv,
} from '../../../_account-projection';
import { binaryError, storageBinaryFetch, type StorageBinaryEnv } from '../../../_storage-binary-client';
import { getObject, markObjectError, StorageStoreError } from '../../../_storage-store';
import { storageFileSize } from '../../../_storage-upload';

type Env = AsteraFunctionEnv & StorageBinaryEnv;
type C = { request: Request; env: Env; params: { object?: string } };
const norm = (error: unknown) => error instanceof StorageStoreError
  ? new FunctionHttpError(error.status, error.code, error.message, error.details)
  : error;

export async function onRequestDelete(c: C) {
  const cid = requestCorrelationId(c.request);
  try {
    const actor = await requireAsteraActor(c.request, c.env);
    const owner = { userId: actor.user.id, tenantId: actor.profile.tenant_id };
    const objectId = c.params.object?.trim() || '';
    if (!objectId) throw new FunctionHttpError(400, 'STORAGE_OBJECT_ID_REQUIRED', 'Storage Object IDが必要です。');

    const current = (await getObject(c.env.ASTERA_DB, owner, objectId)).object as Record<string, unknown>;
    if (current.status === 'error') {
      return Response.json({ cancelled: true, object_id: objectId, idempotent: true }, {
        status: 200,
        headers: { 'Cache-Control': 'no-store', 'X-Correlation-ID': cid },
      });
    }
    if (current.status !== 'pending') {
      throw new FunctionHttpError(409, 'STORAGE_UPLOAD_NOT_CANCELLABLE', 'このStorage Uploadは中止できません。');
    }

    const fileSize = storageFileSize(current.file_size);
    const headers = new Headers({
      'X-Astera-User-ID': owner.userId,
      'X-Astera-File-Size': String(fileSize),
      'X-Correlation-ID': cid,
    });
    const upstream = await storageBinaryFetch(
      c.env,
      `/internal/v1/storage-binary/uploads/${encodeURIComponent(objectId)}`,
      { method: 'DELETE', headers },
    );
    if (!upstream.ok) throw await binaryError(upstream);

    await markObjectError(c.env.ASTERA_DB, objectId, 'STORAGE_UPLOAD_CANCELLED');
    return Response.json({ cancelled: true, object_id: objectId, idempotent: false }, {
      status: 200,
      headers: { 'Cache-Control': 'no-store', 'X-Correlation-ID': cid },
    });
  } catch (error) {
    return functionErrorResponse(norm(error), cid);
  }
}

export function onRequest(c: C) {
  return c.request.method === 'DELETE'
    ? onRequestDelete(c)
    : Promise.resolve(Response.json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'DELETEのみ対応しています。' } }, { status: 405 }));
}
