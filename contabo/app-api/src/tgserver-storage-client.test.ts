import test from 'node:test';
import assert from 'node:assert/strict';
import type { RuntimeConfig } from './config.js';
import { TgserverStorageClient, TgserverStorageError } from './tgserver-storage-client.js';

const config = {
  tgserverStorageOrigin: 'http://127.0.0.1:3000',
  tgserverStorageToken: 'storage-secret',
  tgserverStorageTimeoutMs: 1_000,
} as RuntimeConfig;

test('upload adds service auth and forwards only technical storage metadata', async () => {
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
    assert.equal(headers.get('authorization'), 'Bearer storage-secret');
    assert.equal(headers.get('x-astera-user-id'), 'user-1');
    assert.equal(headers.get('x-astera-private-mode'), '0');
    assert.equal(headers.get('x-astera-file-size'), '3');
    assert.equal(captured!.init?.method, 'PUT');
    assert.equal((captured!.init as { duplex?: string }).duplex, 'half');
  } finally { globalThis.fetch = originalFetch; }
});

test('service auth is attached to download and delete', async () => {
  const originalFetch = globalThis.fetch;
  const auth: string[] = [];
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    auth.push(new Headers(init?.headers).get('authorization') || '');
    return new Response(new Uint8Array([1]), { status: 200 });
  }) as typeof fetch;
  try {
    const client = new TgserverStorageClient(config);
    await client.download({ userId: 'u', topicId: 1, messageId: 2, fileName: 'x' });
    await client.delete({ userId: 'u', topicId: 1, messageId: 2 });
    assert.deepEqual(auth, ['Bearer storage-secret', 'Bearer storage-secret']);
  } finally { globalThis.fetch = originalFetch; }
});

test('origin without token fails closed', () => {
  const client = new TgserverStorageClient({ ...config, tgserverStorageToken: '' });
  assert.equal(client.configured, false);
});

test('upstream error code is preserved without response body or token leakage', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => Response.json({ status: 'error', code: 'STORAGE_AUTHENTICATION_FAILED', secret: 'do-not-copy' }, { status: 401 })) as typeof fetch;
  try {
    const client = new TgserverStorageClient(config);
    await assert.rejects(
      () => client.delete({ userId: 'u', topicId: 1, messageId: 2 }),
      (error: unknown) => error instanceof TgserverStorageError
        && error.code === 'STORAGE_AUTHENTICATION_FAILED'
        && error.message === 'STORAGE_AUTHENTICATION_FAILED'
        && !error.message.includes('storage-secret'),
    );
  } finally { globalThis.fetch = originalFetch; }
});
