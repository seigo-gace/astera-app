import { FunctionHttpError, type AsteraActorProjection } from './_account-projection';
import { maskedRewardCode, rewardCodeDigest, type RewardProgramEnv } from './_reward-programs';

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function base64UrlDecode(value: string): Uint8Array {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function encryptionKey(env: RewardProgramEnv): Promise<CryptoKey> {
  const secret = env.BETTER_AUTH_SECRET?.trim();
  if (!secret || secret.length < 32) throw new FunctionHttpError(503, 'REFERRAL_KEY_UNAVAILABLE', '紹介コード暗号化Keyを利用できません。');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`astera:referral-code-encryption:v1:${secret}`));
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function encryptCode(env: RewardProgramEnv, code: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await encryptionKey(env), new TextEncoder().encode(code));
  return `v1.${base64UrlEncode(iv)}.${base64UrlEncode(new Uint8Array(ciphertext))}`;
}

async function decryptCode(env: RewardProgramEnv, encrypted: string): Promise<string> {
  const [version, ivRaw, cipherRaw] = encrypted.split('.');
  if (version !== 'v1' || !ivRaw || !cipherRaw) throw new FunctionHttpError(500, 'REFERRAL_CODE_CIPHERTEXT_INVALID', '紹介コードを復元できませんでした。');
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64UrlDecode(ivRaw) },
      await encryptionKey(env),
      base64UrlDecode(cipherRaw),
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    throw new FunctionHttpError(500, 'REFERRAL_CODE_DECRYPT_FAILED', '紹介コードを復元できませんでした。');
  }
}

function randomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  let code = '';
  for (const byte of bytes) code += alphabet[byte % alphabet.length];
  return `${code.slice(0, 5)}-${code.slice(5)}`;
}

export async function ensureReadableReferralCode(env: RewardProgramEnv, actor: AsteraActorProjection): Promise<{ code: string; hint: string }> {
  const existing = await env.ASTERA_DB.prepare(
    `SELECT encrypted_code, masked_hint FROM referral_codes WHERE user_id=?1 AND status='active' LIMIT 1`,
  ).bind(actor.user.id).first<{ encrypted_code: string | null; masked_hint: string }>();
  if (existing?.encrypted_code) return { code: await decryptCode(env, existing.encrypted_code), hint: existing.masked_hint };

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = randomCode();
    const digest = await rewardCodeDigest(env, code);
    const ciphertext = await encryptCode(env, code);
    const hint = maskedRewardCode(code);
    const now = new Date().toISOString();
    await env.ASTERA_DB.prepare(
      `INSERT INTO referral_codes (user_id, code_digest, masked_hint, status, created_at, updated_at, encrypted_code)
       VALUES (?1,?2,?3,'active',?4,?4,?5)
       ON CONFLICT(user_id) DO UPDATE SET
         encrypted_code=CASE WHEN referral_codes.encrypted_code IS NULL THEN excluded.encrypted_code ELSE referral_codes.encrypted_code END,
         updated_at=excluded.updated_at`,
    ).bind(actor.user.id, digest, hint, now, ciphertext).run();
    const stored = await env.ASTERA_DB.prepare(
      `SELECT code_digest, encrypted_code, masked_hint FROM referral_codes WHERE user_id=?1 AND status='active' LIMIT 1`,
    ).bind(actor.user.id).first<{ code_digest: string; encrypted_code: string | null; masked_hint: string }>();
    if (stored?.encrypted_code) return { code: await decryptCode(env, stored.encrypted_code), hint: stored.masked_hint };
  }
  throw new FunctionHttpError(503, 'REFERRAL_CODE_GENERATION_FAILED', '紹介コードを発行できませんでした。');
}
