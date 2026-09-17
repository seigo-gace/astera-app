import assert from 'node:assert/strict';
import { accessSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const squareWebhookPath = new URL('../functions/api/billing/webhooks/square.ts', import.meta.url);

const billingProxy = readFileSync(
  new URL('../functions/_billing-service-proxy.ts', import.meta.url),
  'utf8',
);

test('direct Square billing webhook route file is removed', () => {
  assert.throws(() => accessSync(squareWebhookPath), /ENOENT|not found/i);
});

test('billing proxy uses env BILLING_SERVICE_URL only', () => {
  assert.match(billingProxy, /BILLING_SERVICE_URL/);
  assert.match(billingProxy, /BILLING_SERVICE_UNAVAILABLE/);
  assert.doesNotMatch(billingProxy, /connect\.squareup/);
});
