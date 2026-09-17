#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  CREDIT_PRODUCTS_CANON,
  DEFAULT_CATALOG_VERSION,
  PLAN_ANNUAL_JPY,
  PLAN_INCLUDED_CREDITS_CANON,
  PLAN_MONTHLY_JPY,
  STAGING_D1,
  STORAGE_PACKS,
  STORAGE_PLAN_MAX_GB,
} from './commercial-catalog-canonical.mjs';

const remote = process.argv.includes('--remote');
const databaseName = (process.env.D1_DATABASE_NAME || STAGING_D1.database_name).trim();
const expectedDatabaseId = (process.env.D1_DATABASE_ID || STAGING_D1.database_id).trim();
const catalogVersion = (process.env.COMMERCIAL_CATALOG_VERSION || DEFAULT_CATALOG_VERSION).trim();

if (databaseName !== STAGING_D1.database_name) {
  console.error(`Refusing D1 database_name=${databaseName}; only ${STAGING_D1.database_name} is allowed.`);
  process.exit(1);
}
if (/production|isolated|193ccf30/i.test(databaseName) || /193ccf30/.test(expectedDatabaseId)) {
  console.error('Refusing production or isolated D1 target.');
  process.exit(1);
}

function sqlQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
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

function upsertDraftVersion(version) {
  const now = new Date().toISOString();
  runWrangler(['--command', `
    INSERT INTO catalog_versions (version, checksum, status, published_at, created_at)
    VALUES (${sqlQuote(version)}, ${sqlQuote(`draft-${version}`)}, 'draft', NULL, ${sqlQuote(now)})
    ON CONFLICT(version) DO UPDATE SET
      status = CASE WHEN catalog_versions.status = 'active' THEN 'active' ELSE 'draft' END
    WHERE catalog_versions.version = ${sqlQuote(version)};
  `.replace(/\s+/g, ' ').trim()]);
}

function seedPlansIfAllowed(version) {
  if (PLAN_INCLUDED_CREDITS_CANON == null) {
    console.warn('BLOCKED: PLAN_INCLUDED_CREDITS_CANON missing on origin/main; skipping plan_catalog_entries seed.');
    return false;
  }
  const now = new Date().toISOString();
  for (const [planId, includedCredits] of Object.entries(PLAN_INCLUDED_CREDITS_CANON)) {
    const monthly = PLAN_MONTHLY_JPY[planId] ?? 0;
    runWrangler(['--command', `
      INSERT INTO plan_catalog_entries
        (catalog_version, plan_id, display_name, description, currency, recurring_amount, recurring_interval,
         included_credits, entitlement_ids, recommended, display_order, active, square_plan_variation_id, created_at)
      VALUES (${sqlQuote(version)}, ${sqlQuote(planId)}, ${sqlQuote(planId)}, '', 'JPY', ${monthly}, 'month', ${includedCredits},
              '[]', 0, 0, 1, NULL, ${sqlQuote(now)})
      ON CONFLICT(catalog_version, plan_id) DO UPDATE SET
        recurring_amount=excluded.recurring_amount,
        included_credits=excluded.included_credits,
        active=1;
    `.replace(/\s+/g, ' ').trim()]);
  }
  return true;
}

function seedBillingVariants(version) {
  const now = new Date().toISOString();
  for (const planId of ['free', 'basic', 'pro', 'business', 'enterprise']) {
    runWrangler(['--command', `
      INSERT INTO plan_billing_variants
        (catalog_version, plan_id, billing_cycle, recurring_amount, recurring_interval, included_credits,
         square_plan_variation_id, active, created_at)
      SELECT ${sqlQuote(version)}, ${sqlQuote(planId)}, 'monthly', p.recurring_amount, 'month',
             p.included_credits, p.square_plan_variation_id, p.active, ${sqlQuote(now)}
      FROM plan_catalog_entries p
      WHERE p.catalog_version=${sqlQuote(version)} AND p.plan_id=${sqlQuote(planId)}
      ON CONFLICT(catalog_version, plan_id, billing_cycle) DO UPDATE SET
        recurring_amount=excluded.recurring_amount,
        included_credits=excluded.included_credits,
        active=1;
    `.replace(/\s+/g, ' ').trim()], { allowFailure: true });
  }
  for (const planId of ['basic', 'pro', 'business', 'enterprise']) {
    const annual = PLAN_ANNUAL_JPY[planId];
    runWrangler(['--command', `
      INSERT INTO plan_billing_variants
        (catalog_version, plan_id, billing_cycle, recurring_amount, recurring_interval, included_credits,
         square_plan_variation_id, active, created_at)
      SELECT ${sqlQuote(version)}, ${sqlQuote(planId)}, 'annual', ${annual}, 'year', p.included_credits, NULL, p.active, ${sqlQuote(now)}
      FROM plan_catalog_entries p
      WHERE p.catalog_version=${sqlQuote(version)} AND p.plan_id=${sqlQuote(planId)}
      ON CONFLICT(catalog_version, plan_id, billing_cycle) DO UPDATE SET
        recurring_amount=excluded.recurring_amount,
        active=1;
    `.replace(/\s+/g, ' ').trim()], { allowFailure: true });
  }
}

