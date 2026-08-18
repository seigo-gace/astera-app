import { describe, expect, it } from 'vitest';
import type { RuntimeConfig } from './config.js';
import { createFullApp } from './full-app.js';

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
    webhookGatewayOrigin: '',
    webhookGatewayToken: '',
    webhookGatewayTimeoutMs: 15_000,
  };
}

describe('Webhook Gateway proxy authentication boundary', () => {
  it('rejects unauthenticated browser-style access before Gateway route handling', async () => {
    const { app } = createFullApp(config());
    const response = await app.request('/api/webhook/events');
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'APP_API_AUTHENTICATION_FAILED' },
    });
  });

  it('allows the trusted App control plane through service auth, then fails closed if Gateway is not configured', async () => {
    const { app } = createFullApp(config());
    const response = await app.request('/api/webhook/events', {
      headers: { authorization: 'Bearer app-service-token' },
    });
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'WEBHOOK_GATEWAY_NOT_CONFIGURED' },
    });
  });
});
