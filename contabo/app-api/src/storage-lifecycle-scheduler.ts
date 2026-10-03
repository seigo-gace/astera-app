import { createHmac, randomUUID } from 'node:crypto';
import type { RuntimeConfig } from './config.js';

export const STORAGE_LIFECYCLE_PATH = '/api/internal/storage/lifecycle';
export const DEFAULT_STORAGE_LIFECYCLE_INTERVAL_MS = 5 * 60 * 1000;
export const DEFAULT_STORAGE_LIFECYCLE_TIMEOUT_MS = 60 * 1000;

type LifecycleResponse = {
  status?: string;
  claimed?: number;
  purged?: number;
  finalized_from_receipt?: number;
  failed?: number;
  overdue_24h?: number;
};

type FetchLike = typeof fetch;

function requiredOrigin(config: RuntimeConfig): string {
  const raw = config.storageLifecycleOrigin?.trim();
  if (!raw) throw new Error('ASTERA_STORAGE_LIFECYCLE_ORIGIN_NOT_CONFIGURED');
  const url = new URL(raw);
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '::1'].includes(url.hostname)) {
    throw new Error('ASTERA_STORAGE_LIFECYCLE_ORIGIN_HTTPS_REQUIRED');
  }
  url.pathname = '/';
  url.search = '';
  url.hash = '';
  return url.toString();
}

export function storageLifecycleSignature(
  secret: string,
  timestamp: string,
  method = 'POST',
  pathname = STORAGE_LIFECYCLE_PATH,
): string {
  const payload = `${timestamp}\n${method.toUpperCase()}\n${pathname}`;
  return createHmac('sha256', secret).update(payload).digest('hex');
}

export class StorageLifecycleScheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;

  constructor(
    private readonly config: RuntimeConfig,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  async runOnce(): Promise<LifecycleResponse | { status: 'skipped_busy' }> {
    if (this.running) return { status: 'skipped_busy' };
    this.running = true;
    try {
      const base = requiredOrigin(this.config);
      const target = new URL(STORAGE_LIFECYCLE_PATH, base);
      const timestamp = String(this.now());
      const signature = storageLifecycleSignature(
        this.config.internalServiceToken,
        timestamp,
        'POST',
        target.pathname,
      );
      const timeoutMs = this.config.storageLifecycleTimeoutMs ?? DEFAULT_STORAGE_LIFECYCLE_TIMEOUT_MS;
      const response = await this.fetchImpl(target, {
        method: 'POST',
        headers: {
          'X-Astera-Lifecycle-Timestamp': timestamp,
          'X-Astera-Lifecycle-Signature': signature,
          'X-Correlation-ID': randomUUID(),
          'Cache-Control': 'no-store',
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
      const body = await response.json().catch(() => ({})) as LifecycleResponse;
      if (!response.ok) {
        throw new Error(`STORAGE_LIFECYCLE_HTTP_${response.status}`);
      }
      if (body.status === 'partial' || Number(body.failed ?? 0) > 0) {
        throw new Error(`STORAGE_LIFECYCLE_PARTIAL_FAILED_${Number(body.failed ?? 0)}`);
      }
      console.log(JSON.stringify({
        level: 'info',
        event: 'storage_lifecycle_completed',
        claimed: Number(body.claimed ?? 0),
        purged: Number(body.purged ?? 0),
        finalized_from_receipt: Number(body.finalized_from_receipt ?? 0),
        overdue_24h: Number(body.overdue_24h ?? 0),
      }));
      return body;
    } finally {
      this.running = false;
    }
  }

  start(): void {
    if (this.timer || this.stopped) return;
    const intervalMs = this.config.storageLifecycleIntervalMs ?? DEFAULT_STORAGE_LIFECYCLE_INTERVAL_MS;
    const invoke = () => {
      void this.runOnce().catch((error) => {
        console.error(JSON.stringify({
          level: 'error',
          event: 'storage_lifecycle_failed',
          error: error instanceof Error ? error.message : String(error),
        }));
      });
    };
    invoke();
    this.timer = setInterval(invoke, intervalMs);
    this.timer.unref();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