function seedCreditProductsIfAllowed(version) {
  if (!Array.isArray(CREDIT_PRODUCTS_CANON) || CREDIT_PRODUCTS_CANON.length === 0) {
    console.warn('BLOCKED: CREDIT_PRODUCTS_CANON missing; skipping credit_products seed.');
    return false;
  }
  const now = new Date().toISOString();
  for (const product of CREDIT_PRODUCTS_CANON) {
    runWrangler(['--command', `
      INSERT INTO credit_products
        (catalog_version, product_id, display_name, description, currency, amount, credits, display_order, active, square_catalog_object_id, created_at)
      VALUES (${sqlQuote(version)}, ${sqlQuote(product.product_id)}, ${sqlQuote(product.display_name)}, '', 'JPY',
              ${product.amount}, ${product.credits}, ${product.display_order ?? 0}, 1, NULL, ${sqlQuote(now)})
      ON CONFLICT(catalog_version, product_id) DO UPDATE SET amount=excluded.amount, credits=excluded.credits, active=1;
    `.replace(/\s+/g, ' ').trim()]);
  }
  return true;
}

function upsertStorageCanon(version) {
  for (const [planId, maxGb] of Object.entries(STORAGE_PLAN_MAX_GB)) {
    runWrangler(['--command', `
      INSERT INTO astera_storage_plan_limits (catalog_version, plan_id, max_capacity_gb, active)
      VALUES (${sqlQuote(version)}, ${sqlQuote(planId)}, ${maxGb}, 1)
      ON CONFLICT(catalog_version, plan_id) DO UPDATE SET max_capacity_gb=excluded.max_capacity_gb, active=1;
    `.replace(/\s+/g, ' ').trim()]);
  }
  for (const pack of STORAGE_PACKS) {
    runWrangler(['--command', `
      INSERT INTO astera_storage_pack_catalog
        (catalog_version, product_id, display_name, capacity_gb, price_jpy, active, display_order)
      VALUES (${sqlQuote(version)}, ${sqlQuote(pack.product_id)}, ${sqlQuote(pack.display_name)}, ${pack.capacity_gb},
              ${pack.price_jpy}, 1, ${pack.display_order})
      ON CONFLICT(catalog_version, product_id) DO UPDATE SET
        display_name=excluded.display_name,
        capacity_gb=excluded.capacity_gb,
        price_jpy=excluded.price_jpy,
        active=1,
        display_order=excluded.display_order;
    `.replace(/\s+/g, ' ').trim()]);
  }
}

