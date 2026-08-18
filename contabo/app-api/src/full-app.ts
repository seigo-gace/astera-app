import { Hono } from 'hono';
import { constantTimeTokenEqual, type RuntimeConfig } from './config.js';
import { AsteraRuntimeService, createApp } from './index.js';
import { registerStorageBinaryApi } from './storage-binary-api.js';
import { registerWebhookGatewayApi } from './webhook-gateway-api.js';

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

  // Account/Workspace persistent routes terminate in Cloudflare D1.
  // Contabo exposes runtime execution, internal Storage Binary routes, and the
  // server-only Webhook Gateway proxy. Customer/tenant authorization stays in
  // the Cloudflare/App control plane before it reaches these protected routes.
  registerStorageBinaryApi(app, config);
  registerWebhookGatewayApi(app, config);

  const runtime = createApp(config, service);
  app.route('/', runtime.app);
  return { app, service };
}
