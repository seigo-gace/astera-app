import type { RuntimeConfig } from './config.js';

type VaultEnvelope = { ciphertext: string; iv: string };

type VaultProviderResponse = {
  status: number;
  ok: boolean;
  headers?: Record<string, string>;
  body: string;
};

type FetchLike = typeof fetch;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export class VaultClient {
  readonly origin: string;
  readonly serviceToken: string;
  readonly jobKeyRef: string;
  readonly timeoutMs: number;
  readonly fetchImpl: FetchLike;

  constructor(config: Pick<RuntimeConfig, 'vaultOrigin' | 'vaultServiceToken' | 'vaultJobKeyRef' | 'vaultTimeoutMs'>, fetchImpl: FetchLike = fetch) {
    this.origin = config.vaultOrigin;
    this.serviceToken = config.vaultServiceToken;
    this.jobKeyRef = config.vaultJobKeyRef;
    this.timeoutMs = config.vaultTimeoutMs;
    this.fetchImpl = fetchImpl;
  }

  private async request(path: string, body?: unknown, method = 'POST'): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort('vault_timeout'), this.timeoutMs);
    try {
      const init: RequestInit = {
        method,
        headers: {
          Authorization: `Bearer ${this.serviceToken}`,
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        signal: controller.signal,
      };
      if (body !== undefined) init.body = JSON.stringify(body);
      const response = await this.fetchImpl(`${this.origin}${path}`, init);
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const source = asRecord(asRecord(payload).error ?? payload);
        throw Object.assign(new Error(text(source.message) || `Libral Vault internal API failed (${response.status})`), {
          code: text(source.code) || `LIBRAL_VAULT_HTTP_${response.status}`,
          retryable: response.status >= 500,
        });
      }
      return asRecord(payload);
    } catch (error) {
      if (controller.signal.aborted) throw Object.assign(new Error('Libral Vault internal API timed out.'), { code: 'LIBRAL_VAULT_TIMEOUT', retryable: true });
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async health(): Promise<Record<string, unknown>> {
    return this.request('/internal/v1/health', undefined, 'GET');
  }

  async sealJson(value: unknown): Promise<VaultEnvelope> {
    const encoded = Buffer.from(JSON.stringify(value), 'utf8');
    try {
      const payload = await this.request('/internal/v1/crypto/seal', {
        key_ref: this.jobKeyRef,
        consumer: 'astera-app-runtime',
        plaintext_base64: encoded.toString('base64'),
      });
      const ciphertext = text(payload.ciphertext);
      const iv = text(payload.iv);
      if (!ciphertext || !iv) throw Object.assign(new Error('Vault seal response is incomplete.'), { code: 'LIBRAL_VAULT_SEAL_RESPONSE_INVALID' });
      return { ciphertext, iv };
    } finally {
      encoded.fill(0);
    }
  }

  async unsealJson<T>(payload: VaultEnvelope): Promise<T> {
    const response = await this.request('/internal/v1/crypto/unseal', {
      key_ref: this.jobKeyRef,
      consumer: 'astera-app-runtime',
      ciphertext: payload.ciphertext,
      iv: payload.iv,
    });
    const encoded = text(response.plaintext_base64);
    if (!encoded) throw Object.assign(new Error('Vault unseal response is incomplete.'), { code: 'LIBRAL_VAULT_UNSEAL_RESPONSE_INVALID' });
    const plaintext = Buffer.from(encoded, 'base64');
    try {
      return JSON.parse(plaintext.toString('utf8')) as T;
    } finally {
      plaintext.fill(0);
    }
  }

  async storeSecret(input: { value: Uint8Array; allowedConsumers: string[]; expiresAt?: number }): Promise<string> {
    const payload = await this.request('/internal/v1/secrets', {
      value_base64: Buffer.from(input.value).toString('base64'),
      allowed_consumers: input.allowedConsumers,
      ...(input.expiresAt === undefined ? {} : { expires_at: input.expiresAt }),
    });
    const id = text(asRecord(payload.secret).id);
    if (!id) throw Object.assign(new Error('Vault secret reference is missing.'), { code: 'LIBRAL_VAULT_SECRET_REFERENCE_MISSING' });
    return id;
  }

  async providerJson(input: {
    secretId: string;
    consumer: string;
    url: string;
    method?: string;
    secretHeader: string;
    secretPrefix?: string;
    headers?: Record<string, string>;
    body?: unknown;
  }): Promise<{ payload: unknown; response: VaultProviderResponse }> {
    const root = await this.request('/internal/v1/actions/http', {
      secret_id: input.secretId,
      consumer: input.consumer,
      url: input.url,
      method: input.method ?? 'POST',
      secret_header: input.secretHeader,
      secret_prefix: input.secretPrefix ?? '',
      headers: input.headers ?? {},
      body: input.body,
    });
    const provider = asRecord(root.provider);
    const response: VaultProviderResponse = {
      status: Number(provider.status),
      ok: provider.ok === true,
      headers: asRecord(provider.headers) as Record<string, string>,
      body: typeof provider.body === 'string' ? provider.body : '',
    };
    if (!Number.isInteger(response.status) || !response.body) throw Object.assign(new Error('Vault provider response is incomplete.'), { code: 'LIBRAL_VAULT_PROVIDER_RESPONSE_INVALID' });
    let payload: unknown = null;
    try {
      payload = JSON.parse(response.body);
    } catch {
      payload = response.body;
    }
    if (!response.ok) {
      const providerError = asRecord(asRecord(payload).error ?? payload);
      throw Object.assign(new Error(text(providerError.message) || `Provider request failed (${response.status})`), {
        code: text(providerError.status) || text(providerError.code) || `PROVIDER_HTTP_${response.status}`,
        retryable: response.status === 429 || response.status >= 500,
      });
    }
    return { payload, response };
  }
}
