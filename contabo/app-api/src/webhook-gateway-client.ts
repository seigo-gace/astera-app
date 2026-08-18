import type { RuntimeConfig } from './config.js';

export type WebhookGatewaySubmitRequest = {
  eventId: string;
  eventType: string;
  sourceId: string;
  destinationId: string;
  subject?: string;
  data: unknown;
  time?: string;
};

export type WebhookGatewayAccepted = {
  ok: true;
  duplicate: boolean;
  eventId: string;
  deliveryIds: string[];
  deliveries: number;
  enqueueMode: 'deferred+outbox' | 'none';
};

export type WebhookGatewayEventStatus = {
  eventId: string;
  sourceId: string;
  provider: string;
  callerEventId: string;
  eventType: string;
  status: string;
  receivedAt: string;
  updatedAt: string;
};

export type WebhookGatewayDeliveryStatus = {
  deliveryId: string;
  destinationId: string;
  routeId: string;
  status: 'queued' | 'delivering' | 'delivered' | 'retrying' | 'unknown' | 'dead' | 'skipped';
  attemptCount: number;
  maxAttempts: number;
  lastStatusCode: number | null;
  lastError: string | null;
  nextAttemptAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type WebhookGatewayEventList = {
  events: WebhookGatewayEventStatus[];
};

export type WebhookGatewayEventDetail = {
  event: WebhookGatewayEventStatus;
  deliveries: WebhookGatewayDeliveryStatus[];
};

export class WebhookGatewayError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'WebhookGatewayError';
  }
}

type FetchLike = typeof fetch;

export class WebhookGatewayClient {
  constructor(
    private readonly origin: string,
    private readonly token: string,
    private readonly timeoutMs: number,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  static fromConfig(config: RuntimeConfig, fetchImpl: FetchLike = fetch): WebhookGatewayClient | null {
    if (!config.webhookGatewayOrigin || !config.webhookGatewayToken) return null;
    return new WebhookGatewayClient(
      config.webhookGatewayOrigin,
      config.webhookGatewayToken,
      config.webhookGatewayTimeoutMs,
      fetchImpl,
    );
  }

  submit(input: WebhookGatewaySubmitRequest): Promise<WebhookGatewayAccepted> {
    return this.requestJson<WebhookGatewayAccepted>('/internal/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
  }

  list(sourceId?: string, limit?: number): Promise<WebhookGatewayEventList> {
    const search = new URLSearchParams();
    if (sourceId) search.set('sourceId', sourceId);
    if (limit !== undefined) search.set('limit', String(limit));
    const suffix = search.size > 0 ? `?${search.toString()}` : '';
    return this.requestJson<WebhookGatewayEventList>(`/internal/events${suffix}`, { method: 'GET' });
  }

  detail(eventId: string): Promise<WebhookGatewayEventDetail> {
    return this.requestJson<WebhookGatewayEventDetail>(`/internal/events/${encodeURIComponent(eventId)}`, { method: 'GET' });
  }

  private async requestJson<T>(path: string, init: RequestInit): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('authorization', `Bearer ${this.token}`);
    headers.set('accept', 'application/json');

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.origin}${path}`, {
        ...init,
        headers,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new WebhookGatewayError(503, 'WEBHOOK_GATEWAY_UNAVAILABLE', message, true);
    }

    const contentType = response.headers.get('content-type') ?? '';
    let body: unknown = null;
    if (contentType.includes('application/json')) {
      try {
        body = await response.json();
      } catch {
        body = null;
      }
    } else {
      await response.body?.cancel().catch(() => undefined);
    }

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new WebhookGatewayError(
          503,
          'WEBHOOK_GATEWAY_AUTHENTICATION_FAILED',
          'Webhook Gateway server authentication failed.',
          false,
        );
      }
      const upstreamMessage = extractUpstreamMessage(body);
      throw new WebhookGatewayError(
        mapUpstreamStatus(response.status),
        'WEBHOOK_GATEWAY_REQUEST_FAILED',
        upstreamMessage || `Webhook Gateway returned HTTP ${response.status}`,
        response.status === 429 || response.status >= 500,
      );
    }

    if (body === null || typeof body !== 'object') {
      throw new WebhookGatewayError(502, 'WEBHOOK_GATEWAY_INVALID_RESPONSE', 'Webhook Gateway response was not valid JSON.', true);
    }
    return body as T;
  }
}

function extractUpstreamMessage(body: unknown): string {
  if (!body || typeof body !== 'object') return '';
  const record = body as Record<string, unknown>;
  if (typeof record.error === 'string') return record.error;
  if (record.error && typeof record.error === 'object') {
    const nested = record.error as Record<string, unknown>;
    return typeof nested.message === 'string' ? nested.message : '';
  }
  return '';
}

function mapUpstreamStatus(status: number): number {
  if (status === 400 || status === 404 || status === 413 || status === 422 || status === 429) {
    return status;
  }
  return status >= 500 ? 503 : 502;
}
