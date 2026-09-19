import { FunctionHttpError, type BillingServiceEnv } from '../part/billing-env.js';
import type { LibralVaultClient } from './libral-vault.js';

function required(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new FunctionHttpError(503, `${name}_NOT_CONFIGURED`, `${name}が設定されていません。`);
  return normalized;
}

export async function verifySquareWebhookSignature(
  env: BillingServiceEnv,
  rawBody: string,
  signatureHeader: string | null,
  vault: LibralVaultClient,
): Promise<boolean> {
  if (!signatureHeader?.trim()) return false;
  const notificationUrl = required(env.SQUARE_WEBHOOK_NOTIFICATION_URL, 'SQUARE_WEBHOOK_NOTIFICATION_URL');
  const secretId = required(env.VAULT_SQUARE_WEBHOOK_HMAC_SECRET_ID, 'VAULT_SQUARE_WEBHOOK_HMAC_SECRET_ID');
  const data = `${notificationUrl}${rawBody}`;
  const dataBase64 = Buffer.from(data, 'utf8').toString('base64');
  const result = await vault.hmacVerify({
    secretId,
    dataBase64,
    signature: signatureHeader.trim(),
    encoding: 'base64',
  });
  return result.valid;
}
