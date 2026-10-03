import type { RuntimeConfig } from './config.js';
import type { PersistentObjectStore } from './persistent-object-store.js';
import { TgserverLegacyV15ObjectStore } from './tgserver-legacy-v15-object-store.js';
import { TgserverNativeV1Client } from './tgserver-native-v1-client.js';
import { TgserverNativeV1ObjectStore } from './tgserver-native-v1-object-store.js';
import { TgserverStorageClient } from './tgserver-storage-client.js';

export function createPersistentStorageStore(config: RuntimeConfig): PersistentObjectStore {
  const profile = config.tgserverStorageProfile ?? 'legacy_v15';
  if (profile === 'legacy_v15') {
    return new TgserverLegacyV15ObjectStore(new TgserverStorageClient(config));
  }

  const origin = config.tgserverNativeV1Origin?.trim() || '';
  const token = config.tgserverNativeV1Token?.trim() || '';
  const timeoutMs = config.tgserverNativeV1TimeoutMs ?? config.tgserverStorageTimeoutMs;
  if (!origin || !token) throw new Error('TGS_NATIVE_V1_RUNTIME_NOT_CONFIGURED');

  return new TgserverNativeV1ObjectStore(new TgserverNativeV1Client({ origin, token, timeoutMs }));
}
