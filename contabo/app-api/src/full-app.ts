import { Hono } from 'hono';
import { constantTimeTokenEqual, type RuntimeConfig } from './config.js';
import { AsteraRuntimeService, createApp } from './index.js';
import { registerWorkspaceApi } from './workspace-api.js';
import { registerAsteraStorageApi } from './astera-storage-api.js';

function bearerToken(value: string | undefined): string {
  if (!value?.startsWith('Bearer ')) return '';
  return value.slice('Bearer '.length).trim();
}

export function createFullApp(config: RuntimeConfig, service = new AsteraRuntimeService(config)) {
  const app = new Hono();

  app.use('/api/*', async (context, next) => {
    const token = bearerToken(context.req.header('authorization'));
    if (!token || !constantTimeTokenEqual(token, config.internalServiceToken)) {
      return context.json({ error: { code: 'APP_API_AUTHENTICATION_FAILED', message: 'App API Service Tokenを確認できません。' } }, 401);
    }
    await next();
  });

  // Remaining Workspace/Storage compatibility routes stay registered until each
  // consumer is migrated. Project authorization for new Jobs is owned by D1.
  registerWorkspaceApi(app, { database: service.database, config });
  registerAsteraStorageApi(app, service.database.pool, config);

  const runtime = createApp(config, service);
  app.route('/', runtime.app);
  return { app, service };
}