function fetchCatalogRows(version) {
  const plans = d1Json(`
    SELECT plan_id, display_name, currency, recurring_amount, recurring_interval, included_credits, entitlement_ids, recommended, active
    FROM plan_catalog_entries WHERE catalog_version=${sqlQuote(version)} AND active=1 ORDER BY plan_id ASC
  `);
  const variants = d1Json(`
    SELECT plan_id, billing_cycle, recurring_amount, recurring_interval, included_credits, active
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
  const normalized = {
    plans: snapshot.plans.map((row) => ({
      plan_id: row.plan_id,
      recurring_amount: Number(row.recurring_amount),
      recurring_interval: row.recurring_interval,
      included_credits: Number(row.included_credits),
      entitlement_ids: row.entitlement_ids,
      recommended: Number(row.recommended),
      active: Number(row.active),
    })),
    billing_variants: snapshot.variants.map((row) => ({
      plan_id: row.plan_id,
      billing_cycle: row.billing_cycle,
      recurring_amount: Number(row.recurring_amount),
      recurring_interval: row.recurring_interval,
      included_credits: Number(row.included_credits),
      active: Number(row.active),
    })),
    credit_products: snapshot.credits.map((row) => ({
      product_id: row.product_id,
      amount: Number(row.amount),
      credits: Number(row.credits),
      active: Number(row.active),
    })),
    storage_limits: snapshot.limits.map((row) => ({
      plan_id: row.plan_id,
      max_capacity_gb: Number(row.max_capacity_gb),
      active: Number(row.active),
    })),
    storage_packs: snapshot.packs.map((row) => ({
      product_id: row.product_id,
      capacity_gb: Number(row.capacity_gb),
      price_jpy: Number(row.price_jpy),
      active: Number(row.active),
      display_order: Number(row.display_order),
    })),
  };
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

function assertIntegrity(version, snapshot) {
  const expectedLimits = Object.entries(STORAGE_PLAN_MAX_GB).map(([plan_id, max_capacity_gb]) => ({ plan_id, max_capacity_gb }));
  for (const expected of expectedLimits) {
    const row = snapshot.limits.find((item) => item.plan_id === expected.plan_id);
    if (!row || Number(row.max_capacity_gb) !== expected.max_capacity_gb) {
      throw new Error(`Storage limit mismatch for ${expected.plan_id}`);
    }
  }
  if (snapshot.packs.length !== STORAGE_PACKS.length) {
    throw new Error(`Expected ${STORAGE_PACKS.length} storage packs, found ${snapshot.packs.length}`);
  }
  for (const expected of STORAGE_PACKS) {
    const row = snapshot.packs.find((item) => item.product_id === expected.product_id);
    if (!row || Number(row.price_jpy) !== expected.price_jpy || Number(row.capacity_gb) !== expected.capacity_gb) {
      throw new Error(`Storage pack mismatch for ${expected.product_id}`);
    }
  }
  if (PLAN_INCLUDED_CREDITS_CANON != null && snapshot.plans.length === 0) {
    throw new Error('Plan entries missing after seed');
  }
  if (Array.isArray(CREDIT_PRODUCTS_CANON) && CREDIT_PRODUCTS_CANON.length > 0 && snapshot.credits.length === 0) {
    throw new Error('Credit products missing after seed');
  }
  console.log(`Integrity OK for catalog_version=${version}`);
}

function resolveTargetVersion() {
  const active = d1Json(`SELECT version, status FROM catalog_versions WHERE status='active' LIMIT 1`);
  if (active[0]?.version) return { version: active[0].version, wasActive: true };
  const draft = d1Json(`SELECT version FROM catalog_versions WHERE version=${sqlQuote(catalogVersion)} LIMIT 1`);
  if (draft[0]?.version) return { version: draft[0].version, wasActive: false };
  return { version: catalogVersion, wasActive: false };
}

function activateCatalog(version, checksum) {
  const publishedAt = new Date().toISOString();
  runWrangler(['--command', `
    UPDATE catalog_versions SET status='retired' WHERE status='active' AND version <> ${sqlQuote(version)};
  `.replace(/\s+/g, ' ').trim()]);
  runWrangler(['--command', `
    UPDATE catalog_versions
    SET checksum=${sqlQuote(checksum)}, published_at=${sqlQuote(publishedAt)}, status='active'
    WHERE version=${sqlQuote(version)};
  `.replace(/\s+/g, ' ').trim()]);
}

function main() {
  verifyDatabaseId();
  ensureCommercialSchema();

  let { version, wasActive } = resolveTargetVersion();
  const planRowsBefore = d1Json(`SELECT COUNT(*) AS c FROM plan_catalog_entries WHERE catalog_version=${sqlQuote(version)}`);
  const hasPlans = Number(planRowsBefore[0]?.c ?? 0) > 0;

  if (!wasActive && !hasPlans) {
    upsertDraftVersion(version);
    const seeded = seedPlansIfAllowed(version);
    if (seeded) seedBillingVariants(version);
    seedCreditProductsIfAllowed(version);
  } else if (!hasPlans && PLAN_INCLUDED_CREDITS_CANON == null) {
    console.warn('BLOCKED: No plan rows for target version and no included_credits canon; storage-only sync on active/draft skipped for new version.');
    const activeOnly = d1Json(`SELECT version FROM catalog_versions WHERE status='active' LIMIT 1`);
    if (!activeOnly[0]?.version) {
      throw new Error('No active catalog and cannot seed plans without included_credits canon.');
    }
    version = activeOnly[0].version;
    wasActive = true;
  } else if (hasPlans && tableExists('plan_billing_variants')) {
    seedBillingVariants(version);
  }

  upsertStorageCanon(version);
  const snapshot = fetchCatalogRows(version);
  assertIntegrity(version, snapshot);
  const checksum = computeChecksum(snapshot);

  const planCount = Number(d1Json(`SELECT COUNT(*) AS c FROM plan_catalog_entries WHERE catalog_version=${sqlQuote(version)}`)[0]?.c ?? 0);
  if (planCount <= 0) {
    throw new Error('Refusing to activate catalog without plan entries.');
  }
  activateCatalog(version, checksum);

  const activeCount = d1Json(`SELECT COUNT(*) AS c FROM catalog_versions WHERE status='active'`);
  if (Number(activeCount[0]?.c) !== 1) throw new Error('one_active_catalog invariant failed');

  console.log(JSON.stringify({
    ok: true,
    catalog_version: version,
    checksum,
    plan_seed_blocked: PLAN_INCLUDED_CREDITS_CANON == null,
    credit_seed_blocked: !Array.isArray(CREDIT_PRODUCTS_CANON) || CREDIT_PRODUCTS_CANON.length === 0,
    storage_limits: snapshot.limits.length,
    storage_packs: snapshot.packs.length,
  }));
}

main();
