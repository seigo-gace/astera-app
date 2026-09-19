import { describe, expect, it, vi } from 'vitest';
import { verifySquareWebhookSignature } from '../dist/feature/square-webhook-verify.js';
import type { BillingServiceEnv } from '../dist/part/billing-env.js';
import type { LibralVaultClient } from '../dist/feature/libral-vault.js';

const PUBLIC_URL = 'https://api.asterav8.jp/billing/webhooks/square';

describe('square webhook signature preimage', () => {
  it('uses public notification URL concatenated with raw body', async () => {
    const rawBody = '{"event_id":"evt-1"}';
    const hmacVerify = vi.fn().mockResolvedValue({ valid: true });
    const vault = { hmacVerify, actionsHttp: vi.fn() } as unknown as LibralVaultClient;
    const env: BillingServiceEnv = {
      SQUARE_WEBHOOK_NOTIFICATION_URL: PUBLIC_URL,
      VAULT_SQUARE_WEBHOOK_HMAC_SECRET_ID: 'hmac-id',
      ASTERA_DB: {} as BillingServiceEnv['ASTERA_DB'],
      vault,
    };
    await verifySquareWebhookSignature(env, rawBody, 'sig', vault);
    expect(hmacVerify).toHaveBeenCalledTimes(1);
    const call = hmacVerify.mock.calls[0]![0] as { dataBase64: string };
    const preimage = Buffer.from(call.dataBase64, 'base64').toString('utf8');
    expect(preimage).toBe(`${PUBLIC_URL}${rawBody}`);
    expect(PUBLIC_URL).toBe('https://api.asterav8.jp/billing/webhooks/square');
  });
});
