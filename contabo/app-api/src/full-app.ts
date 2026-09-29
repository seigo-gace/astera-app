import { Hono } from 'hono';
import { ClamAvStreamClient } from './clamav-stream-client.js';
import { constantTimeTokenEqual, type RuntimeConfig } from './config.js';
import { AsteraRuntimeService, createApp } from './index.js';
import { PrivateDataBroker, registerPrivateDataBrokerApi } from './private-data-broker.js';
import { PrivateFileMaterializer } from './private-file-materializer.js';
import { PrivateMaterializingRuntimeService } from './private-materializing-runtime-service.js';
import { registerPrivateDataMetadataApi } from './private-data-metadata-api.js';
import { registerStorageBinaryApi } from './storage-binary-api.js';
import { VaultClient } from './vault-client.js';

function bearerToken(value: string | undefined): string {
  if (!value?.startsWith('Bearer ')) return '';
  return value.slice('Bearer '.length).trim();
}

export function createFullApp(
  config: RuntimeConfig,
  service?: AsteraRuntimeService,
  privateDataBroker = new PrivateDataBroker(config, new VaultClient(config)),
) {
  const app = new Hono();
  const destroyPrivateObject = async ({ objectId, tenantId, userId }: { objectId: string; tenantId: string; userId: string }) => {
    await privateDataBroker.destroyObject(objectId, tenantId, userId);
  };

  const runtimeService = service ?? new PrivateMaterializingRuntimeService(
    config,
    new PrivateFileMaterializer(
      privateDataBroker,
      new ClamAvStreamClient({
        host: config.clamavHost?.trim() || '',
        port: config.clamavPort ?? 3310,
        timeoutMs: config.clamavTimeoutMs ?? 30_000,
      }),
      {
        version: config.fileSecurityPolicyVersion?.trim() || '',
        maxExtractedTextBytes: config.fileSecurityMaxExtractedTextBytes ?? 0,
      },
    ),
    destroyPrivateObject,
  );

  if (service) runtimeService.bindPrivateObjectDestroyer(destroyPrivateObject);

  app.use('/api/*', async (context, next) => {
    const token = bearerToken(context.req.header('authorization'));
    if (!token || !constantTimeTokenEqual(token, config.internalServiceToken)) {
      return context.json({ error: { code: 'APP_API_AUTHENTICATION_FAILED', message: 'App API Service Tokenを確認できません。' } }, 401);
    }
    await next();
  });

  // Account/Workspace persistent routes terminate in Cloudflare D1.
  // Contabo exposes runtime execution, normal Storage Binary, and the isolated
  // Private temporary-object broker. Private objects never use the normal lane.
  registerStorageBinaryApi(app, config);
  registerPrivateDataBrokerApi(app, privateDataBroker);
  registerPrivateDataMetadataApi(app, config);

  const runtime = createApp(config, runtimeService);
  app.route('/', runtime.app);
  return { app, service: runtimeService, privateDataBroker };
}
