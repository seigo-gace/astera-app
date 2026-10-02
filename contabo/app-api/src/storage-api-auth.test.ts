import test from 'node:test';
import assert from 'node:assert/strict';
import { responseError } from './storage-api-auth.js';
import { TgserverNativeV1Error } from './tgserver-native-v1-client.js';

test('native TGserver errors are normalized without leaking provider details', async () => {
  const response = responseError(new TgserverNativeV1Error('TGS_NATIVE_OBJECT_UNAVAILABLE', 502), 'request-1');
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), {
    error: {
      code: 'TGS_NATIVE_OBJECT_UNAVAILABLE',
      message: 'TGS_NATIVE_OBJECT_UNAVAILABLE',
      correlation_id: 'request-1',
      retryable: true,
    },
  });
});
