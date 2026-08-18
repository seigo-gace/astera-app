import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import type { RuntimeConfig } from './config.js';
import { registerWebhookGatewayApi } from './webhook-gateway-api.js';
import { WebhookGatewayClient } from './webhook-gateway-client.js';

function baseConfig(overrides: Partial<RuntimeConfig> = {}): RuntimeConfig {
  return {
    port: 8788,
    internalServiceToken: 'app-service-token',
    processOrigin: 'http://127.0.0.1:8787',
    processToken: 'runtime-token',
    processTimeoutMs: 120_000,
    shutdownTimeoutMs: 20_000,
    vaultOrigin: 'http://127.0.0.1:8791',
    vaultServiceToken: 'vault-token',
    vaultJobKeyRef: 'secret/job',
    vaultTimeoutMs: 15_000,
    translationModelId: '',
    translationGeminiKeyRef: '',
    translationTimeoutMs: 90_000,
    tgserverStorageOrigin: '',
    tgserverStorageToken: '',
    tgserverStorageTimeoutMs: 600_000,
    webhookGatewayOrigin: '',
    webhookGatewayToken: '',
    webhookGatewayTimeoutMs: 15_000,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('Webhook Gateway App API proxy', () => {
  it('fails closed without Gateway server configuration and does not affect other App routes', async () => {
    const app = new Hono();
    app.get('/unrelated', (context) => context.json({ ok: true }));
    registerWebhookGatewayApi(app, baseConfig());

    const unavailable = await app.request('/api/webhook/events');
    expect(unavailable.status).toBe(503);
    await expect(unavailable.json()).resolves.toMatchObject({
      error: { code: 'WEBHOOK_GATEWAY_NOT_CONFIGURED' },
    });

    const unrelated = await app.request('/unrelated');
    expect(unrelated.status).toBe(200);
  });

  it('proxies submit through the server client and returns Gateway acceptance', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      ok: true,
      duplicate: false,
      eventId: '4ba9a4d1-0000-4000-8000-000000000001',
      deliveryIds: ['4ba9a4d1-0000-4000-8000-000000000002'],
      deliveries: 1,
      enqueueMode: 'deferred+outbox',
    }, 202));
    const client = new WebhookGatewayClient(
      'https://webhook.asterav8.jp',
      'gateway-secret',
      5_000,
      fetchImpl as unknown as typeof fetch,
    );
    const app = new Hono();
    registerWebhookGatewayApi(app, baseConfig(), client);

    const response = await app.request('/api/webhook/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        eventId: 'evt-1',
        eventType: 'astera.test',
        sourceId: 'source-1',
        destinationId: 'app-receiver',
        data: { token: 'business-value' },
      }),
    });
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      deliveries: 1,
    });
  });

  it('rejects malformed proxy input before calling the Gateway', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true }));
    const client = new WebhookGatewayClient(
      'https://webhook.asterav8.jp',
      'gateway-secret',
      5_000,
      fetchImpl as unknown as typeof fetch,
    );
    const app = new Hono();
    registerWebhookGatewayApi(app, baseConfig(), client);

    const response = await app.request('/api/webhook/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ eventId: 'evt-1' }),
    });
    expect(response.status).toBe(422);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects malformed Gateway event ids locally', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}));
    const client = new WebhookGatewayClient(
      'https://webhook.asterav8.jp',
      'gateway-secret',
      5_000,
      fetchImpl as unknown as typeof fetch,
    );
    const app = new Hono();
    registerWebhookGatewayApi(app, baseConfig(), client);

    const response = await app.request('/api/webhook/events/not-a-uuid');
    expect(response.status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
