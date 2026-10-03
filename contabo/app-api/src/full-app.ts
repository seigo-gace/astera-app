import { Hono } from 'hono';
import { constantTimeTokenEqual, type RuntimeConfig } from './config.js';
import { AsteraRuntimeService, createApp } from './index.js';
import { PrivateDataBroker, registerPrivateDataBrokerApi } from './private-data-broker.js';
import { PrivateFileMaterializer, PrivateFileMaterializerError } from './private-file-materializer.js';
import { PrivateMaterializingRuntimeService } from './private-materializing-runtime-service.js';
import { registerPrivateDataMetadataApi } from './private-data-metadata-api.js';
import { registerStorageBinaryApi } from './storage-binary-api.js';
import { createPersistentStorageStore } from './storage-runtime-store.js';
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

  // Scanner/Extractor/OCR product selection is an explicit architecture gate.
  // Until that authority is decided, the default runtime must fail closed rather
  // than silently adopting a candidate product such as ClamAV/Tika/Tesseract.
  const unavailableScanner = {
    scan: async () => {
      throw new PrivateFileMaterializerError(
        'PRIVATE_PIPELINE_UNAVAILABLE',
        'Private malware scanner runtime has not been selected and connected.',
        true,
      );
    },
  };

  const runtimeService = service ?? new PrivateMaterializingRuntimeService(
    config,
    new PrivateFileMaterializer(
      privateDataBroker,
      unavailableScanner,
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
  registerStorageBinaryApi(app, config, createPersistentStorageStore(config));
  registerPrivateDataBrokerApi(app, privateDataBroker);
  registerPrivateDataMetadataApi(app, config);

  const runtime = createApp(config, runtimeService);
  app.route('/', runtime.app);
  return { app, service: runtimeService, privateDataBroker };
}
