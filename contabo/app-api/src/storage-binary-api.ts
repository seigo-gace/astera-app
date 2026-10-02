import type { Hono } from 'hono';
import { createReadStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { RuntimeConfig } from './config.js';
import type { PersistentObjectLocator, PersistentObjectStore } from './persistent-object-store.js';
import {
  storageBinaryReferenceFields,
  storagePersistentLocatorFromHeaders,
} from './storage-persistent-object-bridge.js';
import { TgserverLegacyV15ObjectStore } from './tgserver-legacy-v15-object-store.js';
import { TgserverStorageClient } from './tgserver-storage-client.js';
import { createStorageEncryptedUpload, decryptStorageObjectToFile, type StorageVaultLike } from './storage-object-crypto.js';
import { StorageApiError, MAX_FILE_BYTES } from './storage-api-types.js';
import { internalAuthorized, responseError, correlationId } from './storage-api-auth.js';
import {
  acquireStorageUploadCompletionLock,
  openStorageUploadPlaintext,
  readStorageUploadCompletion,
  removeStorageUploadSession,
  writeStorageUploadChunk,
  writeStorageUploadCompletion,
} from './storage-upload-session.js';
import { VaultClient } from './vault-client.js';

function requiredHeader(headers: Headers, name: string, code: string): string {
  const value = headers.get(name)?.trim() || '';
  if (!value) throw new StorageApiError(422, code, `${name} is required.`);
  return value;
}
function nonNegativeInt(value: string, code: string): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0) throw new StorageApiError(422, code, `${code} is invalid.`);
  return n;
}
function fileSizeValue(value: string): number {
  const size = nonNegativeInt(value, 'STORAGE_FILE_SIZE_INVALID');
  if (size > MAX_FILE_BYTES) throw new StorageApiError(413, 'STORAGE_FILE_TOO_LARGE', 'File exceeds 1 GiB.');
  return size;
}
function sha(value: string): string {
  const v = value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(v)) throw new StorageApiError(422, 'STORAGE_SHA256_INVALID', 'SHA-256 is invalid.');
  return v;
}

type StoredRef = {
  objectId: string;
  userId: string;
  locator: PersistentObjectLocator;
};
type StoredResponse = { binary: Record<string, unknown>; queue: string };

async function removeStoredReference(store: PersistentObjectStore, ref: StoredRef): Promise<void> {
  await store.delete({
    objectId: ref.objectId,
    ownerId: ref.userId,
    locator: ref.locator,
  });
}

async function encryptAndStore(input: {
  objectId: string;
  userId: string;
  fileName: string;
  fileSize: number;
  expectedSha256: string;
  plaintext: ReadableStream<Uint8Array>;
  signal: AbortSignal;
  store: PersistentObjectStore;
  vault: StorageVaultLike;
}): Promise<{ response: StoredResponse; ref: StoredRef }> {
  let ref: StoredRef | null = null;
  let completion: Promise<{ plaintextSha256: string; authTagBase64: string }> | null = null;
  let stream: ReadableStream<Uint8Array> | null = null;
  try {
    const encrypted = await createStorageEncryptedUpload(input.objectId, input.plaintext, input.vault);
    completion = encrypted.completion;
    stream = encrypted.stream;
    const stored = await input.store.put({
      objectId: input.objectId,
      ownerId: input.userId,
      fileName: input.fileName,
      fileSize: input.fileSize,
      body: encrypted.stream,
      signal: input.signal,
    });
    stream = null;
    ref = { objectId: input.objectId, userId: input.userId, locator: stored.locator };
    const completed = await encrypted.completion;
    completion = null;
    if (input.expectedSha256 && input.expectedSha256 !== completed.plaintextSha256) {
      await removeStoredReference(input.store, ref).catch(() => undefined);
      ref = null;
      throw new StorageApiError(422, 'STORAGE_SHA256_MISMATCH', 'Uploaded SHA-256 does not match the declared checksum.');
    }
    const now = new Date().toISOString();
    return {
      ref,
      response: {
        binary: {
          ...storageBinaryReferenceFields(stored.locator),
          checksum_sha256: completed.plaintextSha256,
          encryption_profile: encrypted.metadata.encryptionProfile,
          dek_wrap_ciphertext: encrypted.metadata.wrappedDek.ciphertext,
          dek_wrap_iv: encrypted.metadata.wrappedDek.iv,
          content_iv_base64: encrypted.metadata.contentIvBase64,
          auth_tag_base64: completed.authTagBase64,
          encrypted_at: now,
        },
        queue: stored.waitedInQueue ? 'waited' : 'direct',
      },
    };
  } catch (error) {
    if (stream) await stream.cancel().catch(() => undefined);
    if (completion) void completion.catch(() => undefined);
    if (ref) await removeStoredReference(input.store, ref).catch(() => undefined);
    throw error;
  }
}

