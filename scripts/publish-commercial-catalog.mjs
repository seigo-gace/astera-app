#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { assertExactCatalogSnapshot, buildChecksumPayload } from './commercial-catalog-integrity.mjs';
import {
  COMMERCIAL_CATALOG_PLANS,
  CREDIT_PRODUCTS_CANON,
  PLAN_ANNUAL_JPY,
  PLAN_INCLUDED_CREDITS_CANON,
  PLAN_MONTHLY_JPY,
  STAGING_D1,
  STORAGE_PACKS,
  STORAGE_PLAN_MAX_GB,
  newDraftCatalogVersion,
} from './commercial-catalog-canonical.mjs';
import { ensureSquarePaidPlanVariants, sqlQuote } from './square-sandbox-bootstrap.mjs';

const remote = process.argv.includes('--remote');
const databaseName = (process.env.D1_DATABASE_NAME || STAGING_D1.database_name).trim();
const expectedDatabaseId = (process.env.D1_DATABASE_ID || STAGING_D1.database_id).trim();
const skipSquare = process.argv.includes('--skip-square');
const dryRun = process.argv.includes('--dry-run');

if (databaseName !== STAGING_D1.database_name) {
  console.error(`Refusing D1 database_name=${databaseName}; only ${STAGING_D1.database_name} is allowed.`);
  process.exit(1);
}
if (/production|isolated|193ccf30/i.test(databaseName) || /193ccf30/.test(expectedDatabaseId)) {
  console.error('Refusing production or isolated D1 target.');
  process.exit(1);
}

function wranglerArgs(extra) {
  const base = ['d1', 'execute', databaseName];
  if (remote) base.push('--remote');
  return [...base, ...extra];
}

function runWrangler(extra, { allowFailure = false } = {}) {
  const result = spawnSync('npx', ['wrangler', ...wranglerArgs(extra)], {
    encoding: 'utf8',
    env: { ...process.env, WRANGLER_CACHE_DIR: process.env.WRANGLER_CACHE_DIR || '/tmp/wrangler-cache-admin1' },
  });
  const out = `${result.stdout || ''}${result.stderr || ''}`;
  if (result.status !== 0 && !allowFailure) {
    console.error(out);
    throw new Error(`wrangler d1 execute failed (${extra.join(' ')})`);
  }
  return { status: result.status, out };
}

function d1Json(command) {
  const { out } = runWrangler(['--json', '--command', command]);
  let payload;
  try {
    payload = JSON.parse(out);
  } catch {
    throw new Error(`D1 JSON parse failed: ${out.slice(0, 500)}`);
  }
  const rows = [];
  for (const entry of payload) {
    if (Array.isArray(entry?.results)) rows.push(...entry.results);
  }
  return rows;
}

function verifyDatabaseId() {
  const listed = spawnSync('npx', ['wrangler', 'd1', 'list', '--json'], {
    encoding: 'utf8',
    env: { ...process.env, WRANGLER_CACHE_DIR: process.env.WRANGLER_CACHE_DIR || '/tmp/wrangler-cache-admin1' },
  });
  if (listed.status !== 0) {
    console.error(listed.stderr || listed.stdout);
    process.exit(1);
  }
  let databases;
  try {
    databases = JSON.parse(listed.stdout || '[]');
  } catch {
    console.error('wrangler d1 list returned non-JSON output');
    process.exit(1);
  }
  const match = databases.find((row) => row?.name === databaseName);
  if (!match || match.uuid !== expectedDatabaseId) {
    console.error(`D1 binding mismatch: expected name=${databaseName} id=${expectedDatabaseId}, got ${JSON.stringify(match)}`);
    process.exit(1);
  }
  console.log(`Verified D1 target name=${databaseName} id=${expectedDatabaseId}`);
}

function tableExists(table) {
  const rows = d1Json(
    `SELECT name FROM sqlite_master WHERE type='table' AND name=${sqlQuote(table)} LIMIT 1`,
  );
  return rows.length > 0;
}

function columnExists(table, column) {
  const rows = d1Json(`PRAGMA table_info(${table})`);
  return rows.some((row) => row.name === column);
}

