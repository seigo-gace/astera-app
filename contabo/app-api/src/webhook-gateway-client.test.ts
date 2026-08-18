import { describe, expect, it, vi } from 'vitest';
import {
  WebhookGatewayClient,
  WebhookGatewayError,
} from './webhook-gateway-client.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('WebhookGatewayClient', () => {
  it('submits business payload unchanged with the server-only Gateway token', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe('https://webhook.asterav8.jp/internal/events');
      const headers = new Headers(init?.headers);
      expect(headers.get('authorization')).toBe('Bearer gateway-secret');
      expect(headers.get('content-type')).toBe('application/json');
      expect(JSON.parse(String(init?.body))).toEqual({
        eventId: 'evt-1',
        eventType: 'app.test',
        sourceId: 'workspace-source',
        destinationId: 'destination-1',
        data: {
          token: 'business-token',
          password: 'business-password',
        },
      });
      return jsonResponse({
        ok: true,
        duplicate: false,
        eventId: '4ba9a4d1-0000-4000-8000-000000000001',
        deliveryIds: ['4ba9a4d1-0000-4000-8000-000000000002'],
        deliveries: 1,
        enqueueMode: 'deferred+outbox',
      }, 202);
    });

    const client = new WebhookGatewayClient(
      'https://webhook.asterav8.jp',
      'gateway-secret',
      5_000,
      fetchImpl as unknown as typeof fetch,
    );

    const result = await client.submit({
      eventId: 'evt-1',
      eventType: 'app.test',
      sourceId: 'workspace-source',
      destinationId: 'destination-1',
      data: {
        token: 'business-token',
        password: 'business-password',
      },
    });
    expect(result.deliveries).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('encodes status-list query parameters', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toBe('https://webhook.asterav8.jp/internal/events?sourceId=source%2Fone&limit=25');
      return jsonResponse({ events: [] });
    });
    const client = new WebhookGatewayClient(
      'https://webhook.asterav8.jp',
      'gateway-secret',
      5_000,
      fetchImpl as unknown as typeof fetch,
    );
    await expect(client.list('source/one', 25)).resolves.toEqual({ events: [] });
  });

  it('maps Gateway rate limiting to a retryable typed error', async () => {
    const client = new WebhookGatewayClient(
      'https://webhook.asterav8.jp',
      'gateway-secret',
      5_000,
      (async () => jsonResponse({ error: 'internal api rate limited' }, 429)) as typeof fetch,
    );

    await expect(client.list()).rejects.toMatchObject({
      name: 'WebhookGatewayError',
      status: 429,
      code: 'WEBHOOK_GATEWAY_REQUEST_FAILED',
      retryable: true,
    } satisfies Partial<WebhookGatewayError>);
  });

  it('treats Gateway token/CIDR failures as server configuration failures, not customer authentication', async () => {
    for (const status of [401, 403]) {
      const client = new WebhookGatewayClient(
        'https://webhook.asterav8.jp',
        'gateway-secret',
        5_000,
        (async () => jsonResponse({ error: 'unauthorized' }, status)) as typeof fetch,
      );
      await expect(client.list()).rejects.toMatchObject({
        status: 503,
        code: 'WEBHOOK_GATEWAY_AUTHENTICATION_FAILED',
        retryable: false,
      });
    }
  });

  it('maps transport failure to service unavailable without exposing the Gateway token', async () => {
    const client = new WebhookGatewayClient(
      'https://webhook.asterav8.jp',
      'super-secret-gateway-token',
      5_000,
      (async () => { throw new Error('connect ECONNREFUSED'); }) as typeof fetch,
    );

    try {
      await client.list();
      throw new Error('expected failure');
    } catch (error) {
      expect(error).toBeInstanceOf(WebhookGatewayError);
      expect(String((error as Error).message)).not.toContain('super-secret-gateway-token');
      expect(error).toMatchObject({
        status: 503,
        code: 'WEBHOOK_GATEWAY_UNAVAILABLE',
        retryable: true,
      });
    }
  });

  it('fails closed when a successful upstream response is not JSON', async () => {
    const client = new WebhookGatewayClient(
      'https://webhook.asterav8.jp',
      'gateway-secret',
      5_000,
      (async () => new Response('not-json', { status: 200, headers: { 'content-type': 'text/plain' } })) as typeof fetch,
    );

    await expect(client.list()).rejects.toMatchObject({
      status: 502,
      code: 'WEBHOOK_GATEWAY_INVALID_RESPONSE',
      retryable: true,
    });
  });
});
