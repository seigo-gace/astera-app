export type TgserverNativeV1ClientConfig = {
  origin: string;
  token: string;
  timeoutMs: number;
};

export type TgserverNativeV1RegisterResult = {
  objectId: string;
  state: string;
  currentVersion: number;
  duplicate: boolean;
};

export type TgserverNativeV1WriteResult = {
  status: 'committed' | 'reconciliation_required' | 'retryable_failure';
  objectId: string;
  version?: number;
  logicalBytes?: number;
  sha256?: string;
  duplicate?: boolean;
  code?: string;
  retryAfterMs?: number;
};

export type TgserverNativeV1DeleteResult = {
  status: 'deleted' | 'accepted';
  objectId: string;
  duplicate: boolean;
};

export class TgserverNativeV1Error extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    public readonly retryAfterMs?: number,
  ) {
    super(code);
    this.name = 'TgserverNativeV1Error';
  }
}

function internalHost(hostname: string): boolean {
  return ['localhost', '127.0.0.1', '::1', 'host.docker.internal'].includes(hostname) || !hostname.includes('.');
}

function normalizeOrigin(value: string): string {
  const normalized = value.trim();
  if (!normalized) return '';
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new TgserverNativeV1Error('TGS_NATIVE_OBJECT_ORIGIN_INVALID', 500);
  }
  if (url.protocol !== 'https:' && !internalHost(url.hostname)) {
    throw new TgserverNativeV1Error('TGS_NATIVE_OBJECT_ORIGIN_HTTPS_REQUIRED', 500);
  }
  url.pathname = url.pathname.replace(/\/+$/, '');
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

function text(value: unknown, code: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new TgserverNativeV1Error(code, 502);
  return value.trim();
}

function integer(value: unknown, code: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new TgserverNativeV1Error(code, 502);
  return Number(value);
}

function bool(value: unknown, code: string): boolean {
  if (typeof value !== 'boolean') throw new TgserverNativeV1Error(code, 502);
  return value;
}

function retryAfter(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : undefined;
}

export class TgserverNativeV1Client {
  private readonly origin: string;
  private readonly token: string;
  private readonly timeoutMs: number;

  constructor(
    config: TgserverNativeV1ClientConfig,
    private readonly fetchImpl: typeof fetch = globalThis.fetch,
  ) {
    this.origin = normalizeOrigin(config.origin);
    this.token = config.token.trim();
    if (!Number.isSafeInteger(config.timeoutMs) || config.timeoutMs <= 0) {
      throw new TgserverNativeV1Error('TGS_NATIVE_OBJECT_TIMEOUT_INVALID', 500);
    }
    this.timeoutMs = config.timeoutMs;
  }

  get configured(): boolean {
    return Boolean(this.origin && this.token);
  }

  private url(path: string): string {
    if (!this.configured) throw new TgserverNativeV1Error('TGS_NATIVE_OBJECT_NOT_CONFIGURED', 503);
    return new URL(path.replace(/^\/+/, ''), `${this.origin}/`).toString();
  }

