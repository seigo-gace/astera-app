export type AsteraAppRuntimeLogLevel = 'error' | 'warn' | 'info' | 'debug';

export type AsteraAppRuntimeEventName =
  | 'astera_app_api_started'
  | 'runtime_job_completed'
  | 'runtime_job_partially_completed'
  | 'runtime_job_failed'
  | 'runtime_job_cancelled'
  | 'shutdown_started'
  | 'shutdown_timeout'
  | 'database_close_failed'
  | 'shutdown_completed'
  | 'unhandled_rejection'
  | 'uncaught_exception';

export type AsteraAppRuntimeLogEvent = {
  level: AsteraAppRuntimeLogLevel;
  event: AsteraAppRuntimeEventName;
  code?: string | null;
  signal?: string | null;
  createdAt?: string;
};

type ZeroReceipt = { results?: Array<{ status?: string }> };

type ZeroLog = {
  project_id: 'P010';
  severity: AsteraAppRuntimeLogLevel;
  message: string;
  hint: 'astera-app-runtime';
  timestamp: string;
};

const PROJECT_ID = 'P010';
const HINT = 'astera-app-runtime';
const CODE_PATTERN = /^[A-Z0-9_]{1,64}$/;
const SIGNALS = new Set(['SIGTERM', 'SIGINT', 'uncaughtException']);

export function buildTgServerBulkUrl(value: string): string {
  const base = value.trim().replace(/\/+$/, '');
  if (!base) throw new Error('TGSERVER_LOG_URL is empty');
  if (base.endsWith('/ingest/bulk')) return base;
  if (base.endsWith('/ingest')) return `${base}/bulk`;
  return `${base}/ingest/bulk`;
}

export function normalizeRuntimeCode(value: unknown): string | null {
  if (value == null) return null;
  const code = String(value).trim();
  return CODE_PATTERN.test(code) ? code : 'ASTERA_APP_RUNTIME_ERROR';
}

export function normalizeRuntimeSignal(value: unknown): string | null {
  if (value == null) return null;
  const signal = String(value).trim();
  return SIGNALS.has(signal) ? signal : 'UNKNOWN';
}

export function buildAsteraAppZeroLog(input: AsteraAppRuntimeLogEvent): ZeroLog {
  return Object.freeze({
    project_id: PROJECT_ID,
    severity: input.level,
    message: JSON.stringify({
      event: input.event,
      code: normalizeRuntimeCode(input.code),
      signal: normalizeRuntimeSignal(input.signal),
    }),
    hint: HINT,
    timestamp: input.createdAt ?? new Date().toISOString(),
  });
}

export function validateTgServerBulkReceipt(payload: unknown, expectedCount: number): void {
  if (!payload || typeof payload !== 'object') throw new Error('TGserver ZERO bulk receipt is invalid');
  const results = (payload as ZeroReceipt).results;
  if (!Array.isArray(results) || results.length !== expectedCount) {
    throw new Error('TGserver ZERO bulk receipt count mismatch');
  }
  if (results.some((item) => item?.status !== 'accepted' && item?.status !== 'duplicate')) {
    throw new Error('TGserver ZERO bulk receipt contains a non-success status');
  }
}

export type TgServerLogSinkOptions = {
  url: string | null;
  timeoutMs?: number;
  flushIntervalMs?: number;
  batchSize?: number;
  queueLimit?: number;
  fetchImpl?: typeof fetch;
};

export class TgServerLogSink {
  private readonly queue: AsteraAppRuntimeLogEvent[] = [];
  private readonly url: string | null;
  private readonly timeoutMs: number;
  private readonly flushIntervalMs: number;
  private readonly batchSize: number;
  private readonly queueLimit: number;
  private readonly fetchImpl: typeof fetch;
  private timer: NodeJS.Timeout | undefined;
  private flushing = false;

  constructor(options: TgServerLogSinkOptions) {
    this.url = options.url?.trim() || null;
    this.timeoutMs = Math.min(Math.max(options.timeoutMs ?? 1500, 100), 10_000);
    this.flushIntervalMs = Math.min(Math.max(options.flushIntervalMs ?? 1000, 100), 60_000);
    this.batchSize = Math.min(Math.max(options.batchSize ?? 20, 1), 100);
    this.queueLimit = Math.min(Math.max(options.queueLimit ?? 200, this.batchSize), 2000);
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  get enabled(): boolean { return this.url !== null; }
  get queued(): number { return this.queue.length; }

  start(): void {
    if (!this.enabled || this.timer) return;
    this.timer = setInterval(() => { void this.flush(); }, this.flushIntervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  log(event: AsteraAppRuntimeLogEvent): void {
    if (!this.enabled) return;
    if (this.queue.length >= this.queueLimit) this.queue.shift();
    this.queue.push({ ...event, createdAt: event.createdAt ?? new Date().toISOString() });
    if (this.queue.length >= this.batchSize) void this.flush();
  }

  async flush(): Promise<boolean> {
    if (!this.url || this.flushing || this.queue.length === 0) return true;
    const batch = this.queue.splice(0, this.batchSize);
    this.flushing = true;
    try {
      const response = await this.fetchImpl(buildTgServerBulkUrl(this.url), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ logs: batch.map(buildAsteraAppZeroLog) }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) throw new Error(`TGserver ZERO returned HTTP ${response.status}`);
      validateTgServerBulkReceipt(await response.json(), batch.length);
      return true;
    } catch {
      this.queue.unshift(...batch);
      while (this.queue.length > this.queueLimit) this.queue.pop();
      return false;
    } finally {
      this.flushing = false;
    }
  }
}

export interface AsteraAppRuntimeLogger {
  log(event: AsteraAppRuntimeLogEvent): void;
}

export const TGSERVER_ZERO_PROJECT_ID = PROJECT_ID;