export function registerStorageBinaryApi(
  app: Hono,
  config: RuntimeConfig,
  store: PersistentObjectStore = new TgserverLegacyV15ObjectStore(new TgserverStorageClient(config)),
  vault: StorageVaultLike = new VaultClient(config),
): void {
  app.post('/internal/v1/storage-binary/objects/:object/upload', async (c) => {
    const requestId = correlationId(c.req.raw.headers);
    try {
      if (!internalAuthorized(c.req.raw.headers, config)) throw new StorageApiError(401, 'INTERNAL_AUTHENTICATION_FAILED', 'Internal auth failed.');
      if (!store.configured) throw new StorageApiError(503, 'TGS_STORAGE_NOT_CONFIGURED', 'TGserver Storage is not configured.');
      const objectId = c.req.param('object');
      const userId = requiredHeader(c.req.raw.headers, 'x-astera-user-id', 'STORAGE_USER_ID_REQUIRED');
      const fileName = requiredHeader(c.req.raw.headers, 'x-astera-file-name', 'STORAGE_FILE_NAME_REQUIRED').slice(0, 240);
      const fileSize = fileSizeValue(requiredHeader(c.req.raw.headers, 'x-astera-file-size', 'STORAGE_FILE_SIZE_REQUIRED'));
      const expected = c.req.header('x-astera-sha256')?.trim() ? sha(c.req.header('x-astera-sha256')!) : '';
      const body = c.req.raw.body;
      if (!body) throw new StorageApiError(422, 'STORAGE_FILE_BODY_REQUIRED', 'File body is required.');
      const stored = await encryptAndStore({ objectId, userId, fileName, fileSize, expectedSha256: expected, plaintext: body, signal: c.req.raw.signal, store, vault });
      return c.json(stored.response, 201, { 'cache-control': 'no-store', 'x-correlation-id': requestId });
    } catch (error) {
      return responseError(error, requestId);
    }
  });

  app.put('/internal/v1/storage-binary/uploads/:object/chunks/:index', async (c) => {
    const requestId = correlationId(c.req.raw.headers);
    try {
      if (!internalAuthorized(c.req.raw.headers, config)) throw new StorageApiError(401, 'INTERNAL_AUTHENTICATION_FAILED', 'Internal auth failed.');
      const objectId = c.req.param('object');
      const userId = requiredHeader(c.req.raw.headers, 'x-astera-user-id', 'STORAGE_USER_ID_REQUIRED');
      const fileSize = fileSizeValue(requiredHeader(c.req.raw.headers, 'x-astera-file-size', 'STORAGE_FILE_SIZE_REQUIRED'));
      const index = nonNegativeInt(c.req.param('index'), 'STORAGE_UPLOAD_CHUNK_INDEX_INVALID');
      const body = c.req.raw.body;
      if (!body) throw new StorageApiError(422, 'STORAGE_UPLOAD_CHUNK_BODY_REQUIRED', 'Chunk body is required.');
      const stored = await writeStorageUploadChunk(config, { objectId, userId, fileSize, index, body });
      return c.json({ chunk_index: stored.chunkIndex, bytes: stored.bytes, idempotent: stored.idempotent }, 200, { 'cache-control': 'no-store', 'x-correlation-id': requestId });
    } catch (error) {
      return responseError(error, requestId);
    }
  });

  app.post('/internal/v1/storage-binary/uploads/:object/complete', async (c) => {
    const requestId = correlationId(c.req.raw.headers);
    try {
      if (!internalAuthorized(c.req.raw.headers, config)) throw new StorageApiError(401, 'INTERNAL_AUTHENTICATION_FAILED', 'Internal auth failed.');
      if (!store.configured) throw new StorageApiError(503, 'TGS_STORAGE_NOT_CONFIGURED', 'TGserver Storage is not configured.');
      const objectId = c.req.param('object');
      const userId = requiredHeader(c.req.raw.headers, 'x-astera-user-id', 'STORAGE_USER_ID_REQUIRED');
      const fileName = requiredHeader(c.req.raw.headers, 'x-astera-file-name', 'STORAGE_FILE_NAME_REQUIRED').slice(0, 240);
      const fileSize = fileSizeValue(requiredHeader(c.req.raw.headers, 'x-astera-file-size', 'STORAGE_FILE_SIZE_REQUIRED'));
      const expected = c.req.header('x-astera-sha256')?.trim() ? sha(c.req.header('x-astera-sha256')!) : '';
      const previous = await readStorageUploadCompletion(config, { objectId, userId, fileSize });
      if (previous) {
        return c.json({ ...previous.response, idempotent: true }, 200, { 'cache-control': 'no-store', 'x-correlation-id': requestId });
      }
      const release = await acquireStorageUploadCompletionLock(config, { objectId, userId, fileSize });
      try {
        const raced = await readStorageUploadCompletion(config, { objectId, userId, fileSize });
        if (raced) {
          return c.json({ ...raced.response, idempotent: true }, 200, { 'cache-control': 'no-store', 'x-correlation-id': requestId });
        }
        const source = await openStorageUploadPlaintext(config, { objectId, userId, fileSize });
        const stored = await encryptAndStore({ objectId, userId, fileName, fileSize, expectedSha256: expected, plaintext: source.body, signal: c.req.raw.signal, store, vault });
        try {
          const receipt = await writeStorageUploadCompletion(config, { objectId, userId, fileSize, response: stored.response });
          return c.json({ ...receipt.response, idempotent: false }, 201, { 'cache-control': 'no-store', 'x-correlation-id': requestId });
        } catch (error) {
          await removeStoredReference(store, stored.ref).catch(() => undefined);
          throw error;
        }
      } finally {
        await release();
      }
    } catch (error) {
      return responseError(error, requestId);
    }
  });

  app.delete('/internal/v1/storage-binary/uploads/:object', async (c) => {
    const requestId = correlationId(c.req.raw.headers);
    try {
      if (!internalAuthorized(c.req.raw.headers, config)) throw new StorageApiError(401, 'INTERNAL_AUTHENTICATION_FAILED', 'Internal auth failed.');
      const objectId = c.req.param('object');
      const userId = requiredHeader(c.req.raw.headers, 'x-astera-user-id', 'STORAGE_USER_ID_REQUIRED');
      const fileSize = fileSizeValue(requiredHeader(c.req.raw.headers, 'x-astera-file-size', 'STORAGE_FILE_SIZE_REQUIRED'));
      const finalized = c.req.raw.headers.get('x-astera-upload-finalized') === '1';
      if (!finalized && await readStorageUploadCompletion(config, { objectId, userId, fileSize })) {
        throw new StorageApiError(409, 'STORAGE_UPLOAD_ALREADY_COMPLETED', 'Upload binary is already stored; complete the D1 commit instead of cancelling.');
      }
      const removed = await removeStorageUploadSession(config, { objectId, userId, fileSize });
      return c.json({ removed }, 200, { 'cache-control': 'no-store', 'x-correlation-id': requestId });
    } catch (error) {
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
      const locator = storagePersistentLocatorFromHeaders(h);
      const fileName = requiredHeader(h, 'x-astera-file-name', 'STORAGE_FILE_NAME_REQUIRED').slice(0, 240);
      const mimeHeader = h.get('x-astera-mime-type') || 'application/octet-stream';
      const mimeType = (mimeHeader.split(';')[0] ?? 'application/octet-stream').trim().slice(0, 160);
      const fileSize = nonNegativeInt(requiredHeader(h, 'x-astera-file-size', 'STORAGE_FILE_SIZE_REQUIRED'), 'STORAGE_FILE_SIZE_INVALID');
      const expectedSha256 = sha(requiredHeader(h, 'x-astera-sha256', 'STORAGE_SHA256_REQUIRED'));
      if (requiredHeader(h, 'x-astera-encryption-profile', 'STORAGE_ENCRYPTION_PROFILE_REQUIRED') !== 'AES-256-GCM') throw new StorageApiError(422, 'STORAGE_ENCRYPTION_PROFILE_INVALID', 'Encryption profile is invalid.');
      const wrappedDek = { ciphertext: requiredHeader(h, 'x-astera-dek-wrap-ciphertext', 'STORAGE_DEK_WRAP_REQUIRED'), iv: requiredHeader(h, 'x-astera-dek-wrap-iv', 'STORAGE_DEK_WRAP_IV_REQUIRED') };
      const contentIvBase64 = requiredHeader(h, 'x-astera-content-iv-base64', 'STORAGE_CONTENT_IV_REQUIRED');
      const authTagBase64 = requiredHeader(h, 'x-astera-auth-tag-base64', 'STORAGE_AUTH_TAG_REQUIRED');
      const upstream = await store.read({ objectId, ownerId: userId, locator, fileName, signal: c.req.raw.signal });
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
      const objectId = c.req.param('object');
      const userId = requiredHeader(h, 'x-astera-user-id', 'STORAGE_USER_ID_REQUIRED');
      const locator = storagePersistentLocatorFromHeaders(h);
      await store.delete({ objectId, ownerId: userId, locator, signal: c.req.raw.signal });
      return c.json({ deleted: true, object_id: objectId }, 200, { 'cache-control': 'no-store', 'x-correlation-id': requestId });
    } catch (error) {
      return responseError(error, requestId);
    }
  });
}
