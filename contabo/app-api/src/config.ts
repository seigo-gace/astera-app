export type RuntimeConfig = {
  port: number;
  /** Legacy-only until PostgreSQL migrate/smoke sources are removed. Runtime startup does not require it. */
  databaseUrl: string;
  internalServiceToken: string;
  processOrigin: string;
  processToken: string;
  processTimeoutMs: number;
  shutdownTimeoutMs: number;
  vaultOrigin: string;
  vaultServiceToken: string;
  vaultJobKeyRef: string;
  vaultTimeoutMs: number;
  translationModelId: string;
  translationGeminiKeyRef: string;
  translationTimeoutMs: number;
  tgserverStorageOrigin: string;
  tgserverStorageToken: string;
  tgserverStorageTimeoutMs: number;
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
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '::1'].includes(url.hostname)) {
    throw new Error('INTERNAL_ORIGIN_HTTPS_REQUIRED');
  }
  url.pathname = url.pathname.replace(/\/+$/, '');
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

function optionalSecureOrigin(value: string | undefined): string {
  const normalized = value?.trim();
  return normalized ? secureOrigin(normalized) : '';
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const tgserverStorageOrigin = optionalSecureOrigin(env.TGS_STORAGE_INTERNAL_ORIGIN);
  return {
    port: integer(env.PORT, 8788, 1, 65_535),
    databaseUrl: env.DATABASE_URL?.trim() || '',
    internalServiceToken: required(env.INTERNAL_SERVICE_TOKEN, 'INTERNAL_SERVICE_TOKEN'),
    processOrigin: secureOrigin(required(env.ASTERA_PROCESS_ORIGIN, 'ASTERA_PROCESS_ORIGIN')),
    processToken: required(env.ASTERA_PROCESS_TOKEN, 'ASTERA_PROCESS_TOKEN'),
    processTimeoutMs: integer(env.ASTERA_PROCESS_TIMEOUT_MS, 120_000, 3_000, 600_000),
    shutdownTimeoutMs: integer(env.SHUTDOWN_TIMEOUT_MS, 20_000, 1_000, 120_000),
    vaultOrigin: secureOrigin(required(env.LIBRAL_VAULT_INTERNAL_ORIGIN, 'LIBRAL_VAULT_INTERNAL_ORIGIN')),
    vaultServiceToken: required(env.LIBRAL_VAULT_INTERNAL_TOKEN, 'LIBRAL_VAULT_INTERNAL_TOKEN'),
    vaultJobKeyRef: required(env.LIBRAL_VAULT_JOB_KEY_REF, 'LIBRAL_VAULT_JOB_KEY_REF'),
    vaultTimeoutMs: integer(env.LIBRAL_VAULT_TIMEOUT_MS, 15_000, 1_000, 120_000),
    translationModelId: env.ASTERA_TRANSLATION_MODEL_ID?.trim() || '',
    translationGeminiKeyRef: env.LIBRAL_VAULT_GEMINI_KEY_REF?.trim() || '',
    translationTimeoutMs: integer(env.ASTERA_TRANSLATION_TIMEOUT_MS, 90_000, 3_000, 180_000),
    tgserverStorageOrigin,
    tgserverStorageToken: tgserverStorageOrigin ? required(env.TGS_STORAGE_INTERNAL_TOKEN, 'TGS_STORAGE_INTERNAL_TOKEN') : '',
    tgserverStorageTimeoutMs: integer(env.TGS_STORAGE_TIMEOUT_MS, 600_000, 10_000, 3_600_000),
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
