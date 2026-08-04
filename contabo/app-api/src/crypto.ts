const ALGORITHM = 'aes-256-gcm';

export type EncryptedPayload = {
  ciphertext: string;
  iv: string;
};

export async function encryptJson(value: unknown, rawKey: Uint8Array): Promise<EncryptedPayload> {
  const key = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  return {
    ciphertext: Buffer.from(ciphertext).toString('base64'),
    iv: Buffer.from(iv).toString('base64'),
  };
}

export async function decryptJson<T>(payload: EncryptedPayload, rawKey: Uint8Array): Promise<T> {
  if (!payload.ciphertext || !payload.iv) throw new Error('ENCRYPTED_JOB_PAYLOAD_MISSING');
  const key = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['decrypt']);
  const iv = Uint8Array.from(Buffer.from(payload.iv, 'base64'));
  if (iv.byteLength !== 12) throw new Error('ENCRYPTED_JOB_IV_INVALID');
  const ciphertext = Uint8Array.from(Buffer.from(payload.ciphertext, 'base64'));
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return JSON.parse(new TextDecoder().decode(plaintext)) as T;
}

export const runtimeEncryption = { algorithm: ALGORITHM, keyBytes: 32, ivBytes: 12 } as const;
