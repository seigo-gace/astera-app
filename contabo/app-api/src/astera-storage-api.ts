import type { Hono } from 'hono';
import type { Pool } from 'pg';
import type { RuntimeConfig } from './config.js';
import { TgserverStorageClient } from './tgserver-storage-client.js';
import { VaultClient } from './vault-client.js';
import type { StorageVaultLike } from './storage-object-crypto.js';
import { registerStorageReadRoutes } from './storage-api-read.js';
import { registerStorageDeleteRoutes } from './storage-api-delete.js';
import { registerStorageUploadRoute } from './storage-api-upload.js';
import { registerStorageDownloadRoute } from './storage-api-download.js';

export function registerAsteraStorageApi(
  app: Hono,
  pool: Pool,
  config: RuntimeConfig,
  tgs = new TgserverStorageClient(config),
  vault: StorageVaultLike = new VaultClient(config),
): void {
  registerStorageReadRoutes(app, pool);
  registerStorageDeleteRoutes(app, pool, config, tgs);
  registerStorageUploadRoute(app, pool, tgs, vault);
  registerStorageDownloadRoute(app, pool, tgs, vault);
}
