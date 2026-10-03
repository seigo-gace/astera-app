import test from 'node:test';
import assert from 'node:assert/strict';
import type { PersistentObjectDeleteInput, PersistentObjectPutInput, PersistentObjectReadInput } from './persistent-object-store.js';
import { TgserverNativeV1Error } from './tgserver-native-v1-client.js';
import { TgserverNativeV1ObjectStore, type TgserverNativeV1ClientLike } from './tgserver-native-v1-object-store.js';

const nativeId = '11111111-1111-4111-8111-111111111111';

class FakeClient implements TgserverNativeV1ClientLike {
  readonly configured = true;
  readonly registerCalls: Parameters<TgserverNativeV1ClientLike['register']>[0][] = [];
  readonly writeCalls: Parameters<TgserverNativeV1ClientLike['write']>[0][] = [];
  readonly readCalls: Parameters<TgserverNativeV1ClientLike['read']>[0][] = [];
  readonly removeCalls: Parameters<TgserverNativeV1ClientLike['remove']>[0][] = [];
  readinessCalls = 0;
  readinessError: Error | null = null;
  writeStatus: 'committed' | 'reconciliation_required' | 'retryable_failure' = 'committed';
  deleteStatus: 'deleted' | 'accepted' = 'deleted';

  async assertObjectReady() {
    this.readinessCalls += 1;
    if (this.readinessError) throw this.readinessError;
  }
  async register(input: Parameters<TgserverNativeV1ClientLike['register']>[0]) {
    this.registerCalls.push(input);
    return { objectId: nativeId, state: 'STAGING', currentVersion: 0, duplicate: false };
  }
  async write(input: Parameters<TgserverNativeV1ClientLike['write']>[0]) {
    this.writeCalls.push(input);
    return { status: this.writeStatus, objectId: nativeId, version: 1, logicalBytes: input.fileSize, duplicate: false };
  }
  async read(input: Parameters<TgserverNativeV1ClientLike['read']>[0]) {
    this.readCalls.push(input);
    return new Response('binary');
  }
  async remove(input: Parameters<TgserverNativeV1ClientLike['remove']>[0]) {
    this.removeCalls.push(input);
    return { status: this.deleteStatus, objectId: nativeId, duplicate: false };
  }
}

function putInput(): PersistentObjectPutInput {
  return {
    objectId: 'app-file-123',
    ownerId: 'user-secret-routing-hint',
    fileName: 'a.bin',
    fileSize: 3,
    body: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array([1, 2, 3])); controller.close(); } }),
  };
}

function readInput(): PersistentObjectReadInput {
  return {
    objectId: 'app-file-123',
    ownerId: 'user-secret-routing-hint',
    locator: { kind: 'tgs-native-v1', objectId: nativeId },
    fileName: 'a.bin',
  };
}

function deleteInput(): PersistentObjectDeleteInput {
  return {
    objectId: 'app-file-123',
    ownerId: 'user-secret-routing-hint',
    locator: { kind: 'tgs-native-v1', objectId: nativeId },
  };
}

test('native store checks readiness before first mutation and caches only successful preflight', async () => {
  const client = new FakeClient();
  const store = new TgserverNativeV1ObjectStore(client);
  await store.put(putInput());
  await store.read(readInput());
  await store.delete(deleteInput());
  assert.equal(client.readinessCalls, 1);
});

test('failed readiness blocks Object traffic and can recover on a later request', async () => {
  const client = new FakeClient();
  client.readinessError = new TgserverNativeV1Error('VNEXT_RUNTIME_DISABLED', 503);
  const store = new TgserverNativeV1ObjectStore(client);
  await assert.rejects(() => store.put(putInput()), /VNEXT_RUNTIME_DISABLED/);
  assert.equal(client.registerCalls.length, 0);
  assert.equal(client.writeCalls.length, 0);
  client.readinessError = null;
  await store.put(putInput());
  assert.equal(client.readinessCalls, 2);
  assert.equal(client.registerCalls.length, 1);
});

test('native store keeps App object identity while exposing only TGserver logical object locator', async () => {
  const client = new FakeClient();
  const store = new TgserverNativeV1ObjectStore(client);
  const result = await store.put(putInput());

  assert.equal(result.objectId, 'app-file-123');
  assert.equal(result.protocol, 'tgs-native-v1');
  assert.deepEqual(result.locator, { kind: 'tgs-native-v1', objectId: nativeId });
  assert.equal(result.status, 'committed');
  assert.deepEqual(client.registerCalls.map(({ objectKey, idempotencyKey }) => ({ objectKey, idempotencyKey })), [
    { objectKey: 'app-file-123', idempotencyKey: 'astera-object:register:app-file-123' },
  ]);
  assert.deepEqual(client.writeCalls.map(({ objectId, idempotencyKey }) => ({ objectId, idempotencyKey })), [
    { objectId: nativeId, idempotencyKey: 'astera-object:write:app-file-123' },
  ]);
  assert.equal(JSON.stringify(client.registerCalls).includes('user-secret-routing-hint'), false);
  assert.equal(JSON.stringify(client.writeCalls.map(({ body: _body, ...rest }) => rest)).includes('user-secret-routing-hint'), false);
});

test('native store read/delete never require or expose Telegram physical locators', async () => {
  const client = new FakeClient();
  const store = new TgserverNativeV1ObjectStore(client);
  await store.read(readInput());
  await store.delete(deleteInput());
  assert.deepEqual(client.readCalls, [{ objectId: nativeId }]);
  assert.deepEqual(client.removeCalls, [{ objectId: nativeId, idempotencyKey: 'astera-object:delete:app-file-123' }]);
});

test('native store fails closed while TGserver says write reconciliation is required', async () => {
  const client = new FakeClient();
  client.writeStatus = 'reconciliation_required';
  const store = new TgserverNativeV1ObjectStore(client);
  await assert.rejects(
    () => store.put(putInput()),
    (error: unknown) => error instanceof TgserverNativeV1Error && error.code === 'TGS_NATIVE_OBJECT_RECONCILIATION_REQUIRED' && error.status === 202,
  );
});

test('native store does not report asynchronous delete acceptance as completed deletion', async () => {
  const client = new FakeClient();
  client.deleteStatus = 'accepted';
  const store = new TgserverNativeV1ObjectStore(client);
  await assert.rejects(
    () => store.delete(deleteInput()),
    (error: unknown) => error instanceof TgserverNativeV1Error && error.code === 'TGS_NATIVE_OBJECT_DELETE_PENDING' && error.status === 202,
  );
});

test('native store rejects a legacy physical locator at the Native boundary', () => {
  const client = new FakeClient();
  const store = new TgserverNativeV1ObjectStore(client);
  assert.throws(
    () => store.read({ ...readInput(), locator: { kind: 'tgs-legacy-v15', topicId: 1, messageId: 2, telegramFileId: 'legacy' } }),
    /PERSISTENT_OBJECT_NATIVE_LOCATOR_REQUIRED/,
  );
});
