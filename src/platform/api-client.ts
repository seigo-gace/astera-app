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
const HISTORY_SEARCH_DEBOUNCE_MS = 250;

function csrfToken(): string | null {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content?.trim();
  if (meta) return meta;
  const cookie = document.cookie.split(';').map((entry) => entry.trim()).find((entry) => entry.startsWith('csrf_token='));
  return cookie ? decodeURIComponent(cookie.slice('csrf_token='.length)) : null;
}

export function apiUrl(path: string): string {
  if (/^https:\/\//i.test(path)) return path;
  if (!API_BASE) throw new ApiError('Astera API Baseが設定されていません。', 0, 'ASTERA_API_BASE_NOT_CONFIGURED');
  return `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
}

function objectValue(value: unknown): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : null;
}

function errorPayload(payload: unknown): JsonObject | null {
  const root = objectValue(payload);
  if (!root) return null;
  const nested = objectValue(root.error);
  return nested ?? root;
}

function firstString(record: JsonObject | null, keys: string[]): string {
  if (!record) return '';
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function responseCode(payload: unknown): string {
  const root = objectValue(payload);
  const nested = errorPayload(payload);
  return firstString(nested, ['code', 'error_code', 'type'])
    || firstString(root, ['code', 'error_code'])
    || (typeof root?.error === 'string' ? root.error : '');
}

function responseMessage(payload: unknown): string {
  const root = objectValue(payload);
  const nested = errorPayload(payload);
  return firstString(nested, ['message', 'error_description', 'detail', 'title'])
    || firstString(root, ['message', 'error_description', 'detail', 'title']);
}

function waitFor(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const timeout = window.setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, ms);
    const abort = () => {
      window.clearTimeout(timeout);
      reject(signal.reason);
    };
    signal.addEventListener('abort', abort, { once: true });
  });
}

function shouldDebounceHistorySearch(requestUrl: string, method: string): boolean {
  if (method !== 'GET') return false;
  try {
    const url = new URL(requestUrl, window.location.origin);
    return url.pathname === '/api/history' && url.searchParams.has('q');
  } catch {
    return false;
  }
}

export type ApiRequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
  idempotent?: boolean;
  idempotencyKey?: string;
  headers?: Record<string, string>;
};

export async function apiRequest<T = unknown>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort('timeout'), options.timeoutMs ?? 15_000);
  const abortListener = () => controller.abort(options.signal?.reason ?? 'cancelled');
  options.signal?.addEventListener('abort', abortListener, { once: true });
  const headers: Record<string, string> = { Accept: 'application/json', ...options.headers };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const csrf = csrfToken();
  if (csrf && method !== 'GET') headers['X-CSRF-Token'] = csrf;
  if (method !== 'GET' && (options.idempotent || options.idempotencyKey)) {
    const requestId = options.idempotencyKey ?? crypto.randomUUID();
    headers['Idempotency-Key'] = requestId;
    headers['X-Request-ID'] = requestId;
  }

  try {
    const requestUrl = apiUrl(path);
    if (shouldDebounceHistorySearch(requestUrl, method)) {
      await waitFor(HISTORY_SEARCH_DEBOUNCE_MS, controller.signal);
    }
    const response = await fetch(requestUrl, {
      method,
      credentials: 'include',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });
    const contentType = response.headers.get('content-type') ?? '';
    const payload: unknown = contentType.toLowerCase().includes('json') ? await response.json().catch(() => null) : await response.text().catch(() => '');
    if (!response.ok) {
      throw new ApiError(responseMessage(payload) || `Astera API request failed (${response.status})`, response.status, responseCode(payload) || `HTTP_${response.status}`, payload);
    }
    return payload as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (controller.signal.aborted) throw new ApiError('通信がTimeoutまたは取消されました。', 0, 'REQUEST_ABORTED');
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
  for (const key of keys) if (Array.isArray(root[key])) return root[key] as unknown[];
  const data = asRecord(root.data);
  for (const key of keys) if (Array.isArray(data[key])) return data[key] as unknown[];
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
