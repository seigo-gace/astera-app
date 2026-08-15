import test from 'node:test';
import assert from 'node:assert/strict';
import type { RuntimeConfig } from './config.js';
import { TgserverStorageClient, TgserverStorageError } from './tgserver-storage-client.js';

const config = {
  tgserverStorageOrigin: 'http://127.0.0.1:3000',
  tgserverStorageTimeoutMs: 1_000,
} as RuntimeConfig;

test('upload forwards only technical storage metadata and private=false', async () => {
  const originalFetch = globalThis.fetch;
  let captured: { input: string; init?: RequestInit & { duplex?: string } } | null = null;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    captured = { input: String(input), init: init as RequestInit & { duplex?: string } };
    return Response.json({ file_id: 'object-1', topic_id: 10, message_id: 20, file_size: 3, status: 'stored' }, { status: 201 });
  }) as typeof fetch;
  try {
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array([1,2,3])); controller.close(); } });
    const client = new TgserverStorageClient(config);
    const result = await client.upload({ objectId: 'object-1', userId: 'user-1', fileName: 'a b.txt', fileSize: 3, body });
    assert.equal(result.topic_id, 10);
    assert.ok(captured);
    const headers = new Headers(captured!.init?.headers);
    assert.equal(headers.get('x-astera-user-id'), 'user-1');
    assert.equal(headers.get('x-astera-private-mode'), '0');
    assert.equal(headers.get('x-astera-file-size'), '3');
    assert.equal(captured!.init?.method, 'PUT');
    assert.equal((captured!.init as { duplex?: string }).duplex, 'half');
  } finally { globalThis.fetch = originalFetch; }
});

test('upstream error code is preserved without response body leakage', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => Response.json({ status: 'error', code: 'USER_TOPIC_OWNERSHIP_MISMATCH', secret: 'do-not-copy' }, { status: 409 })) as typeof fetch;
  try {
    const client = new TgserverStorageClient(config);
    await assert.rejects(
      () => client.delete({ userId: 'u', topicId: 1, messageId: 2 }),
      (error: unknown) => error instanceof TgserverStorageError && error.code === 'USER_TOPIC_OWNERSHIP_MISMATCH' && error.message === 'USER_TOPIC_OWNERSHIP_MISMATCH',
    );
  } finally { globalThis.fetch = originalFetch; }
});
