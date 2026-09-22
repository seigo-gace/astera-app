import { FunctionHttpError } from '../part/billing-env.js';

export const VAULT_CONSUMER = 'astera-billing';

export type VaultHmacVerifyInput = {
  secretId: string;
  dataBase64: string;
  signature: string;
  encoding?: 'base64' | 'hex';
};

export type VaultActionsHttpInput = {
  secretId: string;
  url: string;
  method?: string;
  secretHeader?: string;
  secretPrefix?: string;
  headers?: Record<string, string>;
  body?: string | Record<string, unknown>;
};

export type VaultActionsHttpResult = {
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  body: string;
};

export interface LibralVaultClient {
  hmacVerify(input: VaultHmacVerifyInput): Promise<{ valid: boolean }>;
  actionsHttp(input: VaultActionsHttpInput): Promise<VaultActionsHttpResult>;
}

type FetchLike = typeof fetch;

export class LibralVaultHttpClient implements LibralVaultClient {
  readonly #origin: string;
  readonly #token: string;
  readonly #fetch: FetchLike;

  constructor(origin: string, token: string, fetchImpl: FetchLike = fetch) {
    const normalizedOrigin = origin.trim().replace(/\/+$/, '');
    const normalizedToken = token.trim();
    if (!normalizedOrigin) throw new Error('LIBRAL_VAULT_INTERNAL_ORIGIN_MISSING');
    if (!normalizedToken || normalizedToken.length < 24) throw new Error('LIBRAL_VAULT_INTERNAL_TOKEN_TOO_SHORT');
    this.#origin = normalizedOrigin;
    this.#token = normalizedToken;
    this.#fetch = fetchImpl;
  }

  async hmacVerify(input: VaultHmacVerifyInput): Promise<{ valid: boolean }> {
    const payload = {
      secret_id: input.secretId,
      consumer: VAULT_CONSUMER,
      data_base64: input.dataBase64,
      signature: input.signature,
      encoding: input.encoding ?? 'base64',
    };
    const response = await this.#json<{ valid: boolean }>('POST', '/internal/v1/crypto/hmac/verify', payload);
    return { valid: response.valid === true };
  }

  async actionsHttp(input: VaultActionsHttpInput): Promise<VaultActionsHttpResult> {
    const payload = {
      secret_id: input.secretId,
      consumer: VAULT_CONSUMER,
      url: input.url,
      method: input.method ?? 'GET',
      secret_header: input.secretHeader ?? 'Authorization',
      secret_prefix: input.secretPrefix ?? 'Bearer ',
      headers: input.headers ?? {},
      ...(input.body === undefined ? {} : { body: input.body }),
    };
    const response = await this.#json<{
      provider: VaultActionsHttpResult;
    }>('POST', '/internal/v1/actions/http', payload);
    return response.provider;
  }

  async #json<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const init: RequestInit = {
      method,
      headers: {
        authorization: `Bearer ${this.#token}`,
        ...(method === 'GET' ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    };
    const response = await this.#fetch(`${this.#origin}${path}`, init);
    const payload = await response.json().catch(() => ({})) as T & { error?: { code?: string; message?: string } };
    if (!response.ok) {
      throw new FunctionHttpError(
        response.status >= 500 ? 502 : response.status,
        payload.error?.code ?? 'VAULT_REQUEST_FAILED',
        payload.error?.message ?? 'Vault internal request failed.',
      );
    }
    return payload as T;
  }
}

export function createLibralVaultClientFromEnv(env: {
  LIBRAL_VAULT_INTERNAL_ORIGIN?: string;
  LIBRAL_VAULT_INTERNAL_TOKEN?: string;
}): LibralVaultClient | null {
  const origin = env.LIBRAL_VAULT_INTERNAL_ORIGIN?.trim();
  const token = env.LIBRAL_VAULT_INTERNAL_TOKEN?.trim();
  if (!origin || !token) return null;
  return new LibralVaultHttpClient(origin, token);
}

export function squareSandboxOriginOnly(environment: string | undefined): string {
  const normalized = environment?.trim().toLowerCase();
  if (normalized === 'production') return 'https://connect.squareup.com';
  if (normalized && normalized !== 'sandbox') throw new FunctionHttpError(503, 'SQUARE_ENVIRONMENT_INVALID', 'Square environment is invalid.');
  return 'https://connect.squareupsandbox.com';
}
