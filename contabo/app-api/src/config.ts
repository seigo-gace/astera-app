export type RuntimeConfig = {
  port: number;
  databaseUrl: string;
  internalServiceToken: string;
  processOrigin: string;
  processToken: string;
  encryptionKey: Uint8Array;
  processTimeoutMs: number;
  shutdownTimeoutMs: number;
};

function required(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name}_NOT_CONFIGURED`);
  return normalized;
}

function integer(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function secureOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
    throw new Error('ASTERA_PROCESS_ORIGIN_HTTPS_REQUIRED');
  }
  url.pathname = url.pathname.replace(/\/+$/, '');
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

function base64Key(value: string): Uint8Array {
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(Buffer.from(value, 'base64'));
  } catch {
    throw new Error('JOB_ENCRYPTION_KEY_INVALID_BASE64');
  }
  if (bytes.byteLength !== 32) throw new Error('JOB_ENCRYPTION_KEY_MUST_BE_32_BYTES');
  return bytes;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  return {
    port: integer(env.PORT, 8788, 1, 65_535),
    databaseUrl: required(env.DATABASE_URL, 'DATABASE_URL'),
    internalServiceToken: required(env.INTERNAL_SERVICE_TOKEN, 'INTERNAL_SERVICE_TOKEN'),
    processOrigin: secureOrigin(required(env.ASTERA_PROCESS_ORIGIN, 'ASTERA_PROCESS_ORIGIN')),
    processToken: required(env.ASTERA_PROCESS_TOKEN, 'ASTERA_PROCESS_TOKEN'),
    encryptionKey: base64Key(required(env.JOB_ENCRYPTION_KEY, 'JOB_ENCRYPTION_KEY')),
    processTimeoutMs: integer(env.ASTERA_PROCESS_TIMEOUT_MS, 120_000, 3_000, 600_000),
    shutdownTimeoutMs: integer(env.SHUTDOWN_TIMEOUT_MS, 20_000, 1_000, 120_000),
  };
}

export function constantTimeTokenEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  const length = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let index = 0; index < length; index += 1) {
    diff |= (a[index % Math.max(1, a.length)] ?? 0) ^ (b[index % Math.max(1, b.length)] ?? 0);
  }
  return diff === 0;
}
