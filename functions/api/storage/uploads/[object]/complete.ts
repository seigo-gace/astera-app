import {
  FunctionHttpError,
  functionErrorResponse,
  requestCorrelationId,
  requireAsteraActor,
  type AsteraFunctionEnv,
} from '../../../../_account-projection';
import { binaryError, storageBinaryFetch, type StorageBinaryEnv } from '../../../../_storage-binary-client';
import { commitObject, getObject, StorageStoreError } from '../../../../_storage-store';
import { safeStorageFileName, storageFileSize } from '../../../../_storage-upload';

type Env = AsteraFunctionEnv & StorageBinaryEnv;
type C = { request: Request; env: Env; params: { object?: string } };
const norm = (error: unknown) => error instanceof StorageStoreError
  ? new FunctionHttpError(error.status, error.code, error.message, error.details)
  : error;

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export async function onRequestPost(c: C) {
  const cid = requestCorrelationId(c.request);
  try {
    const actor = await requireAsteraActor(c.request, c.env);
    const owner = { userId: actor.user.id, tenantId: actor.profile.tenant_id };
    const objectId = c.params.object?.trim() || '';
    if (!objectId) throw new FunctionHttpError(400, 'STORAGE_OBJECT_ID_REQUIRED', 'Storage Object IDが必要です。');

    const current = (await getObject(c.env.ASTERA_DB, owner, objectId)).object as Record<string, unknown>;
    if (current.status === 'stored') {
      return Response.json({ object: current, queue: 'complete', idempotent: true }, {
        status: 200,
        headers: { 'Cache-Control': 'no-store', 'X-Correlation-ID': cid },
      });
    }
    if (current.status !== 'pending') {
      throw new FunctionHttpError(409, 'STORAGE_UPLOAD_NOT_PENDING', 'このStorage Uploadは受付中ではありません。');
    }

    const fileSize = storageFileSize(current.file_size);
    const fileName = safeStorageFileName(text(current.file_name));
    const headers = new Headers({
      'X-Astera-User-ID': owner.userId,
      'X-Astera-File-Name': fileName,
      'X-Astera-File-Size': String(fileSize),
      'X-Correlation-ID': cid,
    });
    const declaredSha = c.request.headers.get('x-astera-sha256')?.trim().toLowerCase() || '';
    if (declaredSha) {
      if (!/^[a-f0-9]{64}$/.test(declaredSha)) throw new FunctionHttpError(422, 'STORAGE_SHA256_INVALID', 'SHA-256が不正です。');
      headers.set('X-Astera-SHA256', declaredSha);
    }

    const upstream = await storageBinaryFetch(
      c.env,
      `/internal/v1/storage-binary/uploads/${encodeURIComponent(objectId)}/complete`,
      { method: 'POST', headers },
    );
    if (!upstream.ok) throw await binaryError(upstream);

    const body = await upstream.json() as { binary?: Record<string, unknown>; queue?: string; idempotent?: boolean };
    const binary = body.binary ?? {};
    const field = (key: string) => typeof binary[key] === 'string' ? String(binary[key]) : '';
    const topicId = field('topic_id');
    const messageId = field('message_id');
    const telegramFileId = field('telegram_file_id');
    if (!topicId || !messageId || !telegramFileId) {
      throw new FunctionHttpError(502, 'ASTERA_STORAGE_BINARY_REF_INVALID', 'Storage binary参照が不正です。');
    }

    const object = await commitObject(c.env.ASTERA_DB, owner, objectId, {
      topicId,
      messageId,
      telegramFileId,
      checksumSha256: field('checksum_sha256'),
      encryptionProfile: field('encryption_profile'),
      dekWrapCiphertext: field('dek_wrap_ciphertext'),
      dekWrapIv: field('dek_wrap_iv'),
      contentIvBase64: field('content_iv_base64'),
      authTagBase64: field('auth_tag_base64'),
      encryptedAt: field('encrypted_at'),
    });

    const cleanupHeaders = new Headers({
      'X-Astera-User-ID': owner.userId,
      'X-Astera-File-Size': String(fileSize),
      'X-Astera-Upload-Finalized': '1',
      'X-Correlation-ID': cid,
    });
    void storageBinaryFetch(
      c.env,
      `/internal/v1/storage-binary/uploads/${encodeURIComponent(objectId)}`,
      { method: 'DELETE', headers: cleanupHeaders },
    ).catch(() => undefined);

    return Response.json({ object, queue: body.queue ?? 'direct', idempotent: body.idempotent === true }, {
      status: 201,
      headers: { 'Cache-Control': 'no-store', 'X-Correlation-ID': cid },
    });
  } catch (error) {
    return functionErrorResponse(norm(error), cid);
  }
}

export function onRequest(c: C) {
  return c.request.method === 'POST'
    ? onRequestPost(c)
    : Promise.resolve(Response.json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'POSTのみ対応しています。' } }, { status: 405 }));
}
