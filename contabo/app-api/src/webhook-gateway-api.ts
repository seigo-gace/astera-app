import type { Context, Hono } from 'hono';
import type { RuntimeConfig } from './config.js';
import {
  WebhookGatewayClient,
  WebhookGatewayError,
  type WebhookGatewaySubmitRequest,
} from './webhook-gateway-client.js';

const gatewayEventIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function registerWebhookGatewayApi(
  app: Hono,
  config: RuntimeConfig,
  client: WebhookGatewayClient | null = WebhookGatewayClient.fromConfig(config),
): void {
  app.post('/api/webhook/events', async (context) => {
    if (!client) return notConfigured(context);

    let body: unknown;
    try {
      body = await context.req.json();
    } catch {
      return context.json({
        error: {
          code: 'WEBHOOK_GATEWAY_INVALID_REQUEST',
          message: 'Webhook送信内容をJSONとして確認できません。',
          retryable: false,
        },
      }, 400);
    }

    if (!isSubmitRequest(body)) {
      return context.json({
        error: {
          code: 'WEBHOOK_GATEWAY_INVALID_REQUEST',
          message: 'Webhook送信内容の必須項目を確認できません。',
          retryable: false,
        },
      }, 422);
    }

    try {
      return context.json(await client.submit(body), 202);
    } catch (error) {
      return gatewayError(context, error);
    }
  });

  app.get('/api/webhook/events', async (context) => {
    if (!client) return notConfigured(context);
    const sourceId = context.req.query('sourceId')?.trim() || undefined;
    const limitRaw = context.req.query('limit');
    const limit = limitRaw === undefined ? undefined : Number(limitRaw);
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 200)) {
      return context.json({
        error: {
          code: 'WEBHOOK_GATEWAY_INVALID_REQUEST',
          message: 'limitは1から200の整数で指定してください。',
          retryable: false,
        },
      }, 422);
    }

    try {
      return context.json(await client.list(sourceId, limit), 200);
    } catch (error) {
      return gatewayError(context, error);
    }
  });

  app.get('/api/webhook/events/:eventId', async (context) => {
    if (!client) return notConfigured(context);
    const eventId = context.req.param('eventId');
    if (!gatewayEventIdPattern.test(eventId)) {
      return context.json({
        error: {
          code: 'WEBHOOK_GATEWAY_INVALID_EVENT_ID',
          message: 'Webhook Event IDの形式が正しくありません。',
          retryable: false,
        },
      }, 400);
    }

    try {
      return context.json(await client.detail(eventId), 200);
    } catch (error) {
      return gatewayError(context, error);
    }
  });
}

function isSubmitRequest(value: unknown): value is WebhookGatewaySubmitRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const requiredStrings = ['eventId', 'eventType', 'sourceId', 'destinationId'] as const;
  if (!requiredStrings.every((key) => typeof record[key] === 'string' && String(record[key]).trim().length > 0)) {
    return false;
  }
  return Object.prototype.hasOwnProperty.call(record, 'data');
}

function notConfigured(context: Context) {
  return context.json({
    error: {
      code: 'WEBHOOK_GATEWAY_NOT_CONFIGURED',
      message: 'Webhook GatewayのServer接続設定がまだ有効ではありません。',
      retryable: false,
    },
  }, 503);
}

function gatewayError(context: Context, error: unknown) {
  if (!(error instanceof WebhookGatewayError)) {
    return context.json({
      error: {
        code: 'WEBHOOK_GATEWAY_UNEXPECTED_ERROR',
        message: 'Webhook Gatewayとの通信中に予期しないエラーが発生しました。',
        retryable: true,
      },
    }, 503);
  }

  const body = {
    error: {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
    },
  };
  switch (error.status) {
    case 400: return context.json(body, 400);
    case 401: return context.json(body, 401);
    case 403: return context.json(body, 403);
    case 404: return context.json(body, 404);
    case 413: return context.json(body, 413);
    case 422: return context.json(body, 422);
    case 429: return context.json(body, 429);
    case 502: return context.json(body, 502);
    default: return context.json(body, 503);
  }
}
