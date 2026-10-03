import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from './config.js';
import { createPersistentStorageStore } from './storage-runtime-store.js';
import { TgserverLegacyV15ObjectStore } from './tgserver-legacy-v15-object-store.js';
import { TgserverNativeV1ObjectStore } from './tgserver-native-v1-object-store.js';

const baseEnv: NodeJS.ProcessEnv = {
  INTERNAL_SERVICE_TOKEN: 'internal-test-token',
  ASTERA_PROCESS_ORIGIN: 'http://127.0.0.1:8789',
  ASTERA_PROCESS_TOKEN: 'process-test-token',
  LIBRAL_VAULT_INTERNAL_ORIGIN: 'http://127.0.0.1:8791',
  LIBRAL_VAULT_INTERNAL_TOKEN: 'vault-test-token',
  LIBRAL_VAULT_JOB_KEY_REF: 'vault/jobs/test',
  TGS_STORAGE_INTERNAL_ORIGIN: 'http://tgserver-legacy:3000',
  TGS_STORAGE_INTERNAL_TOKEN: 'legacy-test-token',
};

test('storage runtime profile defaults to legacy_v15 without new Native configuration', () => {
  const config = loadConfig({ ...baseEnv });
  assert.equal(config.tgserverStorageProfile, 'legacy_v15');
  const store = createPersistentStorageStore(config);
  assert.ok(store instanceof TgserverLegacyV15ObjectStore);
  assert.equal(store.configured, true);
});

test('native_v1 selection uses only explicit Native v1 runtime configuration', () => {
  const config = loadConfig({
    ...baseEnv,
    TGS_STORAGE_PROFILE: 'native_v1',
    TGS_NATIVE_V1_INTERNAL_ORIGIN: 'http://tgserver-vnext:8080',
    TGS_NATIVE_V1_SCOPED_TOKEN: 'native-scoped-token',
    TGS_NATIVE_V1_TIMEOUT_MS: '120000',
  });
  assert.equal(config.tgserverStorageProfile, 'native_v1');
  assert.equal(config.tgserverNativeV1Origin, 'http://tgserver-vnext:8080');
  assert.equal(config.tgserverNativeV1Token, 'native-scoped-token');
  assert.equal(config.tgserverNativeV1TimeoutMs, 120000);
  const store = createPersistentStorageStore(config);
  assert.ok(store instanceof TgserverNativeV1ObjectStore);
  assert.equal(store.configured, true);
});

test('native_v1 selection fails closed when Native endpoint or scoped token is missing', () => {
  assert.throws(
    () => loadConfig({ ...baseEnv, TGS_STORAGE_PROFILE: 'native_v1' }),
    /TGS_NATIVE_V1_INTERNAL_ORIGIN_NOT_CONFIGURED/,
  );
  assert.throws(
    () => loadConfig({
      ...baseEnv,
      TGS_STORAGE_PROFILE: 'native_v1',
      TGS_NATIVE_V1_INTERNAL_ORIGIN: 'http://tgserver-vnext:8080',
    }),
    /TGS_NATIVE_V1_SCOPED_TOKEN_NOT_CONFIGURED/,
  );
});

test('unknown storage runtime profile is rejected instead of falling back silently', () => {
  assert.throws(
    () => loadConfig({ ...baseEnv, TGS_STORAGE_PROFILE: 'future_unknown' }),
    /TGS_STORAGE_PROFILE_INVALID/,
  );
});
