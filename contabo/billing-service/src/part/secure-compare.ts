import crypto from 'node:crypto';
import fs from 'node:fs';

export function secretsEqual(provided: string, configured: string): boolean {
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(configured, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function readSecretFromFile(path: string | undefined): string | undefined {
  const normalized = path?.trim();
  if (!normalized) return undefined;
  try {
    return fs.readFileSync(normalized, 'utf8').trim() || undefined;
  } catch {
    return undefined;
  }
}