function ensureCommercialSchema() {
  if (!tableExists('catalog_versions')) {
    throw new Error('catalog_versions table missing; apply base D1 migrations before publish.');
  }
  if (!tableExists('plan_catalog_entries')) {
    console.log('Applying commercial catalog schema (0003 tables)...');
    runWrangler(['--file=migrations/d1/0003_commercial_catalog_square.sql']);
  }
  if (!tableExists('plan_billing_variants')) {
    console.log('Creating plan_billing_variants (0013 equivalent)...');
    runWrangler(['--command', `
      CREATE TABLE IF NOT EXISTS plan_billing_variants (
        catalog_version TEXT NOT NULL,
        plan_id TEXT NOT NULL,
        billing_cycle TEXT NOT NULL CHECK (billing_cycle IN ('monthly', 'annual')),
        recurring_amount INTEGER NOT NULL CHECK (recurring_amount >= 0),
        recurring_interval TEXT NOT NULL CHECK (recurring_interval IN ('month', 'year')),
        included_credits INTEGER NOT NULL CHECK (included_credits >= 0),
        square_plan_variation_id TEXT,
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
        created_at TEXT NOT NULL,
        PRIMARY KEY (catalog_version, plan_id, billing_cycle),
        FOREIGN KEY (catalog_version, plan_id) REFERENCES plan_catalog_entries(catalog_version, plan_id)
      );
      CREATE INDEX IF NOT EXISTS plan_billing_variants_active
        ON plan_billing_variants(catalog_version, active, plan_id, billing_cycle);
    `.replace(/\s+/g, ' ').trim()]);
  }
  if (!tableExists('astera_storage_plan_limits') || !tableExists('astera_storage_pack_catalog')) {
    console.log('Applying storage buyout pack schema (0016)...');
    runWrangler(['--file=migrations/d1/0016_storage_buyout_packs.sql']);
  }
  if (tableExists('tenant_subscriptions') && !columnExists('tenant_subscriptions', 'billing_cycle')) {
    runWrangler(['--command', `
      ALTER TABLE tenant_subscriptions
        ADD COLUMN billing_cycle TEXT NOT NULL DEFAULT 'monthly'
        CHECK (billing_cycle IN ('monthly', 'annual'));
    `.replace(/\s+/g, ' ').trim()], { allowFailure: true });
  }
  if (tableExists('billing_intents') && !columnExists('billing_intents', 'billing_cycle')) {
    runWrangler(['--command', `
      ALTER TABLE billing_intents
        ADD COLUMN billing_cycle TEXT
        CHECK (billing_cycle IS NULL OR billing_cycle IN ('monthly', 'annual'));
    `.replace(/\s+/g, ' ').trim()], { allowFailure: true });
  }
}

function insertDraftVersion(version) {
  const now = new Date().toISOString();
  runWrangler(['--command', `
    INSERT INTO catalog_versions (version, checksum, status, published_at, created_at)
    VALUES (${sqlQuote(version)}, ${sqlQuote(`draft-${version}`)}, 'draft', NULL, ${sqlQuote(now)});
  `.replace(/\s+/g, ' ').trim()]);
}

function seedPlans(version) {
  const now = new Date().toISOString();
  for (const plan of COMMERCIAL_CATALOG_PLANS) {
    const monthly = PLAN_MONTHLY_JPY[plan.plan_id] ?? 0;
    const interval = plan.recurring_interval === 'none' ? 'none' : 'month';
    const entitlements = JSON.stringify(plan.entitlement_ids);
    runWrangler(['--command', `
      INSERT INTO plan_catalog_entries
        (catalog_version, plan_id, display_name, description, currency, recurring_amount, recurring_interval,
         included_credits, entitlement_ids, recommended, display_order, active, square_plan_variation_id, created_at)
      VALUES (${sqlQuote(version)}, ${sqlQuote(plan.plan_id)}, ${sqlQuote(plan.display_name)}, ${sqlQuote(plan.description)}, 'JPY',
              ${monthly}, ${sqlQuote(interval)}, ${plan.included_credits}, ${sqlQuote(entitlements)},
              ${plan.recommended ? 1 : 0}, ${plan.display_order}, 1, NULL, ${sqlQuote(now)});
    `.replace(/\s+/g, ' ').trim()]);
  }
}