  private async request(
    path: string,
    init: RequestInit & { duplex?: 'half' },
    signal?: AbortSignal,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort('tgs_native_object_timeout'), this.timeoutMs);
    const onAbort = () => controller.abort(signal?.reason || 'client_cancelled');
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const headers = new Headers(init.headers);
      headers.set('authorization', `Bearer ${this.token}`);
      const response = await this.fetchImpl(this.url(path), {
        ...init,
        headers,
        signal: controller.signal,
      } as RequestInit);
      if (!response.ok) {
        const payload = await response.clone().json().catch(() => null) as Record<string, unknown> | null;
        throw new TgserverNativeV1Error(
          typeof payload?.code === 'string' && payload.code.trim()
            ? payload.code.trim()
            : `TGS_NATIVE_OBJECT_HTTP_${response.status}`,
          response.status,
          retryAfter(payload?.retry_after_ms),
        );
      }
      return response;
    } catch (error) {
      if (error instanceof TgserverNativeV1Error) throw error;
      if (controller.signal.aborted) {
        if (signal?.aborted) throw new TgserverNativeV1Error('TGS_NATIVE_OBJECT_CANCELLED', 499);
        throw new TgserverNativeV1Error('TGS_NATIVE_OBJECT_TIMEOUT', 504);
      }
      throw new TgserverNativeV1Error('TGS_NATIVE_OBJECT_UNAVAILABLE', 502);
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  private async json(response: Response): Promise<Record<string, unknown>> {
    const payload = await response.json().catch(() => null);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new TgserverNativeV1Error('TGS_NATIVE_OBJECT_RESPONSE_INVALID', 502);
    }
    return payload as Record<string, unknown>;
  }

  async register(input: {
    objectKey: string;
    idempotencyKey: string;
    signal?: AbortSignal;
  }): Promise<TgserverNativeV1RegisterResult> {
    const response = await this.request('v1/objects', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': input.idempotencyKey,
      },
      body: JSON.stringify({ object_key: input.objectKey }),
    }, input.signal);
    const payload = await this.json(response);
    return {
      objectId: text(payload.object_id, 'TGS_NATIVE_OBJECT_ID_MISSING'),
      state: text(payload.state, 'TGS_NATIVE_OBJECT_STATE_MISSING'),
      currentVersion: integer(payload.current_version, 'TGS_NATIVE_OBJECT_VERSION_INVALID'),
      duplicate: bool(payload.duplicate, 'TGS_NATIVE_OBJECT_DUPLICATE_INVALID'),
    };
  }

  async write(input: {
    objectId: string;
    fileSize: number;
    body: ReadableStream<Uint8Array>;
    idempotencyKey: string;
    signal?: AbortSignal;
  }): Promise<TgserverNativeV1WriteResult> {
    const response = await this.request(`v1/objects/${encodeURIComponent(input.objectId)}/content`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/octet-stream',
        'content-length': String(input.fileSize),
        'idempotency-key': input.idempotencyKey,
      },
      body: input.body,
      duplex: 'half',
    }, input.signal);
    const payload = await this.json(response);
    const status = text(payload.status, 'TGS_NATIVE_OBJECT_STATUS_MISSING');
    if (!['committed', 'reconciliation_required', 'retryable_failure'].includes(status)) {
      throw new TgserverNativeV1Error('TGS_NATIVE_OBJECT_STATUS_INVALID', 502);
    }
    const result: TgserverNativeV1WriteResult = {
      status: status as TgserverNativeV1WriteResult['status'],
      objectId: text(payload.object_id, 'TGS_NATIVE_OBJECT_ID_MISSING'),
    };
    if (payload.version !== undefined) result.version = integer(payload.version, 'TGS_NATIVE_OBJECT_VERSION_INVALID');
    if (payload.logical_bytes !== undefined) result.logicalBytes = integer(payload.logical_bytes, 'TGS_NATIVE_OBJECT_BYTES_INVALID');
    if (payload.sha256 !== undefined) result.sha256 = text(payload.sha256, 'TGS_NATIVE_OBJECT_SHA256_INVALID');
    if (payload.duplicate !== undefined) result.duplicate = bool(payload.duplicate, 'TGS_NATIVE_OBJECT_DUPLICATE_INVALID');
    if (payload.code !== undefined) result.code = text(payload.code, 'TGS_NATIVE_OBJECT_CODE_INVALID');
    const retryAfterMs = retryAfter(payload.retry_after_ms);
    if (retryAfterMs !== undefined) result.retryAfterMs = retryAfterMs;
    return result;
  }

  read(input: {
    objectId: string;
    signal?: AbortSignal;
  }): Promise<Response> {
    return this.request(`v1/objects/${encodeURIComponent(input.objectId)}/content`, { method: 'GET' }, input.signal);
  }

  async remove(input: {
    objectId: string;
    idempotencyKey: string;
    signal?: AbortSignal;
  }): Promise<TgserverNativeV1DeleteResult> {
    const response = await this.request(`v1/objects/${encodeURIComponent(input.objectId)}`, {
      method: 'DELETE',
      headers: { 'idempotency-key': input.idempotencyKey },
    }, input.signal);
    const payload = await this.json(response);
    const status = text(payload.status, 'TGS_NATIVE_OBJECT_DELETE_STATUS_MISSING');
    if (status !== 'deleted' && status !== 'accepted') {
      throw new TgserverNativeV1Error('TGS_NATIVE_OBJECT_DELETE_STATUS_INVALID', 502);
    }
    return {
      status,
      objectId: text(payload.object_id, 'TGS_NATIVE_OBJECT_ID_MISSING'),
      duplicate: bool(payload.duplicate, 'TGS_NATIVE_OBJECT_DUPLICATE_INVALID'),
    };
  }
}
