import crypto from 'node:crypto';

export function decodeSecret(value: string): Buffer {
  const trimmed = value.trim();
  if (trimmed.startsWith('base64:')) return Buffer.from(trimmed.slice('base64:'.length), 'base64');
  if (trimmed.startsWith('whsec_')) {
    return Buffer.from(trimmed.slice('whsec_'.length), 'base64');
  }
  return Buffer.from(trimmed, 'utf8');
}

export function hmacSha256(secret: Buffer | string, content: Buffer | string): Buffer {
  return crypto.createHmac('sha256', secret).update(content).digest();
}

export function timingSafeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