function seedBillingVariants(version) {
  const now = new Date().toISOString();
  for (const plan of COMMERCIAL_CATALOG_PLANS) {
    const monthly = PLAN_MONTHLY_JPY[plan.plan_id] ?? 0;
    runWrangler(['--command', `
      INSERT INTO plan_billing_variants
        (catalog_version, plan_id, billing_cycle, recurring_amount, recurring_interval, included_credits,
         square_plan_variation_id, active, created_at)
      VALUES (${sqlQuote(version)}, ${sqlQuote(plan.plan_id)}, 'monthly', ${monthly}, 'month', ${plan.included_credits}, NULL, 1, ${sqlQuote(now)});
    `.replace(/\s+/g, ' ').trim()]);
  }
  for (const planId of ['basic', 'pro', 'business', 'enterprise']) {
    const included = PLAN_INCLUDED_CREDITS_CANON[planId];
    const annual = PLAN_ANNUAL_JPY[planId];
    runWrangler(['--command', `
      INSERT INTO plan_billing_variants
        (catalog_version, plan_id, billing_cycle, recurring_amount, recurring_interval, included_credits,
         square_plan_variation_id, active, created_at)
      VALUES (${sqlQuote(version)}, ${sqlQuote(planId)}, 'annual', ${annual}, 'year', ${included}, NULL, 1, ${sqlQuote(now)});
    `.replace(/\s+/g, ' ').trim()]);
  }
}

function seedCreditProducts(version) {
  const now = new Date().toISOString();
  for (const product of CREDIT_PRODUCTS_CANON) {
    runWrangler(['--command', `
      INSERT INTO credit_products
        (catalog_version, product_id, display_name, description, currency, amount, credits, display_order, active, square_catalog_object_id, created_at)
      VALUES (${sqlQuote(version)}, ${sqlQuote(product.product_id)}, ${sqlQuote(product.display_name)}, '', 'JPY',
              ${product.amount}, ${product.credits}, ${product.display_order ?? 0}, 1, NULL, ${sqlQuote(now)});
    `.replace(/\s+/g, ' ').trim()]);
  }
}

function seedStorage(version) {
  for (const [planId, maxGb] of Object.entries(STORAGE_PLAN_MAX_GB)) {
    runWrangler(['--command', `
      INSERT INTO astera_storage_plan_limits (catalog_version, plan_id, max_capacity_gb, active)
      VALUES (${sqlQuote(version)}, ${sqlQuote(planId)}, ${maxGb}, 1);
    `.replace(/\s+/g, ' ').trim()]);
  }
  for (const pack of STORAGE_PACKS) {
    runWrangler(['--command', `
      INSERT INTO astera_storage_pack_catalog
        (catalog_version, product_id, display_name, capacity_gb, price_jpy, active, display_order)
      VALUES (${sqlQuote(version)}, ${sqlQuote(pack.product_id)}, ${sqlQuote(pack.display_name)}, ${pack.capacity_gb},
              ${pack.price_jpy}, 1, ${pack.display_order});
    `.replace(/\s+/g, ' ').trim()]);
  }
}

async function applySquareMappings(version) {
  if (skipSquare) {
    console.warn('Skipping Square sandbox mapping (--skip-square). Activation will be BLOCKED without 8 paid IDs.');
    return { blocked: true, reason: 'skip-square' };
  }
  try {
    const { mapping } = await ensureSquarePaidPlanVariants();
    for (const item of Object.values(mapping)) {
      runWrangler(['--command', `
        UPDATE plan_billing_variants
        SET square_plan_variation_id=${sqlQuote(item.square_plan_variation_id)}
        WHERE catalog_version=${sqlQuote(version)}
          AND plan_id=${sqlQuote(item.plan_id)}
          AND billing_cycle=${sqlQuote(item.billing_cycle)};
      `.replace(/\s+/g, ' ').trim()]);
    }
    return { blocked: false, mapping };
  } catch (error) {
    const code = error?.code || 'SQUARE_BOOTSTRAP_FAILED';
    console.warn(`BLOCKED: Square mapping unavailable (${code}).`);
    return { blocked: true, reason: code };
  }
}

