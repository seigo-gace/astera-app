import type { Hono } from 'hono';
import { createReadStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { RuntimeConfig } from './config.js';
import { TgserverStorageClient, TgserverStorageError } from './tgserver-storage-client.js';
import { createStorageEncryptedUpload, decryptStorageObjectToFile, StorageObjectCryptoError, type StorageVaultLike } from './storage-object-crypto.js';
import { StorageApiError, MAX_FILE_BYTES } from './storage-api-types.js';
import { internalAuthorized, responseError, correlationId } from './storage-api-auth.js';
import { VaultClient } from './vault-client.js';

function requiredHeader(headers: Headers, name: string, code: string): string {
  const value = headers.get(name)?.trim() || '';
  if (!value) throw new StorageApiError(422, code, `${name} is required.`);
  return value;
}
function positiveInt(value: string, code: string): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) throw new StorageApiError(422, code, `${code} is invalid.`);
  return n;
}
function nonNegativeInt(value: string, code: string): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0) throw new StorageApiError(422, code, `${code} is invalid.`);
  return n;
}
function sha(value: string): string {
  const v = value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(v)) throw new StorageApiError(422, 'STORAGE_SHA256_INVALID', 'SHA-256 is invalid.');
  return v;
}

export function registerStorageBinaryApi(
  app: Hono,
  config: RuntimeConfig,
  tgs = new TgserverStorageClient(config),
  vault: StorageVaultLike = new VaultClient(config),
): void {
  app.post('/internal/v1/storage-binary/objects/:object/upload', async (c) => {
    const requestId = correlationId(c.req.raw.headers);
    let ref: { topicId: number; messageId: number; userId: string } | null = null;
    let completion: Promise<{ plaintextSha256: string; authTagBase64: string }> | null = null;
    let stream: ReadableStream<Uint8Array> | null = null;
    try {
      if (!internalAuthorized(c.req.raw.headers, config)) throw new StorageApiError(401, 'INTERNAL_AUTHENTICATION_FAILED', 'Internal auth failed.');
      if (!tgs.configured) throw new StorageApiError(503, 'TGS_STORAGE_NOT_CONFIGURED', 'TGserver Storage is not configured.');
      const objectId = c.req.param('object');
      const userId = requiredHeader(c.req.raw.headers, 'x-astera-user-id', 'STORAGE_USER_ID_REQUIRED');
      const fileName = requiredHeader(c.req.raw.headers, 'x-astera-file-name', 'STORAGE_FILE_NAME_REQUIRED').slice(0, 240);
      const fileSize = nonNegativeInt(requiredHeader(c.req.raw.headers, 'x-astera-file-size', 'STORAGE_FILE_SIZE_REQUIRED'), 'STORAGE_FILE_SIZE_INVALID');
      if (fileSize > MAX_FILE_BYTES) throw new StorageApiError(413, 'STORAGE_FILE_TOO_LARGE', 'File exceeds 4 GiB.');
      const expected = c.req.header('x-astera-sha256')?.trim() ? sha(c.req.header('x-astera-sha256')!) : '';
      const body = c.req.raw.body;
      if (!body) throw new StorageApiError(422, 'STORAGE_FILE_BODY_REQUIRED', 'File body is required.');
      const encrypted = await createStorageEncryptedUpload(objectId, body, vault);
      completion = encrypted.completion;
      stream = encrypted.stream;
      const stored = await tgs.upload({ objectId, userId, fileName, fileSize, body: encrypted.stream, signal: c.req.raw.signal });
      stream = null;
      ref = { topicId: stored.topic_id, messageId: stored.message_id, userId };
      const completed = await encrypted.completion;
      completion = null;
      if (expected && expected !== completed.plaintextSha256) {
        await tgs.delete({ userId, topicId: stored.topic_id, messageId: stored.message_id }).catch(() => undefined);
        ref = null;
        throw new StorageApiError(422, 'STORAGE_SHA256_MISMATCH', 'Uploaded SHA-256 does not match the declared checksum.');
      }
      const now = new Date().toISOString();
      const response = {
        binary: {
          topic_id: String(stored.topic_id),
          message_id: String(stored.message_id),
          checksum_sha256: completed.plaintextSha256,
          encryption_profile: encrypted.metadata.encryptionProfile,
          dek_wrap_ciphertext: encrypted.metadata.wrappedDek.ciphertext,
          dek_wrap_iv: encrypted.metadata.wrappedDek.iv,
          content_iv_base64: encrypted.metadata.contentIvBase64,
          auth_tag_base64: completed.authTagBase64,
          encrypted_at: now,
        },
        queue: stored.waited_in_queue ? 'waited' : 'direct',
      };
      ref = null;
      return c.json(response, 201, { 'cache-control': 'no-store', 'x-correlation-id': requestId });
    } catch (error) {
      if (stream) await stream.cancel().catch(() => undefined);
      if (completion) void completion.catch(() => undefined);
      if (ref) await tgs.delete({ userId: ref.userId, topicId: ref.topicId, messageId: ref.messageId }).catch(() => undefined);
      return responseError(error, requestId);
    }
  });

  app.get('/internal/v1/storage-binary/objects/:object/download', async (c) => {
    const requestId = correlationId(c.req.raw.headers);
    let outputPath = '';
    try {
      if (!internalAuthorized(c.req.raw.headers, config)) throw new StorageApiError(401, 'INTERNAL_AUTHENTICATION_FAILED', 'Internal auth failed.');
      const h = c.req.raw.headers;
      const objectId = c.req.param('object');
      const userId = requiredHeader(h, 'x-astera-user-id', 'STORAGE_USER_ID_REQUIRED');
      const topicId = positiveInt(requiredHeader(h, 'x-astera-topic-id', 'STORAGE_TOPIC_ID_REQUIRED'), 'STORAGE_TOPIC_ID_INVALID');
      const messageId = positiveInt(requiredHeader(h, 'x-astera-message-id', 'STORAGE_MESSAGE_ID_REQUIRED'), 'STORAGE_MESSAGE_ID_INVALID');
      const fileName = requiredHeader(h, 'x-astera-file-name', 'STORAGE_FILE_NAME_REQUIRED').slice(0, 240);
      const mimeHeader = h.get('x-astera-mime-type') || 'application/octet-stream';
      const mimeType = (mimeHeader.split(';')[0] ?? 'application/octet-stream').trim().slice(0, 160);
      const fileSize = nonNegativeInt(requiredHeader(h, 'x-astera-file-size', 'STORAGE_FILE_SIZE_REQUIRED'), 'STORAGE_FILE_SIZE_INVALID');
      const expectedSha256 = sha(requiredHeader(h, 'x-astera-sha256', 'STORAGE_SHA256_REQUIRED'));
      if (requiredHeader(h, 'x-astera-encryption-profile', 'STORAGE_ENCRYPTION_PROFILE_REQUIRED') !== 'AES-256-GCM') throw new StorageApiError(422, 'STORAGE_ENCRYPTION_PROFILE_INVALID', 'Encryption profile is invalid.');
      const wrappedDek = { ciphertext: requiredHeader(h, 'x-astera-dek-wrap-ciphertext', 'STORAGE_DEK_WRAP_REQUIRED'), iv: requiredHeader(h, 'x-astera-dek-wrap-iv', 'STORAGE_DEK_WRAP_IV_REQUIRED') };
      const contentIvBase64 = requiredHeader(h, 'x-astera-content-iv-base64', 'STORAGE_CONTENT_IV_REQUIRED');
      const authTagBase64 = requiredHeader(h, 'x-astera-auth-tag-base64', 'STORAGE_AUTH_TAG_REQUIRED');
      const upstream = await tgs.download({ userId, topicId, messageId, fileName, signal: c.req.raw.signal });
      if (!upstream.body) throw new StorageApiError(502, 'TGS_STORAGE_EMPTY_BODY', 'TGserver returned an empty body.');
      const dir = join(tmpdir(), 'astera-storage-download');
      await mkdir(dir, { recursive: true });
      outputPath = join(dir, `${objectId}-${crypto.randomUUID()}.plain`);
      await decryptStorageObjectToFile({ objectId, encryptedBody: upstream.body, outputPath, wrappedDek, contentIvBase64, authTagBase64, expectedSha256, expectedPlaintextBytes: fileSize, vault });
      const node = createReadStream(outputPath);
      const cleanup = () => { void rm(outputPath, { force: true }); };
      const abort = () => node.destroy(new Error('client_cancelled'));
      c.req.raw.signal.addEventListener('abort', abort, { once: true });
      node.once('close', () => { c.req.raw.signal.removeEventListener('abort', abort); cleanup(); });
      node.once('error', cleanup);
      return new Response(Readable.toWeb(node) as ReadableStream<Uint8Array>, { status: 200, headers: { 'content-type': mimeType, 'content-length': String(fileSize), 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`, 'cache-control': 'no-store', 'x-correlation-id': requestId } });
    } catch (error) {
      if (outputPath) await rm(outputPath, { force: true }).catch(() => undefined);
      return responseError(error, requestId);
    }
  });

  app.post('/internal/v1/storage-binary/objects/:object/purge', async (c) => {
    const requestId = correlationId(c.req.raw.headers);
    try {
      if (!internalAuthorized(c.req.raw.headers, config)) throw new StorageApiError(401, 'INTERNAL_AUTHENTICATION_FAILED', 'Internal auth failed.');
      const h = c.req.raw.headers;
      const userId = requiredHeader(h, 'x-astera-user-id', 'STORAGE_USER_ID_REQUIRED');
      const topicId = positiveInt(requiredHeader(h, 'x-astera-topic-id', 'STORAGE_TOPIC_ID_REQUIRED'), 'STORAGE_TOPIC_ID_INVALID');
      const messageId = positiveInt(requiredHeader(h, 'x-astera-message-id', 'STORAGE_MESSAGE_ID_REQUIRED'), 'STORAGE_MESSAGE_ID_INVALID');
      await tgs.delete({ userId, topicId, messageId, signal: c.req.raw.signal });
      return c.json({ deleted: true, object_id: c.req.param('object') }, 200, { 'cache-control': 'no-store', 'x-correlation-id': requestId });
    } catch (error) {
      return responseError(error, requestId);
    }
  });
}
