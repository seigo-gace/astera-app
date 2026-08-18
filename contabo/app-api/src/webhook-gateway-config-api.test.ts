import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import type { RuntimeConfig } from './config.js';
import { registerWebhookGatewayConfigApi } from './webhook-gateway-config-api.js';
import { WebhookGatewayProvisioningClient } from './webhook-gateway-provisioning-client.js';

function config(): RuntimeConfig {
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
    webhookGatewayOrigin: 'http://127.0.0.1:7373',
    webhookGatewayToken: 'event-secret',
    webhookGatewayProvisionToken: 'provision-secret',
    webhookGatewayTimeoutMs: 15_000,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('Webhook Gateway configuration proxy', () => {
  it('fails closed when provisioning is not configured', async () => {
    const app = new Hono();
    registerWebhookGatewayConfigApi(app, { ...config(), webhookGatewayProvisionToken: '' });
    const response = await app.request('/api/webhook/config/sources');
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'WEBHOOK_GATEWAY_PROVISIONING_NOT_CONFIGURED' },
    });
  });

  it('proxies a destination update without placing Gateway credentials in the browser payload', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get('authorization')).toBe('Bearer provision-secret');
      expect(JSON.parse(String(init?.body))).toEqual({
        appId: 'opaque-control-plane-id',
        name: 'Receiver',
        url: 'https://customer.example/webhook',
        enabled: true,
      });
      return json({ destination: { id: 'dst-1', signingSecretConfigured: false } });
    });
    const client = WebhookGatewayProvisioningClient.fromConfig(config(), fetchImpl as unknown as typeof fetch)!;
    const app = new Hono();
    registerWebhookGatewayConfigApi(app, config(), client);

    const response = await app.request('/api/webhook/config/destinations/dst-1', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        appId: 'opaque-control-plane-id',
        name: 'Receiver',
        url: 'https://customer.example/webhook',
        enabled: true,
      }),
    });
    expect(response.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid opaque ids locally before provisioning request', async () => {
    const fetchImpl = vi.fn(async () => json({}));
    const client = WebhookGatewayProvisioningClient.fromConfig(config(), fetchImpl as unknown as typeof fetch)!;
    const app = new Hono();
    registerWebhookGatewayConfigApi(app, config(), client);
    const response = await app.request('/api/webhook/config/routes/%20bad%20', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(response.status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('maps Gateway validation errors through the protected App API boundary', async () => {
    const client = WebhookGatewayProvisioningClient.fromConfig(
      config(),
      (async () => json({ error: 'unsafe destination URL' }, 422)) as typeof fetch,
    )!;
    const app = new Hono();
    registerWebhookGatewayConfigApi(app, config(), client);
    const response = await app.request('/api/webhook/config/destinations/dst-1', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ appId: 'control-plane', name: 'Unsafe', url: 'http://127.0.0.1', enabled: true }),
    });
    expect(response.status).toBe(422);
  });
});
