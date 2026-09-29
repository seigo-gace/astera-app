import { Hono } from 'hono';
import { constantTimeTokenEqual, type RuntimeConfig } from './config.js';
import { AsteraRuntimeService, createApp } from './index.js';
import { PrivateDataBroker, registerPrivateDataBrokerApi } from './private-data-broker.js';
import { registerPrivateDataMetadataApi } from './private-data-metadata-api.js';
import { registerStorageBinaryApi } from './storage-binary-api.js';
import { VaultClient } from './vault-client.js';

function bearerToken(value: string | undefined): string {
  if (!value?.startsWith('Bearer ')) return '';
  return value.slice('Bearer '.length).trim();
}

export function createFullApp(
  config: RuntimeConfig,
  service = new AsteraRuntimeService(config),
  privateDataBroker = new PrivateDataBroker(config, new VaultClient(config)),
) {
  const app = new Hono();

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

  const runtime = createApp(config, service);
  app.route('/', runtime.app);
  return { app, service, privateDataBroker };
}
