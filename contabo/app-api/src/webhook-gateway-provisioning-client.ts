import type { RuntimeConfig } from './config.js';
import { WebhookGatewayError } from './webhook-gateway-client.js';

export type ManagedWebhookSourceInput = {
  appId: string;
  name: string;
  slug: string;
  provider: 'standard' | 'github' | 'stripe' | 'slack' | 'telegram' | 'generic-hmac-sha256';
  secret?: string;
  secondarySecret?: string | null;
  toleranceSeconds?: number;
  enabled: boolean;
  allowedCidrs?: string[];
  generic?: {
    signatureHeader: string;
    timestampHeader?: string;
    idHeader?: string;
    eventTypeHeader?: string;
    signatureEncoding: 'hex' | 'base64';
    signaturePrefix?: string;
    signedContent: 'body' | 'timestamp.body';
  };
};

export type ManagedWebhookDestinationInput = {
  appId: string;
  name: string;
  url: string;
  method?: 'POST' | 'PUT' | 'PATCH';
  payloadMode?: 'raw' | 'json' | 'cloudevents';
  dataMode?: 'json_object' | 'base64_raw';
  successMode?: 'status_only' | 'status_and_header';
  acceptedHeader?: string;
  acceptedHeaderValue?: string;
  unknownPolicy?: 'retry_then_dead' | 'dead_immediately' | 'treat_2xx_as_delivered';
  signingSecret?: string | null;
  timeoutMs?: number;
  maxAttempts?: number;
  enabled: boolean;
  headers?: Record<string, string>;
  secretHeaders?: Record<string, string> | null;
  circuitBreaker?: { failureThreshold?: number; openSeconds?: number };
};

export type ManagedWebhookRouteInput = {
  sourceId: string;
  destinationId: string;
  eventTypePattern: string;
  enabled: boolean;
};

type FetchLike = typeof fetch;

export class WebhookGatewayProvisioningClient {
  constructor(
    private readonly origin: string,
    private readonly token: string,
    private readonly timeoutMs: number,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  static fromConfig(config: RuntimeConfig, fetchImpl: FetchLike = fetch): WebhookGatewayProvisioningClient | null {
    if (!config.webhookGatewayOrigin || !config.webhookGatewayProvisionToken) return null;
    return new WebhookGatewayProvisioningClient(
      config.webhookGatewayOrigin,
      config.webhookGatewayProvisionToken,
      config.webhookGatewayTimeoutMs,
      fetchImpl,
    );
  }

  listSources(): Promise<{ sources: unknown[] }> {
    return this.requestJson('/internal/config/sources', { method: 'GET' });
  }

  listDestinations(): Promise<{ destinations: unknown[] }> {
    return this.requestJson('/internal/config/destinations', { method: 'GET' });
  }

  listRoutes(): Promise<{ routes: unknown[] }> {
    return this.requestJson('/internal/config/routes', { method: 'GET' });
  }

  upsertSource(id: string, input: ManagedWebhookSourceInput): Promise<{ source: unknown }> {
    return this.requestJson(`/internal/config/sources/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
  }

  upsertDestination(id: string, input: ManagedWebhookDestinationInput): Promise<{ destination: unknown }> {
    return this.requestJson(`/internal/config/destinations/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
  }

  upsertRoute(id: string, input: ManagedWebhookRouteInput): Promise<{ route: unknown }> {
    return this.requestJson(`/internal/config/routes/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
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
      throw new WebhookGatewayError(503, 'WEBHOOK_GATEWAY_PROVISIONING_UNAVAILABLE', message, true);
    }

    let body: unknown = null;
    if ((response.headers.get('content-type') ?? '').includes('application/json')) {
      try { body = await response.json(); } catch { body = null; }
    } else {
      await response.body?.cancel().catch(() => undefined);
    }

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new WebhookGatewayError(
          503,
          'WEBHOOK_GATEWAY_PROVISIONING_AUTHENTICATION_FAILED',
          'Webhook Gateway provisioning authentication failed.',
          false,
        );
      }
      const message = extractMessage(body) || `Webhook Gateway provisioning returned HTTP ${response.status}`;
      const status = [400, 404, 409, 413, 422, 429].includes(response.status)
        ? response.status
        : response.status >= 500 ? 503 : 502;
      throw new WebhookGatewayError(status, 'WEBHOOK_GATEWAY_PROVISIONING_FAILED', message, response.status === 429 || response.status >= 500);
    }

    if (!body || typeof body !== 'object') {
      throw new WebhookGatewayError(502, 'WEBHOOK_GATEWAY_PROVISIONING_INVALID_RESPONSE', 'Webhook Gateway provisioning response was not valid JSON.', true);
    }
    return body as T;
  }
}

function extractMessage(body: unknown): string {
  if (!body || typeof body !== 'object') return '';
  const error = (body as Record<string, unknown>).error;
  return typeof error === 'string' ? error : '';
}
