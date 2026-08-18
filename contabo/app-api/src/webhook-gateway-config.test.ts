import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

function baseEnv(): NodeJS.ProcessEnv {
  return {
    INTERNAL_SERVICE_TOKEN: 'app-service-token',
    ASTERA_PROCESS_ORIGIN: 'http://127.0.0.1:8787',
    ASTERA_PROCESS_TOKEN: 'runtime-token',
    LIBRAL_VAULT_INTERNAL_ORIGIN: 'http://127.0.0.1:8791',
    LIBRAL_VAULT_INTERNAL_TOKEN: 'vault-token',
    LIBRAL_VAULT_JOB_KEY_REF: 'secret/job',
  };
}

describe('Webhook Gateway App API configuration', () => {
  it('keeps Gateway integration disabled when no origin is configured', () => {
    const config = loadConfig(baseEnv());
    expect(config.webhookGatewayOrigin).toBe('');
    expect(config.webhookGatewayToken).toBe('');
    expect(config.webhookGatewayTimeoutMs).toBe(15_000);
  });

  it('requires the Gateway token only when Gateway origin is enabled', () => {
    expect(() => loadConfig({
      ...baseEnv(),
      WEBHOOK_GATEWAY_INTERNAL_ORIGIN: 'http://127.0.0.1:7373',
    })).toThrow('WEBHOOK_GATEWAY_INTERNAL_TOKEN_NOT_CONFIGURED');
  });

  it('accepts a localhost Gateway origin with server-only token', () => {
    const config = loadConfig({
      ...baseEnv(),
      WEBHOOK_GATEWAY_INTERNAL_ORIGIN: 'http://127.0.0.1:7373',
      WEBHOOK_GATEWAY_INTERNAL_TOKEN: 'gateway-internal-token',
      WEBHOOK_GATEWAY_TIMEOUT_MS: '12000',
    });
    expect(config.webhookGatewayOrigin).toBe('http://127.0.0.1:7373');
    expect(config.webhookGatewayToken).toBe('gateway-internal-token');
    expect(config.webhookGatewayTimeoutMs).toBe(12_000);
  });

  it('rejects an insecure remote Gateway origin', () => {
    expect(() => loadConfig({
      ...baseEnv(),
      WEBHOOK_GATEWAY_INTERNAL_ORIGIN: 'http://webhook.example.test',
      WEBHOOK_GATEWAY_INTERNAL_TOKEN: 'gateway-internal-token',
    })).toThrow('INTERNAL_ORIGIN_HTTPS_REQUIRED');
  });
});
