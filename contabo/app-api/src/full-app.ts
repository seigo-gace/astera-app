import { Hono } from 'hono';
import { constantTimeTokenEqual, type RuntimeConfig } from './config.js';
import { AsteraRuntimeService, createApp, type RuntimeCreateRequest } from './index.js';
import { assertProjectAccess, registerWorkspaceApi } from './workspace-api.js';
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

  // Temporary compatibility gate while remaining Workspace/Storage consumers are
  // migrated to Account/Tenant-owned Cloudflare D1. This must not persist Result data.
  app.use('/internal/v1/jobs', async (context, next) => {
    if (context.req.method !== 'POST') {
      await next();
      return;
    }
    const token = bearerToken(context.req.header('authorization'));
    if (!token || !constantTimeTokenEqual(token, config.internalServiceToken)) {
      return context.json({ error: { code: 'INTERNAL_AUTHENTICATION_FAILED', message: 'Internal Service Tokenを確認できません。' } }, 401);
    }
    const payload = await context.req.raw.clone().json().catch(() => null) as Partial<RuntimeCreateRequest> | null;
    if (payload?.project_id) {
      if (!payload.tenant_id || !payload.user_id) {
        return context.json({ error: { code: 'PROJECT_ACTOR_CONTEXT_REQUIRED', message: 'Project検証にTenant／Userが必要です。' } }, 422);
      }
      try {
        await assertProjectAccess(service.database.pool, payload.tenant_id, payload.user_id, payload.project_id, 'editor');
      } catch (error) {
        return context.json({ error: { code: 'PROJECT_ACCESS_DENIED', message: error instanceof Error ? error.message : 'ProjectへのAccess権がありません。' } }, 403);
      }
    }
    await next();
  });

  registerWorkspaceApi(app, { database: service.database, config });
  registerAsteraStorageApi(app, service.database.pool, config);

  const runtime = createApp(config, service);
  app.route('/', runtime.app);
  return { app, service };
}
