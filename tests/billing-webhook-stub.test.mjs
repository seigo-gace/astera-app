import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const directSquareRoute = readFileSync(
  new URL('../functions/api/billing/webhooks/square.ts', import.meta.url),
  'utf8',
);

const billingProxy = readFileSync(
  new URL('../functions/_billing-service-proxy.ts', import.meta.url),
  'utf8',
);

test('direct Square billing webhook endpoint returns 410', () => {
  assert.match(directSquareRoute, /status:\s*410/);
  assert.match(directSquareRoute, /SQUARE_DIRECT_WEBHOOK_RETIRED/);
  assert.match(directSquareRoute, /webhook-gateway/);
});

test('billing proxy uses env BILLING_SERVICE_URL only', () => {
  assert.match(billingProxy, /BILLING_SERVICE_URL/);
  assert.match(billingProxy, /BILLING_SERVICE_UNAVAILABLE/);
  assert.doesNotMatch(billingProxy, /connect\.squareup/);
});
