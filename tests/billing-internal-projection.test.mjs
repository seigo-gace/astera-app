import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const catalogSource = readFileSync(new URL('../functions/_catalog.ts', import.meta.url), 'utf8');
const proxySource = readFileSync(new URL('../functions/_billing-service-proxy.ts', import.meta.url), 'utf8');
const ensureGrantsSource = readFileSync(new URL('../functions/_billing-ensure-grants.ts', import.meta.url), 'utf8');

test('catalog loader does not expose square_* provider fields', () => {
  assert.doesNotMatch(catalogSource, /square_plan_variation_id/);
  assert.doesNotMatch(catalogSource, /square_catalog_object_id/);
});

test('internal billing projection files removed from public app', () => {
  assert.equal(existsSync(new URL('../functions/_internal-billing-projection.ts', import.meta.url)), false);
  assert.equal(existsSync(new URL('../functions/_credit-grants.ts', import.meta.url)), false);
  for (const route of [
    '../functions/api/internal/billing/projections/events.ts',
    '../functions/api/internal/billing/projections/subscriptions.ts',
    '../functions/api/internal/billing/grants/credits.ts',
    '../functions/api/internal/billing/grants/storage.ts',
    '../functions/api/internal/billing/intents/status.ts',
  ]) {
    assert.equal(existsSync(new URL(route, import.meta.url)), false);
  }
});

test('public app uses billing proxy for ensure-grants', () => {
  assert.match(ensureGrantsSource, /proxyBillingRequest/);
  assert.match(ensureGrantsSource, /\/api\/billing\/ensure-grants/);
  assert.match(proxySource, /BILLING_SERVICE_URL/);
  assert.match(proxySource, /BILLING_APP_SECRET/);
});
