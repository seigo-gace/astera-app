import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { RuntimeConfig } from './config.js';
import { StorageApiError, MAX_FILE_BYTES } from './storage-api-types.js';

export const STORAGE_UPLOAD_CHUNK_BYTES = 32 * 1024 * 1024;
export const STORAGE_UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;

type SessionMeta = Readonly<{
  schema: 'astera.storage.upload.v1';
  object_id: string;
  user_id: string;
  file_size: number;
  chunk_size: number;
  chunk_count: number;
  created_at: string;
}>;

function root(config: RuntimeConfig): string {
  return config.storageUploadTmpDir?.trim() || join(tmpdir(), 'astera-storage-upload');
}

function safeObjectId(value: string): string {
  const id = value.trim();
  if (!/^[A-Za-z0-9_-]{16,160}$/.test(id)) {
    throw new StorageApiError(422, 'STORAGE_UPLOAD_OBJECT_ID_INVALID', 'Upload object id is invalid.');
  }
  return id;
}

export function storageUploadChunkCount(fileSize: number): number {
  if (!Number.isSafeInteger(fileSize) || fileSize < 0 || fileSize > MAX_FILE_BYTES) {
    throw new StorageApiError(422, 'STORAGE_FILE_SIZE_INVALID', 'File size is invalid.');
  }
  return fileSize === 0 ? 0 : Math.ceil(fileSize / STORAGE_UPLOAD_CHUNK_BYTES);
}

export function storageUploadExpectedChunkBytes(fileSize: number, index: number): number {
  const count = storageUploadChunkCount(fileSize);
  if (!Number.isSafeInteger(index) || index < 0 || index >= count) {
    throw new StorageApiError(422, 'STORAGE_UPLOAD_CHUNK_INDEX_INVALID', 'Chunk index is invalid.');
  }
  const offset = index * STORAGE_UPLOAD_CHUNK_BYTES;
  return Math.min(STORAGE_UPLOAD_CHUNK_BYTES, fileSize - offset);
}

function sessionDir(config: RuntimeConfig, objectId: string): string {
  return join(root(config), safeObjectId(objectId));
}

function metaPath(config: RuntimeConfig, objectId: string): string {
  return join(sessionDir(config, objectId), 'session.json');
}

function chunkPath(config: RuntimeConfig, objectId: string, index: number): string {
  return join(sessionDir(config, objectId), `chunk-${String(index).padStart(4, '0')}.bin`);
}

function assertMeta(actual: SessionMeta, expected: { objectId: string; userId: string; fileSize: number }): void {
  const count = storageUploadChunkCount(expected.fileSize);
  if (
    actual.schema !== 'astera.storage.upload.v1' ||
    actual.object_id !== expected.objectId ||
    actual.user_id !== expected.userId ||
    actual.file_size !== expected.fileSize ||
    actual.chunk_size !== STORAGE_UPLOAD_CHUNK_BYTES ||
    actual.chunk_count !== count
  ) {
    throw new StorageApiError(409, 'STORAGE_UPLOAD_SESSION_MISMATCH', 'Upload session does not match the requested object.');
  }
}

async function readSession(config: RuntimeConfig, input: { objectId: string; userId: string; fileSize: number }): Promise<SessionMeta | null> {
  const path = metaPath(config, input.objectId);
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code) : '';
    if (code === 'ENOENT') return null;
    throw error;
  }
  let parsed: SessionMeta;
  try {
    parsed = JSON.parse(text) as SessionMeta;
  } catch {
    throw new StorageApiError(500, 'STORAGE_UPLOAD_SESSION_CORRUPT', 'Upload session metadata is unreadable.');
  }
  assertMeta(parsed, input);
  return parsed;
}

async function ensureSession(config: RuntimeConfig, input: { objectId: string; userId: string; fileSize: number }): Promise<SessionMeta> {
  const existing = await readSession(config, input);
  if (existing) return existing;
  const dir = sessionDir(config, input.objectId);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const path = metaPath(config, input.objectId);
  const created: SessionMeta = {
    schema: 'astera.storage.upload.v1',
    object_id: input.objectId,
    user_id: input.userId,
    file_size: input.fileSize,
    chunk_size: STORAGE_UPLOAD_CHUNK_BYTES,
    chunk_count: storageUploadChunkCount(input.fileSize),
    created_at: new Date().toISOString(),
  };
  try {
    await writeFile(path, JSON.stringify(created), { flag: 'wx', mode: 0o600 });
    return created;
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code) : '';
    if (code !== 'EEXIST') throw error;
  }
  const raced = await readSession(config, input);
  if (!raced) throw new StorageApiError(500, 'STORAGE_UPLOAD_SESSION_CREATE_FAILED', 'Upload session could not be created.');
  return raced;
}

