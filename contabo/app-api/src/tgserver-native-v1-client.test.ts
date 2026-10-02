import test from 'node:test';
import assert from 'node:assert/strict';
import { TgserverNativeV1Client, TgserverNativeV1Error } from './tgserver-native-v1-client.js';

type SeenRequest = { url: string; init: RequestInit | undefined };

function json(body: Record<string, unknown>, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

test('native client uses canonical v1 object endpoints and scoped bearer credential', async () => {
  const seen: SeenRequest[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    seen.push({ url, init });
    if (url.endsWith('/v1/objects') && init?.method === 'POST') {
      return json({ status: 'ok', object_id: '11111111-1111-4111-8111-111111111111', state: 'STAGING', current_version: 0, duplicate: false }, 201);
    }
    if (url.endsWith('/content') && init?.method === 'PUT') {
      return json({ status: 'committed', object_id: '11111111-1111-4111-8111-111111111111', version: 1, logical_bytes: 3, sha256: 'abc', duplicate: false }, 201);
    }
    if (url.endsWith('/content') && init?.method === 'GET') {
      return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'application/octet-stream' } });
    }
    if (init?.method === 'DELETE') {
      return json({ status: 'deleted', object_id: '11111111-1111-4111-8111-111111111111', duplicate: false });
    }
    return json({ code: 'UNEXPECTED_REQUEST' }, 500);
  };
  const client = new TgserverNativeV1Client({ origin: 'http://tgserver:8080', token: 'scoped-token', timeoutMs: 5000 }, fetchImpl);
  const registered = await client.register({ objectKey: 'app-file-1', idempotencyKey: 'reg-1' });
  const written = await client.write({
    objectId: registered.objectId,
    fileSize: 3,
    body: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array([1, 2, 3])); controller.close(); } }),
    idempotencyKey: 'write-1',
  });
  const read = await client.read({ objectId: registered.objectId });
  const removed = await client.remove({ objectId: registered.objectId, idempotencyKey: 'delete-1' });

  assert.equal(written.status, 'committed');
  assert.equal((await read.arrayBuffer()).byteLength, 3);
  assert.equal(removed.status, 'deleted');
  assert.deepEqual(seen.map((request) => new URL(request.url).pathname), [
    '/v1/objects',
    '/v1/objects/11111111-1111-4111-8111-111111111111/content',
    '/v1/objects/11111111-1111-4111-8111-111111111111/content',
    '/v1/objects/11111111-1111-4111-8111-111111111111',
  ]);
  for (const request of seen) {
    assert.equal(new Headers(request.init?.headers).get('authorization'), 'Bearer scoped-token');
  }
  assert.equal(new Headers(seen[0]?.init?.headers).get('idempotency-key'), 'reg-1');
  assert.deepEqual(JSON.parse(String(seen[0]?.init?.body)), { object_key: 'app-file-1' });
  assert.equal(String(seen[0]?.init?.body).includes('user'), false);
  assert.equal(new Headers(seen[1]?.init?.headers).get('idempotency-key'), 'write-1');
  assert.equal(new Headers(seen[3]?.init?.headers).get('idempotency-key'), 'delete-1');
});

test('native client preserves retry evidence from TGserver errors', async () => {
  const client = new TgserverNativeV1Client(
    { origin: 'http://tgserver:8080', token: 'scoped-token', timeoutMs: 5000 },
    async () => json({ status: 'unavailable', code: 'PROVIDER_COOLDOWN', retry_after_ms: 2500 }, 429),
  );
  await assert.rejects(
    () => client.register({ objectKey: 'app-file-1', idempotencyKey: 'reg-1' }),
    (error: unknown) => {
      assert.ok(error instanceof TgserverNativeV1Error);
      assert.equal(error.code, 'PROVIDER_COOLDOWN');
      assert.equal(error.status, 429);
      assert.equal(error.retryAfterMs, 2500);
      return true;
    },
  );
});

test('native client rejects insecure remote origins but permits internal http service DNS', () => {
  assert.throws(
    () => new TgserverNativeV1Client({ origin: 'http://example.com', token: 'x', timeoutMs: 1000 }),
    (error: unknown) => error instanceof TgserverNativeV1Error && error.code === 'TGS_NATIVE_OBJECT_ORIGIN_HTTPS_REQUIRED',
  );
  assert.equal(new TgserverNativeV1Client({ origin: 'http://tgserver', token: 'x', timeoutMs: 1000 }).configured, true);
});