function fetchCatalogRows(version) {
  const plans = d1Json(`
    SELECT plan_id, display_name, currency, recurring_amount, recurring_interval, included_credits, entitlement_ids, recommended, active
    FROM plan_catalog_entries WHERE catalog_version=${sqlQuote(version)} AND active=1 ORDER BY plan_id ASC
  `);
  const variants = d1Json(`
    SELECT plan_id, billing_cycle, recurring_amount, recurring_interval, included_credits, square_plan_variation_id, active
    FROM plan_billing_variants WHERE catalog_version=${sqlQuote(version)} AND active=1
    ORDER BY plan_id ASC, billing_cycle ASC
  `);
  const credits = d1Json(`
    SELECT product_id, display_name, currency, amount, credits, active
    FROM credit_products WHERE catalog_version=${sqlQuote(version)} AND active=1 ORDER BY product_id ASC
  `);
  const limits = d1Json(`
    SELECT plan_id, max_capacity_gb, active FROM astera_storage_plan_limits
    WHERE catalog_version=${sqlQuote(version)} AND active=1 ORDER BY plan_id ASC
  `);
  const packs = d1Json(`
    SELECT product_id, display_name, capacity_gb, price_jpy, active, display_order
    FROM astera_storage_pack_catalog WHERE catalog_version=${sqlQuote(version)} AND active=1
    ORDER BY display_order ASC, product_id ASC
  `);
  return { plans, variants, credits, limits, packs };
}

function computeChecksum(snapshot) {
  return createHash('sha256').update(JSON.stringify(buildChecksumPayload(snapshot))).digest('hex');
}

function activateCatalogSingleTransaction(version, checksum) {
  const publishedAt = new Date().toISOString();
  const sql = `
    BEGIN TRANSACTION;
    UPDATE catalog_versions SET status='retired' WHERE status='active';
    UPDATE catalog_versions
      SET checksum=${sqlQuote(checksum)}, published_at=${sqlQuote(publishedAt)}, status='active'
      WHERE version=${sqlQuote(version)};
    COMMIT;
  `.replace(/\s+/g, ' ').trim();
  runWrangler(['--command', sql]);
}

async function main() {
  verifyDatabaseId();
  ensureCommercialSchema();

  const version = newDraftCatalogVersion();
  console.log(`Creating new draft catalog version=${version}`);
  insertDraftVersion(version);
  seedPlans(version);
  seedBillingVariants(version);
  seedCreditProducts(version);
  seedStorage(version);

  const square = await applySquareMappings(version);
  const snapshot = fetchCatalogRows(version);

  if (square.blocked) {
    console.log(JSON.stringify({
      ok: false,
      blocked: true,
      reason: square.reason,
      catalog_version: version,
      message: 'Activation blocked: 8 paid Square plan variation IDs required.',
    }));
    process.exit(square.blocked && !dryRun ? 2 : 0);
  }

  assertExactCatalogSnapshot(snapshot);
  const checksum = computeChecksum(snapshot);

  if (dryRun) {
    console.log(JSON.stringify({ ok: true, dry_run: true, catalog_version: version, checksum }));
    return;
  }

  activateCatalogSingleTransaction(version, checksum);

  const activeCount = d1Json(`SELECT COUNT(*) AS c FROM catalog_versions WHERE status='active'`);
  if (Number(activeCount[0]?.c) !== 1) throw new Error('one_active_catalog invariant failed');

  console.log(JSON.stringify({
    ok: true,
    catalog_version: version,
    checksum,
    plan_count: snapshot.plans.length,
    variant_count: snapshot.variants.length,
    credit_products: snapshot.credits.length,
    storage_limits: snapshot.limits.length,
    storage_packs: snapshot.packs.length,
    square_paid_mappings: snapshot.variants.filter((row) => row.plan_id !== 'free' && row.square_plan_variation_id).length,
  }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
