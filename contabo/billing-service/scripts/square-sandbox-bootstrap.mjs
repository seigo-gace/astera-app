import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { PLAN_ANNUAL_JPY, PLAN_MONTHLY_JPY } from './commercial-catalog-canonical.mjs';

const API_BASE = 'https://connect.squareupsandbox.com';
const SQUARE_VERSION = '2026-08-19';
const PLAN_NAME = 'AsteraTest Plans';

const PAID_SPECS = [
  { planId: 'basic', cycle: 'monthly', name: 'Astera Basic Monthly', cadence: 'MONTHLY', amount: PLAN_MONTHLY_JPY.basic },
  { planId: 'basic', cycle: 'annual', name: 'Astera Basic Annual', cadence: 'ANNUAL', amount: PLAN_ANNUAL_JPY.basic },
  { planId: 'pro', cycle: 'monthly', name: 'Astera Pro Monthly', cadence: 'MONTHLY', amount: PLAN_MONTHLY_JPY.pro },
  { planId: 'pro', cycle: 'annual', name: 'Astera Pro Annual', cadence: 'ANNUAL', amount: PLAN_ANNUAL_JPY.pro },
  { planId: 'business', cycle: 'monthly', name: 'Astera Business Monthly', cadence: 'MONTHLY', amount: PLAN_MONTHLY_JPY.business },
  { planId: 'business', cycle: 'annual', name: 'Astera Business Annual', cadence: 'ANNUAL', amount: PLAN_ANNUAL_JPY.business },
  { planId: 'enterprise', cycle: 'monthly', name: 'Astera Enterprise Monthly', cadence: 'MONTHLY', amount: PLAN_MONTHLY_JPY.enterprise },
  { planId: 'enterprise', cycle: 'annual', name: 'Astera Enterprise Annual', cadence: 'ANNUAL', amount: PLAN_ANNUAL_JPY.enterprise },
];

function resolveToken(explicitToken) {
  return (explicitToken || process.env.SQUARE_ACCESS_TOKEN || process.env.ASTERAKEY || '').trim();
}

async function square(token, path, init = {}) {
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

async function listObjects(token, type) {
  const result = [];
  let cursor = '';
  do {
    const query = new URLSearchParams({ types: type });
    if (cursor) query.set('cursor', cursor);
    const body = await square(token, `/v2/catalog/list?${query.toString()}`);
    if (Array.isArray(body?.objects)) result.push(...body.objects);
    cursor = typeof body?.cursor === 'string' ? body.cursor : '';
  } while (cursor);
  return result;
}

async function upsert(token, object) {
  const body = await square(token, '/v2/catalog/object', {
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

export function sqlQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

async function activeLocationId(token) {
  const body = await square(token, '/v2/locations');
  const locations = Array.isArray(body?.locations) ? body.locations : [];
  const active = locations.find((location) => location?.status === 'ACTIVE') || locations[0];
  if (!active?.id) throw new Error('Square Sandbox location was not found.');
  return active.id;
}

/**
 * Ensures 8 paid Square subscription plan variations exist in sandbox.
 * @returns {Promise<Record<string, { plan_id: string, billing_cycle: string, square_plan_variation_id: string, amount_jpy: number }>>}
 */
export async function ensureSquarePaidPlanVariants(tokenInput) {
  const token = resolveToken(tokenInput);
  if (!token) {
    const error = new Error('SQUARE_ACCESS_TOKEN or ASTERAKEY is required.');
    error.code = 'SQUARE_TOKEN_MISSING';
    throw error;
  }

  const locationId = await activeLocationId(token);
  const plans = await listObjects(token, 'SUBSCRIPTION_PLAN');
  let plan = plans.find((object) => planName(object) === PLAN_NAME);
  if (!plan) {
    plan = await upsert(token, {
      type: 'SUBSCRIPTION_PLAN',
      id: '#astera-test-plan',
      present_at_all_locations: true,
      subscription_plan_data: { name: PLAN_NAME },
    });
  }

  const existingVariations = await listObjects(token, 'SUBSCRIPTION_PLAN_VARIATION');
  /** @type {Record<string, { plan_id: string, billing_cycle: string, square_plan_variation_id: string, amount_jpy: number, cadence: string }>} */
  const mapping = {};

  for (const spec of PAID_SPECS) {
    let variation = existingVariations.find((object) =>
      object?.subscription_plan_variation_data?.subscription_plan_id === plan.id
      && variationName(object) === spec.name);

    if (!variation) {
      variation = await upsert(token, {
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

  return { locationId, subscriptionPlanId: plan.id, mapping };
}

async function main() {
  const { locationId, subscriptionPlanId, mapping } = await ensureSquarePaidPlanVariants();
  mkdirSync('audit-results', { recursive: true });
  const output = {
    environment: 'sandbox',
    location_id: locationId,
    subscription_plan_id: subscriptionPlanId,
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

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    if (error?.details?.errors) console.error(JSON.stringify({ errors: error.details.errors }));
    process.exit(1);
  });
}
