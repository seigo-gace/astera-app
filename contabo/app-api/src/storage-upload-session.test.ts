import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { RuntimeConfig } from './config.js';
import { StorageApiError } from './storage-api-types.js';
import {
  acquireStorageUploadCompletionLock,
  openStorageUploadPlaintext,
  readStorageUploadCompletion,
  STORAGE_UPLOAD_CHUNK_BYTES,
  storageUploadChunkCount,
  storageUploadExpectedChunkBytes,
  writeStorageUploadChunk,
  writeStorageUploadCompletion,
} from './storage-upload-session.js';

function config(storageUploadTmpDir: string): RuntimeConfig {
  return {
    port: 8788,
    internalServiceToken: 'test',
    processOrigin: 'http://process',
    processToken: 'test',
    processTimeoutMs: 120_000,
    shutdownTimeoutMs: 20_000,
    vaultOrigin: 'http://vault',
    vaultServiceToken: 'test',
    vaultJobKeyRef: 'test',
    vaultTimeoutMs: 15_000,
    translationModelId: '',
    translationGeminiKeyRef: '',
    translationTimeoutMs: 90_000,
    tgserverStorageOrigin: 'http://tgs',
    tgserverStorageToken: 'test',
    tgserverStorageTimeoutMs: 600_000,
    storageUploadTmpDir,
  };
}

function byteStream(bytes: number, value: number): ReadableStream<Uint8Array> {
  const block = new Uint8Array(Math.min(1024 * 1024, Math.max(1, bytes))).fill(value);
  let remaining = bytes;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (remaining <= 0) {
        controller.close();
        return;
      }
      const size = Math.min(block.byteLength, remaining);
      controller.enqueue(size === block.byteLength ? block : block.slice(0, size));
      remaining -= size;
    },
  });
}

async function readAll(body: ReadableStream<Uint8Array>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const reader = body.getReader();
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    chunks.push(Buffer.from(next.value));
  }
  return Buffer.concat(chunks);
}

test('32 MiB chunk contract covers the 1 GiB single-file limit', () => {
  assert.equal(storageUploadChunkCount(1024 * 1024 * 1024), 32);
  assert.equal(storageUploadExpectedChunkBytes(STORAGE_UPLOAD_CHUNK_BYTES + 7, 0), STORAGE_UPLOAD_CHUNK_BYTES);
  assert.equal(storageUploadExpectedChunkBytes(STORAGE_UPLOAD_CHUNK_BYTES + 7, 1), 7);
  assert.throws(() => storageUploadChunkCount(1024 * 1024 * 1024 + 1), (error: unknown) => {
    return error instanceof StorageApiError && error.code === 'STORAGE_FILE_SIZE_INVALID';
  });
});

test('chunk upload reassembles in order and completion removes payload chunks', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'astera-upload-test-'));
  const runtime = config(dir);
  const input = { objectId: 'upl_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', userId: 'user-1', fileSize: STORAGE_UPLOAD_CHUNK_BYTES + 7 };
  try {
    const first = await writeStorageUploadChunk(runtime, { ...input, index: 0, body: byteStream(STORAGE_UPLOAD_CHUNK_BYTES, 0x41) });
    const second = await writeStorageUploadChunk(runtime, { ...input, index: 1, body: byteStream(7, 0x42) });
    assert.equal(first.bytes, STORAGE_UPLOAD_CHUNK_BYTES);
    assert.equal(second.bytes, 7);

    const opened = await openStorageUploadPlaintext(runtime, input);
    assert.equal(opened.chunkCount, 2);
    const assembled = await readAll(opened.body);
    assert.equal(assembled.byteLength, STORAGE_UPLOAD_CHUNK_BYTES + 7);
    assert.equal(assembled[0], 0x41);
    assert.equal(assembled[STORAGE_UPLOAD_CHUNK_BYTES - 1], 0x41);
    assert.equal(assembled[STORAGE_UPLOAD_CHUNK_BYTES], 0x42);

    await writeStorageUploadCompletion(runtime, {
      ...input,
      response: { binary: { topic_id: '3', message_id: '6', telegram_file_id: 'file-ref' }, queue: 'direct' },
    });
    const receipt = await readStorageUploadCompletion(runtime, input);
    assert.equal(receipt?.response.binary.telegram_file_id, 'file-ref');

    const files = await readdir(join(dir, input.objectId));
    assert.ok(files.includes('session.json'));
    assert.ok(files.includes('completion.json'));
    assert.equal(files.some((name) => name.startsWith('chunk-')), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('completion lock prevents concurrent duplicate storage', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'astera-upload-lock-test-'));
  const runtime = config(dir);
  const input = { objectId: 'upl_abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789', userId: 'user-2', fileSize: 7 };
  try {
    await writeStorageUploadChunk(runtime, { ...input, index: 0, body: byteStream(7, 0x43) });
    const release = await acquireStorageUploadCompletionLock(runtime, input);
    await assert.rejects(() => acquireStorageUploadCompletionLock(runtime, input), (error: unknown) => {
      return error instanceof StorageApiError && error.code === 'STORAGE_UPLOAD_COMPLETION_IN_PROGRESS';
    });
    await release();
    const releaseAgain = await acquireStorageUploadCompletionLock(runtime, input);
    await releaseAgain();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
