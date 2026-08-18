import type { Context, Hono } from 'hono';
import type { RuntimeConfig } from './config.js';
import { WebhookGatewayError } from './webhook-gateway-client.js';
import {
  WebhookGatewayProvisioningClient,
  type ManagedWebhookDestinationInput,
  type ManagedWebhookRouteInput,
  type ManagedWebhookSourceInput,
} from './webhook-gateway-provisioning-client.js';

const opaqueIdPattern = /^[A-Za-z0-9._:/-]{1,160}$/;

export function registerWebhookGatewayConfigApi(
  app: Hono,
  config: RuntimeConfig,
  client: WebhookGatewayProvisioningClient | null = WebhookGatewayProvisioningClient.fromConfig(config),
): void {
  app.get('/api/webhook/config/sources', async (context) => proxy(context, client, () => client!.listSources()));
  app.get('/api/webhook/config/destinations', async (context) => proxy(context, client, () => client!.listDestinations()));
  app.get('/api/webhook/config/routes', async (context) => proxy(context, client, () => client!.listRoutes()));

  app.put('/api/webhook/config/sources/:id', async (context) => {
    if (!client) return notConfigured(context);
    const id = context.req.param('id');
    if (!opaqueIdPattern.test(id)) return invalidId(context);
    const body = await parseJsonObject(context);
    if (!body.ok) return body.response;
    try {
      return context.json(await client.upsertSource(id, body.value as ManagedWebhookSourceInput), 200);
    } catch (error) { return gatewayError(context, error); }
  });

  app.put('/api/webhook/config/destinations/:id', async (context) => {
    if (!client) return notConfigured(context);
    const id = context.req.param('id');
    if (!opaqueIdPattern.test(id)) return invalidId(context);
    const body = await parseJsonObject(context);
    if (!body.ok) return body.response;
    try {
      return context.json(await client.upsertDestination(id, body.value as ManagedWebhookDestinationInput), 200);
    } catch (error) { return gatewayError(context, error); }
  });

  app.put('/api/webhook/config/routes/:id', async (context) => {
    if (!client) return notConfigured(context);
    const id = context.req.param('id');
    if (!opaqueIdPattern.test(id)) return invalidId(context);
    const body = await parseJsonObject(context);
    if (!body.ok) return body.response;
    try {
      return context.json(await client.upsertRoute(id, body.value as ManagedWebhookRouteInput), 200);
    } catch (error) { return gatewayError(context, error); }
  });
}

async function proxy(context: Context, client: WebhookGatewayProvisioningClient | null, action: () => Promise<unknown>) {
  if (!client) return notConfigured(context);
  try { return context.json(await action(), 200); }
  catch (error) { return gatewayError(context, error); }
}

async function parseJsonObject(context: Context): Promise<
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; response: Response }
> {
  try {
    const value = await context.req.json();
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false, response: invalidBody(context) };
    }
    return { ok: true, value: value as Record<string, unknown> };
  } catch {
    return { ok: false, response: invalidBody(context) };
  }
}

function notConfigured(context: Context) {
  return context.json({
    error: {
      code: 'WEBHOOK_GATEWAY_PROVISIONING_NOT_CONFIGURED',
      message: 'Webhook Gateway設定変更用のServer接続がまだ有効ではありません。',
      retryable: false,
    },
  }, 503);
}

function invalidId(context: Context) {
  return context.json({
    error: {
      code: 'WEBHOOK_GATEWAY_INVALID_CONFIG_ID',
      message: 'Webhook設定IDの形式が正しくありません。',
      retryable: false,
    },
  }, 400);
}

function invalidBody(context: Context) {
  return context.json({
    error: {
      code: 'WEBHOOK_GATEWAY_INVALID_CONFIG_BODY',
      message: 'Webhook設定内容をJSON objectとして確認できません。',
      retryable: false,
    },
  }, 400);
}

function gatewayError(context: Context, error: unknown) {
  if (!(error instanceof WebhookGatewayError)) {
    return context.json({
      error: {
        code: 'WEBHOOK_GATEWAY_PROVISIONING_UNEXPECTED_ERROR',
        message: 'Webhook Gateway設定変更中に予期しないエラーが発生しました。',
        retryable: true,
      },
    }, 503);
  }
  const body = { error: { code: error.code, message: error.message, retryable: error.retryable } };
  switch (error.status) {
    case 400: return context.json(body, 400);
    case 404: return context.json(body, 404);
    case 409: return context.json(body, 409);
    case 413: return context.json(body, 413);
    case 422: return context.json(body, 422);
    case 429: return context.json(body, 429);
    case 502: return context.json(body, 502);
    default: return context.json(body, 503);
  }
}
