import assert from 'node:assert/strict';
import test from 'node:test';
import { TgserverLegacyV15ObjectStore, type TgserverLegacyV15ClientLike } from './tgserver-legacy-v15-object-store.js';

function body(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
      controller.close();
    },
  });
}

test('maps legacy upload locator behind PersistentObjectStore', async () => {
  let uploadInput: Parameters<TgserverLegacyV15ClientLike['upload']>[0] | null = null;
  const client: TgserverLegacyV15ClientLike = {
    configured: true,
    async upload(input) {
      uploadInput = input;
      return {
        file_id: 'legacy-file',
        topic_id: 12,
        message_id: 34,
        telegram_file_id: 'telegram-file',
        file_size: 3,
        status: 'stored',
        waited_in_queue: true,
      };
    },
    async download() { return new Response('ok'); },
    async delete() {},
  };

  const store = new TgserverLegacyV15ObjectStore(client);
  const result = await store.put({ objectId: 'obj-1', ownerId: 'user-1', fileName: 'a.txt', fileSize: 3, body: body() });

  assert.equal(store.configured, true);
  assert.equal(uploadInput?.userId, 'user-1');
  assert.deepEqual(result, {
    objectId: 'obj-1',
    protocol: 'tgs-legacy-v15',
    locator: { kind: 'tgs-legacy-v15', topicId: 12, messageId: 34, telegramFileId: 'telegram-file' },
    fileSize: 3,
    status: 'stored',
    waitedInQueue: true,
  });
});

test('legacy read and delete require legacy locator and delegate exact physical reference', async () => {
  const calls: unknown[] = [];
  const client: TgserverLegacyV15ClientLike = {
    configured: true,
    async upload() { throw new Error('unused'); },
    async download(input) { calls.push(['read', input]); return new Response('payload'); },
    async delete(input) { calls.push(['delete', input]); },
  };
  const store = new TgserverLegacyV15ObjectStore(client);
  const locator = { kind: 'tgs-legacy-v15' as const, topicId: 7, messageId: 8, telegramFileId: 'tf-9' };

  const response = await store.read({ objectId: 'obj-2', ownerId: 'user-2', locator, fileName: 'b.bin' });
  assert.equal(await response.text(), 'payload');
  await store.delete({ objectId: 'obj-2', ownerId: 'user-2', locator });

  assert.deepEqual(calls, [
    ['read', { userId: 'user-2', topicId: 7, messageId: 8, telegramFileId: 'tf-9', fileName: 'b.bin', signal: undefined }],
    ['delete', { userId: 'user-2', topicId: 7, messageId: 8, telegramFileId: 'tf-9', signal: undefined }],
  ]);
});

test('legacy adapter fails closed when given a native logical locator', async () => {
  const client: TgserverLegacyV15ClientLike = {
    configured: true,
    async upload() { throw new Error('unused'); },
    async download() { throw new Error('must not call'); },
    async delete() { throw new Error('must not call'); },
  };
  const store = new TgserverLegacyV15ObjectStore(client);
  const locator = { kind: 'tgs-native-v1' as const, objectId: 'obj-native', operationId: 'op-1' };

  await assert.rejects(
    store.read({ objectId: 'obj-native', ownerId: 'user-1', locator, fileName: 'x' }),
    /PERSISTENT_OBJECT_LEGACY_LOCATOR_REQUIRED/,
  );
  await assert.rejects(
    store.delete({ objectId: 'obj-native', ownerId: 'user-1', locator }),
    /PERSISTENT_OBJECT_LEGACY_LOCATOR_REQUIRED/,
  );
});
