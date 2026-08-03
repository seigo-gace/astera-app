export type JsonObject = Record<string, unknown>;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly payload: unknown;

  constructor(message: string, status = 0, code = 'API_ERROR', payload: unknown = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.payload = payload;
  }
}

const API_BASE = (import.meta.env.VITE_ASTERA_API_BASE as string | undefined)?.replace(/\/$/, '') ?? '';

function csrfToken(): string | null {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content?.trim();
  if (meta) return meta;
  const cookie = document.cookie
    .split(';')
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith('csrf_token='));
  return cookie ? decodeURIComponent(cookie.slice('csrf_token='.length)) : null;
}

function endpointUrl(path: string): string {
  if (/^https:\/\//i.test(path)) return path;
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE}${normalized}`;
}

function responseCode(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const record = payload as JsonObject;
  const value = record.code ?? record.error_code ?? record.error;
  return typeof value === 'string' ? value : '';
}

function responseMessage(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const record = payload as JsonObject;
  const value = record.message ?? record.error_description ?? record.detail;
  return typeof value === 'string' ? value : '';
}

export type ApiRequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
  idempotent?: boolean;
  headers?: Record<string, string>;
};

export async function apiRequest<T = unknown>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  if (!API_BASE && !/^https:\/\//i.test(path)) {
    throw new ApiError('Astera API Baseが設定されていません。', 0, 'ASTERA_API_BASE_NOT_CONFIGURED');
  }

  const method = options.method ?? 'GET';
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);
  const abortListener = () => controller.abort();
  options.signal?.addEventListener('abort', abortListener, { once: true });

  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...options.headers,
  };

  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const csrf = csrfToken();
  if (csrf && method !== 'GET') headers['X-CSRF-Token'] = csrf;
  if (options.idempotent && method !== 'GET') headers['Idempotency-Key'] = crypto.randomUUID();

  try {
    const response = await fetch(endpointUrl(path), {
      method,
      credentials: 'include',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });

    const contentType = response.headers.get('content-type') ?? '';
    const payload: unknown = contentType.includes('application/json')
      ? await response.json().catch(() => null)
      : await response.text().catch(() => '');

    if (!response.ok) {
      const code = responseCode(payload) || `HTTP_${response.status}`;
      const message = responseMessage(payload) || `Astera API request failed (${response.status})`;
      throw new ApiError(message, response.status, code, payload);
    }

    return payload as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (controller.signal.aborted) {
      throw new ApiError('通信がTimeoutまたは取消されました。', 0, 'REQUEST_ABORTED');
    }
    throw new ApiError(error instanceof Error ? error.message : '通信に失敗しました。', 0, 'NETWORK_ERROR');
  } finally {
    window.clearTimeout(timeout);
    options.signal?.removeEventListener('abort', abortListener);
  }
}

export function asRecord(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}

export function asArray(value: unknown, keys: string[] = []): unknown[] {
  if (Array.isArray(value)) return value;
  const root = asRecord(value);
  for (const key of keys) {
    const candidate = root[key];
    if (Array.isArray(candidate)) return candidate;
  }
  const data = asRecord(root.data);
  for (const key of keys) {
    const candidate = data[key];
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

export function textValue(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}

export function recordText(record: JsonObject, keys: string[], fallback = ''): string {
  for (const key of keys) {
    const value = textValue(record[key]).trim();
    if (value) return value;
  }
  return fallback;
}

export function queryValue(name: string): string {
  return new URLSearchParams(window.location.search).get(name)?.trim() ?? '';
}
