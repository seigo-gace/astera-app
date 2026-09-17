import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildChecksumPayload, assertExactCatalogSnapshot } from '../scripts/commercial-catalog-integrity.mjs';
import {
  COMMERCIAL_CATALOG_PLANS,
  CREDIT_PRODUCTS_CANON,
  PLAN_INCLUDED_CREDITS_CANON,
  STORAGE_PLAN_MAX_GB,
  loadCommercialCatalogCanonical,
} from '../scripts/commercial-catalog-canonical.mjs';
import { storageFromPayload } from '../src/features/navigation/storage-projection.ts';

function snapshotFromCanonical(squareIds = true) {
  const plans = COMMERCIAL_CATALOG_PLANS.map((plan) => ({
    plan_id: plan.plan_id,
    included_credits: plan.included_credits,
    recurring_amount: plan.monthly_jpy,
    recurring_interval: plan.recurring_interval === 'none' ? 'none' : 'month',
    entitlement_ids: JSON.stringify(plan.entitlement_ids),
    recommended: plan.recommended ? 1 : 0,
    active: 1,
  }));
  const variants = [];
  for (const plan of COMMERCIAL_CATALOG_PLANS) {
    variants.push({
      plan_id: plan.plan_id,
      billing_cycle: 'monthly',
      recurring_amount: plan.monthly_jpy,
      recurring_interval: 'month',
      included_credits: plan.included_credits,
      square_plan_variation_id: null,
      active: 1,
    });
  }
  for (const planId of ['basic', 'pro', 'business', 'enterprise']) {
    const plan = COMMERCIAL_CATALOG_PLANS.find((entry) => entry.plan_id === planId);
    variants.push({
      plan_id: planId,
      billing_cycle: 'annual',
      recurring_amount: plan.annual_jpy,
      recurring_interval: 'year',
      included_credits: plan.included_credits,
      square_plan_variation_id: squareIds ? `sq-${planId}-annual` : null,
      active: 1,
    });
  }
  for (const planId of ['basic', 'pro', 'business', 'enterprise']) {
    const monthly = variants.find((row) => row.plan_id === planId && row.billing_cycle === 'monthly');
    if (monthly && squareIds) monthly.square_plan_variation_id = `sq-${planId}-monthly`;
  }
  return {
    plans,
    variants,
    credits: CREDIT_PRODUCTS_CANON.map((product) => ({
      product_id: product.product_id,
      amount: product.amount,
      credits: product.credits,
      active: 1,
    })),
    limits: Object.entries(STORAGE_PLAN_MAX_GB).map(([plan_id, max_capacity_gb]) => ({ plan_id, max_capacity_gb, active: 1 })),
    packs: loadCommercialCatalogCanonical().storage_packs.map((pack) => ({
      product_id: pack.product_id,
      capacity_gb: pack.capacity_gb,
      price_jpy: pack.price_jpy,
      display_order: pack.display_order,
      active: 1,
    })),
  };
}

test('Commercial Catalog exact-value: 5 plan credits', () => {
  assert.deepEqual(PLAN_INCLUDED_CREDITS_CANON, {
    free: 10000,
    basic: 180000,
    pro: 640000,
    business: 2200000,
    enterprise: 6600000,
  });
});

test('Commercial Catalog exact-value: 6 credit products', () => {
  assert.equal(CREDIT_PRODUCTS_CANON.length, 6);
  assert.equal(CREDIT_PRODUCTS_CANON[0].product_id, 'credit_500pack');
  assert.equal(CREDIT_PRODUCTS_CANON[0].credits, 75000);
});

test('Commercial Catalog exact-value: 9 billing variants in integrity snapshot', () => {
  const snapshot = snapshotFromCanonical(false);
  assert.equal(snapshot.plans.length, 5);
  assert.equal(snapshot.variants.length, 9);
  assert.doesNotThrow(() => assertExactCatalogSnapshot(snapshot));
});

test('catalog activation does not require provider variation ids in app publisher', () => {
  const withoutProviderIds = snapshotFromCanonical(false);
  assert.doesNotThrow(() => assertExactCatalogSnapshot(withoutProviderIds));
});

test('active immutable: publisher uses single transaction retire+activate', () => {
  const source = readFileSync(new URL('../scripts/publish-commercial-catalog.mjs', import.meta.url), 'utf8');
  assert.match(source, /BEGIN TRANSACTION;/);
  assert.match(source, /UPDATE catalog_versions SET status='retired' WHERE status='active'/);
  assert.doesNotMatch(source, /WHERE catalog_versions.status = 'active'/);
});

test('publisher resume requires draft with NULL published_at', () => {
  const source = readFileSync(new URL('../scripts/publish-commercial-catalog.mjs', import.meta.url), 'utf8');
  assert.match(source, /status !== 'draft'/);
  assert.match(source, /published_at is not NULL/i);
});

test('checksum changes when business value changes', () => {
  const base = buildChecksumPayload(snapshotFromCanonical(true));
  const mutated = buildChecksumPayload({
    ...snapshotFromCanonical(true),
    plans: snapshotFromCanonical(true).plans.map((plan) => (
      plan.plan_id === 'basic' ? { ...plan, included_credits: plan.included_credits + 1 } : plan
    )),
  });
  const baseHash = createHash('sha256').update(JSON.stringify(base)).digest('hex');
  const mutatedHash = createHash('sha256').update(JSON.stringify(mutated)).digest('hex');
  assert.notEqual(baseHash, mutatedHash);
});

test('malformed Storage API payload throws for UtilityPages parser', () => {
  assert.throws(() => storageFromPayload({ plan_max_capacity_gb: 1 }), /usage/);
  assert.throws(() => storageFromPayload({
    usage: { used_bytes: 0, remaining_bytes: 0 },
    packs: [],
  }), /plan_max_capacity_gb/);
});

test('Storage Plan Max boundary: Free pack purchase disabled at commerce layer', () => {
  const payload = {
    plan_id: 'free',
    plan_max_capacity_gb: 1,
    current_capacity_gb: 0,
    remaining_purchase_capacity_gb: 1,
    state: 'active',
    write_allowed: true,
    over_plan_limit: false,
    usage: { used_bytes: 0, remaining_bytes: 1073741824 },
    packs: [{
      product_id: 'storage_1gb',
      display_name: '+1GB',
      capacity_gb: 1,
      price_jpy: 480,
      can_purchase: false,
    }],
  };
  const parsed = storageFromPayload(payload);
  assert.equal(parsed.packs[0].canPurchase, false);
});
