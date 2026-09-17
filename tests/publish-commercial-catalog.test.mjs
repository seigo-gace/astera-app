import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const publisherSource = readFileSync(
  new URL('../scripts/publish-commercial-catalog.mjs', import.meta.url),
  'utf8',
);

test('publisher supports resume-version and cleanup-failed-drafts flags', () => {
  assert.match(publisherSource, /argValue\('--resume-version'\)/);
  assert.match(publisherSource, /--cleanup-failed-drafts/);
  assert.match(publisherSource, /assertResumeEligible/);
});

test('publisher seeds use ON CONFLICT upserts', () => {
  assert.match(publisherSource, /ON CONFLICT\(catalog_version, plan_id\) DO UPDATE/);
  assert.match(publisherSource, /ON CONFLICT\(catalog_version, product_id\) DO UPDATE/);
  assert.match(publisherSource, /ON CONFLICT\(catalog_version, plan_id, billing_cycle\) DO UPDATE/);
});

test('publisher retries transient wrangler failures only', () => {
  assert.match(publisherSource, /isTransientWranglerFailure/);
  assert.match(publisherSource, /fetch failed/);
  assert.doesNotMatch(publisherSource, /retry.*canonical mismatch/i);
});

test('publisher delegates paid plan provider mapping to astera-billing', () => {
  assert.match(publisherSource, /astera-billing/);
  assert.doesNotMatch(publisherSource, /SQUARE_ACCESS_TOKEN/);
  assert.doesNotMatch(publisherSource, /ensureSquarePaidPlanVariants/);
});

test('cleanup removes only unreferenced draft versions', () => {
  assert.match(publisherSource, /isVersionReferenced/);
  assert.match(publisherSource, /status='draft'/);
  assert.match(publisherSource, /published_at IS NULL/);
  assert.match(publisherSource, /DELETE FROM catalog_versions/);
});
