import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  SQUARE_SUPPORTED_EVENT_TYPES,
  extractSquareEventProjection,
  verifyGatewayStandardWebhook,
} from '../scripts/square-webhook-support.mjs';

const directSquareRoute = readFileSync(
  new URL('../functions/api/billing/webhooks/square.ts', import.meta.url),
  'utf8',
);

test('direct Square billing webhook endpoint returns 410', () => {
  assert.match(directSquareRoute, /status:\s*410/);
  assert.match(directSquareRoute, /SQUARE_DIRECT_WEBHOOK_RETIRED/);
});

test('Square supported event types count is 19', () => {
  assert.equal(SQUARE_SUPPORTED_EVENT_TYPES.length, 19);
});

test('handler re-exports canonical 19-event support list', () => {
  const handlerSource = readFileSync(
    new URL('../functions/_square-event-handler.ts', import.meta.url),
    'utf8',
  );
  assert.match(handlerSource, /square-webhook-support\.mjs/);
});

test('Square projection stores business ids only (no PII fields)', () => {
  const projection = extractSquareEventProjection({
    event_id: 'evt-1',
    type: 'payment.updated',
    created_at: '2026-09-17T00:00:00Z',
    data: {
      type: 'payment',
      id: 'pay-1',
      object: {
        payment: {
          id: 'pay-1',
          status: 'COMPLETED',
          order_id: 'ord-1',
          amount_money: { amount: 480, currency: 'JPY' },
          card_details: { card: { last_4: '1111' } },
          buyer_email_address: 'secret@example.com',
        },
      },
    },
  });
  assert.equal(projection.object_id, 'pay-1');
  assert.equal(projection.amount, 480);
  const serialized = JSON.stringify(projection);
  assert.doesNotMatch(serialized, /secret@example.com/);
  assert.doesNotMatch(serialized, /last_4/);
  assert.doesNotMatch(serialized, /buyer_email/);
});

test('Gateway Standard Webhooks signature accepts valid v1 signature', async () => {
  const secret = 'test-gateway-secret';
  const body = JSON.stringify({ event_id: 'evt-2', type: 'payout.paid', data: { object: { payout: { id: 'po-1' } } } });
  const id = 'msg_123';
  const timestamp = `${Math.floor(Date.now() / 1000)}`;
  const signedContent = `${id}.${timestamp}.${body}`;
  const digest = createHmac('sha256', secret).update(signedContent).digest('base64');
  const request = new Request('https://staging.example/api/internal/webhooks/square', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'webhook-id': id,
      'webhook-timestamp': timestamp,
      'webhook-signature': `v1,${digest}`,
      'x-gace-provider': 'square',
    },
    body,
  });
  const ok = await verifyGatewayStandardWebhook(request, body, secret);
  assert.equal(ok, true);
});

test('Gateway Standard Webhooks signature rejects tampered body', async () => {
  const secret = 'test-gateway-secret';
  const body = JSON.stringify({ event_id: 'evt-3', type: 'refund.created' });
  const id = 'msg_456';
  const timestamp = `${Math.floor(Date.now() / 1000)}`;
  const signedContent = `${id}.${timestamp}.${body}`;
  const digest = createHmac('sha256', secret).update(signedContent).digest('base64');
  const request = new Request('https://staging.example/api/internal/webhooks/square', {
    method: 'POST',
    headers: {
      'webhook-id': id,
      'webhook-timestamp': timestamp,
      'webhook-signature': `v1,${digest}`,
      'x-gace-provider': 'square',
    },
    body: `${body} `,
  });
  const ok = await verifyGatewayStandardWebhook(request, `${body} `, secret);
  assert.equal(ok, false);
});
