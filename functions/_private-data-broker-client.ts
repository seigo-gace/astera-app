import { FunctionHttpError } from './_account-projection';

export type PrivateBrokerEnv = {
  ASTERA_RUNTIME_ORIGIN?: string;
  ASTERA_RUNTIME_SERVICE_TOKEN?: string;
  ASTERA_RUNTIME_TIMEOUT_MS?: string;
};

export type PrivateRuntimeFile = {
  upload_id: string;
  object_id: string;
  storage_key: string;
  storage_reference: string;
  name: string;
  content_type: string;
  size_bytes: number;
  sha256: string;
  status: 'ready';
  private_mode: true;
  expires_at: string;
};

type PrivateUploadResult = { file: PrivateRuntimeFile };

function runtimeUrl(value: string | undefined, path: string): URL {
  const raw = value?.trim();
  if (!raw) throw new FunctionHttpError(503, 'ASTERA_RUNTIME_ORIGIN_NOT_CONFIGURED', 'Astera Runtime接続先が設定されていません。');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new FunctionHttpError(503, 'ASTERA_RUNTIME_ORIGIN_INVALID', 'Astera Runtime接続先URLが不正です。');
  }
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
    throw new FunctionHttpError(503, 'ASTERA_RUNTIME_HTTPS_REQUIRED', 'Astera Runtime接続先はHTTPSである必要があります。');
  }
  url.search = '';
  url.hash = '';
  const base = url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, '');
  url.pathname = `${base}${path.startsWith('/') ? path : `/${path}`}`;
  return url;
}

function serviceToken(value: string | undefined): string {
  const token = value?.trim();
  if (!token) throw new FunctionHttpError(503, 'ASTERA_RUNTIME_SERVICE_TOKEN_NOT_CONFIGURED', 'Astera Runtime Service Tokenが設定されていません。');
  return token;
}

function timeoutMs(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 120_000;
  return Math.min(120_000, Math.max(10_000, Math.trunc(parsed)));
}

function fileNameBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizePrivateFile(payload: unknown): PrivateRuntimeFile {
  const file = record(record(payload).file);
  const uploadId = text(file.upload_id);
  const objectId = text(file.object_id);
  const storageKey = text(file.storage_key);
  const name = text(file.name);
  const contentType = text(file.content_type);
  const sha256 = text(file.sha256).toLowerCase();
  const expiresAt = text(file.expires_at);
  const sizeBytes = Number(file.size_bytes);
  if (
    !uploadId || !objectId || uploadId !== objectId || storageKey !== `private:${objectId}` || !name || !contentType ||
    !Number.isSafeInteger(sizeBytes) || sizeBytes <= 0 || !/^[a-f0-9]{64}$/.test(sha256) || !expiresAt ||
    file.private_mode !== true || text(file.status) !== 'ready'
  ) {
    throw new FunctionHttpError(502, 'PRIVATE_BROKER_RESPONSE_INVALID', 'Private Data Broker Responseが不完全です。', payload);
  }
  return {
    upload_id: uploadId,
    object_id: objectId,
    storage_key: storageKey,
    storage_reference: text(file.storage_reference) || objectId,
    name,
    content_type: contentType,
    size_bytes: sizeBytes,
    sha256,
    status: 'ready',
    private_mode: true,
    expires_at: expiresAt,
  };
}

async function brokerRequest(
  env: PrivateBrokerEnv,
  path: string,
  init: RequestInit,
  correlationId: string,
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort('private_broker_timeout'), timeoutMs(env.ASTERA_RUNTIME_TIMEOUT_MS));
  try {
    const response = await fetch(runtimeUrl(env.ASTERA_RUNTIME_ORIGIN, path), {
      ...init,
      headers: {
        Authorization: `Bearer ${serviceToken(env.ASTERA_RUNTIME_SERVICE_TOKEN)}`,
        Accept: 'application/json',
        'X-Correlation-ID': correlationId,
        ...(init.headers ?? {}),
      },
      signal: controller.signal,
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const source = record(record(payload).error ?? payload);
      throw new FunctionHttpError(
        response.status >= 500 ? 502 : response.status,
        text(source.code) || `PRIVATE_BROKER_HTTP_${response.status}`,
        text(source.message) || `Private Data Broker Requestに失敗しました (${response.status})`,
        payload,
      );
    }
    return payload;
  } catch (error) {
    if (error instanceof FunctionHttpError) throw error;
    if (controller.signal.aborted) throw new FunctionHttpError(504, 'PRIVATE_BROKER_TIMEOUT', 'Private Data Brokerの応答期限を超えました。');
    throw new FunctionHttpError(502, 'PRIVATE_UPLOAD_BROKER_UNAVAILABLE', 'Private Data Brokerへ接続できません。');
  } finally {
    clearTimeout(timeout);
  }
}

export async function uploadPrivateRuntimeFile(
  env: PrivateBrokerEnv,
  input: { tenantId: string; userId: string; file: File; correlationId: string },
): Promise<PrivateUploadResult> {
  const payload = await brokerRequest(env, '/api/private/uploads', {
    method: 'POST',
    headers: {
      'Content-Type': input.file.type || 'application/octet-stream',
      'X-Astera-Tenant-ID': input.tenantId,
      'X-Astera-User-ID': input.userId,
      'X-Astera-File-Name-B64': fileNameBase64(input.file.name),
    },
    body: input.file,
  }, input.correlationId);
  return { file: normalizePrivateFile(payload) };
}

export async function describePrivateRuntimeFile(
  env: PrivateBrokerEnv,
  input: { tenantId: string; userId: string; objectId: string; correlationId: string },
): Promise<PrivateRuntimeFile> {
  const payload = await brokerRequest(env, `/api/private/objects/${encodeURIComponent(input.objectId)}`, {
    method: 'GET',
    headers: {
      'X-Astera-Tenant-ID': input.tenantId,
      'X-Astera-User-ID': input.userId,
    },
  }, input.correlationId);
  return normalizePrivateFile(payload);
}
