import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const catalogSource = readFileSync(new URL('../functions/_catalog.ts', import.meta.url), 'utf8');
const internalBillingSource = readFileSync(new URL('../functions/_internal-billing-projection.ts', import.meta.url), 'utf8');
const creditGrantsSource = readFileSync(new URL('../functions/_credit-grants.ts', import.meta.url), 'utf8');

test('catalog loader does not expose square_* provider fields', () => {
  assert.doesNotMatch(catalogSource, /square_plan_variation_id/);
  assert.doesNotMatch(catalogSource, /square_catalog_object_id/);
});

test('internal billing auth failure uses 401 BILLING_APP_UNAUTHORIZED', () => {
  assert.match(internalBillingSource, /BILLING_APP_UNAUTHORIZED/);
  assert.match(internalBillingSource, /FunctionHttpError\(401/);
  assert.match(internalBillingSource, /get\('Authorization'\)/);
  assert.match(internalBillingSource, /Bearer\\s/);
  assert.match(internalBillingSource, /BILLING_APP_SECRET/);
});

test('internal billing rejects unknown JSON fields with 400', () => {
  assert.match(internalBillingSource, /UNKNOWN_FIELD/);
  assert.match(internalBillingSource, /FunctionHttpError\(400/);
});

test('internal billing requires idempotency_key in schema validation', () => {
  assert.match(internalBillingSource, /requiredString\(parsed, 'idempotency_key'\)/);
  assert.match(internalBillingSource, /SCHEMA_VALIDATION_FAILED/);
});

test('internal billing event projection replays by idempotency_key', () => {
  assert.match(internalBillingSource, /duplicate:\s*true/);
  assert.match(internalBillingSource, /billing_event_projections WHERE idempotency_key/);
});

test('credit grants avoid double grant via ledger idempotency_key', () => {
  assert.match(creditGrantsSource, /applyCreditGrant/);
  assert.match(creditGrantsSource, /credit_ledger WHERE idempotency_key/);
  assert.match(internalBillingSource, /applyCreditGrant/);
  assert.match(internalBillingSource, /billing_internal_idempotency/);
});

test('internal billing routes are under /api/internal/billing', () => {
  for (const route of [
    '../functions/api/internal/billing/projections/events.ts',
    '../functions/api/internal/billing/projections/subscriptions.ts',
    '../functions/api/internal/billing/grants/credits.ts',
    '../functions/api/internal/billing/grants/storage.ts',
    '../functions/api/internal/billing/intents/status.ts',
  ]) {
    const source = readFileSync(new URL(route, import.meta.url), 'utf8');
    assert.match(source, /handleInternalBillingPost/);
  }
});
