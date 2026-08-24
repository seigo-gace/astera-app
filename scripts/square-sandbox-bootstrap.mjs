import { mkdirSync, writeFileSync } from 'node:fs';

const API_BASE = 'https://connect.squareupsandbox.com';
const SQUARE_VERSION = '2026-08-19';
const PLAN_NAME = 'AsteraTest Plans';
const token = (process.env.SQUARE_ACCESS_TOKEN || process.env.ASTERAKEY || '').trim();

if (!token) {
  console.error('SQUARE_ACCESS_TOKEN or ASTERAKEY is required.');
  process.exit(1);
}

const variants = [
  { planId: 'basic', cycle: 'monthly', name: 'Astera Basic Monthly', cadence: 'MONTHLY', amount: 980 },
  { planId: 'basic', cycle: 'annual', name: 'Astera Basic Annual', cadence: 'ANNUAL', amount: 9800 },
  { planId: 'pro', cycle: 'monthly', name: 'Astera Pro Monthly', cadence: 'MONTHLY', amount: 2980 },
  { planId: 'pro', cycle: 'annual', name: 'Astera Pro Annual', cadence: 'ANNUAL', amount: 29800 },
  { planId: 'business', cycle: 'monthly', name: 'Astera Business Monthly', cadence: 'MONTHLY', amount: 9980 },
  { planId: 'business', cycle: 'annual', name: 'Astera Business Annual', cadence: 'ANNUAL', amount: 99800 },
  { planId: 'enterprise', cycle: 'monthly', name: 'Astera Enterprise Monthly', cadence: 'MONTHLY', amount: 29800 },
  { planId: 'enterprise', cycle: 'annual', name: 'Astera Enterprise Annual', cadence: 'ANNUAL', amount: 298000 },
];

async function square(path, init = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Square-Version': SQUARE_VERSION,
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(`Square ${path} failed: HTTP ${response.status}`);
    error.details = body;
    throw error;
  }
  return body;
}

async function listObjects(type) {
  const result = [];
  let cursor = '';
  do {
    const query = new URLSearchParams({ types: type });
    if (cursor) query.set('cursor', cursor);
    const body = await square(`/v2/catalog/list?${query.toString()}`);
    if (Array.isArray(body?.objects)) result.push(...body.objects);
    cursor = typeof body?.cursor === 'string' ? body.cursor : '';
  } while (cursor);
  return result;
}

async function upsert(object) {
  const body = await square('/v2/catalog/object', {
    method: 'POST',
    body: JSON.stringify({ idempotency_key: crypto.randomUUID(), object }),
  });
  if (!body?.catalog_object?.id) throw new Error('Square did not return catalog_object.id');
  return body.catalog_object;
}

function planName(object) {
  return object?.subscription_plan_data?.name || '';
}

function variationName(object) {
  return object?.subscription_plan_variation_data?.name || '';
}

function sqlQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

async function activeLocationId() {
  const body = await square('/v2/locations');
  const locations = Array.isArray(body?.locations) ? body.locations : [];
  const active = locations.find((location) => location?.status === 'ACTIVE') || locations[0];
  if (!active?.id) throw new Error('Square Sandbox location was not found.');
  return active.id;
}

async function main() {
  const locationId = await activeLocationId();
  const plans = await listObjects('SUBSCRIPTION_PLAN');
  let plan = plans.find((object) => planName(object) === PLAN_NAME);
  if (!plan) {
    plan = await upsert({
      type: 'SUBSCRIPTION_PLAN',
      id: '#astera-test-plan',
      present_at_all_locations: true,
      subscription_plan_data: { name: PLAN_NAME },
    });
  }

  const existingVariations = await listObjects('SUBSCRIPTION_PLAN_VARIATION');
  const mapping = {};

  for (const spec of variants) {
    let variation = existingVariations.find((object) =>
      object?.subscription_plan_variation_data?.subscription_plan_id === plan.id
      && variationName(object) === spec.name);

    if (!variation) {
      variation = await upsert({
        type: 'SUBSCRIPTION_PLAN_VARIATION',
        id: `#astera-${spec.planId}-${spec.cycle}`,
        present_at_all_locations: true,
        subscription_plan_variation_data: {
          name: spec.name,
          phases: [{
            cadence: spec.cadence,
            ordinal: 0,
            pricing: {
              type: 'STATIC',
              price_money: { amount: spec.amount, currency: 'JPY' },
            },
          }],
          subscription_plan_id: plan.id,
        },
      });
    }

    mapping[`${spec.planId}:${spec.cycle}`] = {
      plan_id: spec.planId,
      billing_cycle: spec.cycle,
      square_plan_variation_id: variation.id,
      amount_jpy: spec.amount,
      cadence: spec.cadence,
    };
  }

  mkdirSync('audit-results', { recursive: true });
  const output = {
    environment: 'sandbox',
    location_id: locationId,
    subscription_plan_id: plan.id,
    subscription_plan_name: PLAN_NAME,
    generated_at: new Date().toISOString(),
    variants: mapping,
  };
  writeFileSync(
    'audit-results/square-sandbox-billing-map.json',
    `${JSON.stringify(output, null, 2)}\n`,
  );

  const sql = [
    'BEGIN TRANSACTION;',
    ...Object.values(mapping).map((item) =>
      `UPDATE plan_billing_variants SET square_plan_variation_id=${sqlQuote(item.square_plan_variation_id)} WHERE catalog_version=(SELECT version FROM catalog_versions WHERE status='active' LIMIT 1) AND plan_id=${sqlQuote(item.plan_id)} AND billing_cycle=${sqlQuote(item.billing_cycle)};`,
    ),
    'COMMIT;',
    '',
  ].join('\n');
  writeFileSync('audit-results/square-sandbox-billing-map.sql', sql);
  writeFileSync('audit-results/square-sandbox-location.txt', `${locationId}\n`);

  console.log(`PASS AsteraTest Square Sandbox billing variants=${Object.keys(mapping).length}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  if (error?.details?.errors) console.error(JSON.stringify({ errors: error.details.errors }));
  process.exit(1);
});