export async function cleanupExpiredStorageUploads(config: RuntimeConfig, now = Date.now()): Promise<number> {
  const base = root(config);
  await mkdir(base, { recursive: true, mode: 0o700 });
  let removed = 0;
  for (const entry of await readdir(base, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(base, entry.name);
    try {
      const info = await stat(join(dir, 'session.json')).catch(() => stat(dir));
      if (now - info.mtimeMs <= STORAGE_UPLOAD_TTL_MS) continue;
      await rm(dir, { recursive: true, force: true });
      removed += 1;
    } catch {
      // A concurrently active session can disappear between readdir/stat.
    }
  }
  return removed;
}

export async function writeStorageUploadChunk(
  config: RuntimeConfig,
  input: { objectId: string; userId: string; fileSize: number; index: number; body: ReadableStream<Uint8Array> },
): Promise<{ chunkIndex: number; bytes: number; idempotent: boolean }> {
  await cleanupExpiredStorageUploads(config).catch(() => undefined);
  await ensureSession(config, input);
  const expectedBytes = storageUploadExpectedChunkBytes(input.fileSize, input.index);
  const finalPath = chunkPath(config, input.objectId, input.index);
  try {
    const existing = await stat(finalPath);
    if (existing.size !== expectedBytes) {
      throw new StorageApiError(409, 'STORAGE_UPLOAD_CHUNK_CONFLICT', 'Existing chunk size does not match the expected size.');
    }
    await input.body.cancel().catch(() => undefined);
    return { chunkIndex: input.index, bytes: existing.size, idempotent: true };
  } catch (error) {
    if (error instanceof StorageApiError) throw error;
    const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code) : '';
    if (code !== 'ENOENT') throw error;
  }

  const tempPath = `${finalPath}.part-${crypto.randomUUID()}`;
  let bytes = 0;
  const limiter = new Transform({
    transform(chunk, _encoding, callback) {
      bytes += Buffer.byteLength(chunk);
      if (bytes > expectedBytes) {
        callback(new StorageApiError(422, 'STORAGE_UPLOAD_CHUNK_TOO_LARGE', 'Chunk exceeds the expected size.'));
        return;
      }
      callback(null, chunk);
    },
  });
  try {
    await pipeline(
      Readable.fromWeb(input.body as never),
      limiter,
      createWriteStream(tempPath, { flags: 'wx', mode: 0o600 }),
    );
    if (bytes !== expectedBytes) {
      throw new StorageApiError(422, 'STORAGE_UPLOAD_CHUNK_SIZE_MISMATCH', 'Chunk size does not match the expected size.');
    }
    await rename(tempPath, finalPath);
    return { chunkIndex: input.index, bytes, idempotent: false };
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function openStorageUploadPlaintext(
  config: RuntimeConfig,
  input: { objectId: string; userId: string; fileSize: number },
): Promise<{ body: ReadableStream<Uint8Array>; chunkCount: number }> {
  const meta = await ensureSession(config, input);
  for (let index = 0; index < meta.chunk_count; index += 1) {
    const expected = storageUploadExpectedChunkBytes(input.fileSize, index);
    const path = chunkPath(config, input.objectId, index);
    let size = -1;
    try {
      size = (await stat(path)).size;
    } catch {
      throw new StorageApiError(409, 'STORAGE_UPLOAD_INCOMPLETE', `Chunk ${index} is missing.`);
    }
    if (size !== expected) {
      throw new StorageApiError(409, 'STORAGE_UPLOAD_CHUNK_CORRUPT', `Chunk ${index} has an invalid size.`);
    }
  }

  const node = Readable.from((async function* () {
    for (let index = 0; index < meta.chunk_count; index += 1) {
      for await (const chunk of createReadStream(chunkPath(config, input.objectId, index))) {
        yield chunk;
      }
    }
  })());
  return { body: Readable.toWeb(node) as ReadableStream<Uint8Array>, chunkCount: meta.chunk_count };
}

export async function removeStorageUploadSession(
  config: RuntimeConfig,
  input: { objectId: string; userId: string; fileSize: number },
): Promise<boolean> {
  const existing = await readSession(config, input);
  if (!existing) return false;
  await rm(sessionDir(config, input.objectId), { recursive: true, force: true });
  return true;
}
