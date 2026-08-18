import { describe, expect, it, vi } from 'vitest';
import type { RuntimeConfig } from './config.js';
import { WebhookGatewayProvisioningClient } from './webhook-gateway-provisioning-client.js';

function config(provisionToken = 'provision-secret'): RuntimeConfig {
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
    webhookGatewayProvisionToken: provisionToken,
    webhookGatewayTimeoutMs: 15_000,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('WebhookGatewayProvisioningClient', () => {
  it('is disabled independently when only the event credential is configured', () => {
    expect(WebhookGatewayProvisioningClient.fromConfig(config(''))).toBeNull();
  });

  it('uses the provisioning credential and never the event credential', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe('http://127.0.0.1:7373/internal/config/destinations/dst-1');
      const headers = new Headers(init?.headers);
      expect(headers.get('authorization')).toBe('Bearer provision-secret');
      expect(headers.get('authorization')).not.toContain('event-secret');
      return json({ destination: { id: 'dst-1', signingSecretConfigured: true } });
    });
    const client = WebhookGatewayProvisioningClient.fromConfig(config(), fetchImpl as unknown as typeof fetch)!;
    await client.upsertDestination('dst-1', {
      appId: 'control-plane',
      name: 'Customer receiver',
      url: 'https://customer.example/webhook',
      enabled: true,
      signingSecret: 'customer-signing-secret',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('maps provisioning authentication failure to a server configuration error', async () => {
    const client = WebhookGatewayProvisioningClient.fromConfig(
      config(),
      (async () => json({ error: 'unauthorized' }, 401)) as typeof fetch,
    )!;
    await expect(client.listSources()).rejects.toMatchObject({
      status: 503,
      code: 'WEBHOOK_GATEWAY_PROVISIONING_AUTHENTICATION_FAILED',
      retryable: false,
    });
  });

  it('preserves Gateway validation errors without exposing provisioning token text', async () => {
    const client = WebhookGatewayProvisioningClient.fromConfig(
      config('very-secret-provision-token'),
      (async () => json({ error: 'unsafe destination URL' }, 422)) as typeof fetch,
    )!;
    try {
      await client.upsertDestination('dst-1', {
        appId: 'control-plane',
        name: 'Unsafe',
        url: 'http://127.0.0.1/private',
        enabled: true,
      });
      throw new Error('expected failure');
    } catch (error) {
      expect(error).toMatchObject({ status: 422, code: 'WEBHOOK_GATEWAY_PROVISIONING_FAILED' });
      expect(String((error as Error).message)).not.toContain('very-secret-provision-token');
    }
  });
});
