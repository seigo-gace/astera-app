import test from 'node:test';
import assert from 'node:assert/strict';
import { StorageApiError } from './storage-api-types.js';
import {
  storageBinaryReferenceFields,
  storagePersistentLocatorFromHeaders,
} from './storage-persistent-object-bridge.js';

test('legacy binary reference fields preserve the current physical locator contract', () => {
  assert.deepEqual(storageBinaryReferenceFields({
    kind: 'tgs-legacy-v15',
    topicId: 10,
    messageId: 20,
    telegramFileId: 'file-ref',
  }), {
    tgs_profile: 'legacy_v15',
    topic_id: '10',
    message_id: '20',
    telegram_file_id: 'file-ref',
  });
});

test('native binary reference fields expose only logical TGserver identity', () => {
  assert.deepEqual(storageBinaryReferenceFields({
    kind: 'tgs-native-v1',
    objectId: '11111111-1111-4111-8111-111111111111',
    operationId: 'operation-1',
  }), {
    tgs_profile: 'native_v1',
    tgs_object_ref: '11111111-1111-4111-8111-111111111111',
    tgs_operation_id: 'operation-1',
  });
});

test('missing profile remains backward compatible with legacy internal headers', () => {
  const headers = new Headers({
    'x-astera-topic-id': '10',
    'x-astera-message-id': '20',
    'x-astera-telegram-file-id': 'file-ref',
  });
  assert.deepEqual(storagePersistentLocatorFromHeaders(headers), {
    kind: 'tgs-legacy-v15',
    topicId: 10,
    messageId: 20,
    telegramFileId: 'file-ref',
  });
});

test('native profile reads logical locator without requiring Telegram physical headers', () => {
  const headers = new Headers({
    'x-astera-tgs-profile': 'native_v1',
    'x-astera-tgs-object-ref': '11111111-1111-4111-8111-111111111111',
    'x-astera-tgs-operation-id': 'operation-1',
  });
  assert.deepEqual(storagePersistentLocatorFromHeaders(headers), {
    kind: 'tgs-native-v1',
    objectId: '11111111-1111-4111-8111-111111111111',
    operationId: 'operation-1',
  });
});

test('unknown TGserver profile fails closed', () => {
  assert.throws(
    () => storagePersistentLocatorFromHeaders(new Headers({ 'x-astera-tgs-profile': 'future_v2' })),
    (error: unknown) => error instanceof StorageApiError && error.code === 'STORAGE_TGS_PROFILE_INVALID',
  );
});

test('native profile requires a logical object reference', () => {
  assert.throws(
    () => storagePersistentLocatorFromHeaders(new Headers({ 'x-astera-tgs-profile': 'native_v1' })),
    (error: unknown) => error instanceof StorageApiError && error.code === 'STORAGE_TGS_OBJECT_REF_REQUIRED',
  );
});
