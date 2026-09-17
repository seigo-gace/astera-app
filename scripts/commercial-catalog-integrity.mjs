import {
  COMMERCIAL_CATALOG_PLANS,
  CREDIT_PRODUCTS_CANON,
  PLAN_ANNUAL_JPY,
  PLAN_INCLUDED_CREDITS_CANON,
  PLAN_MONTHLY_JPY,
  STORAGE_PACKS,
  STORAGE_PLAN_MAX_GB,
} from './commercial-catalog-canonical.mjs';

const PAID_PLAN_IDS = ['basic', 'pro', 'business', 'enterprise'];

export function assertExactCatalogSnapshot(snapshot) {
  const errors = [];
  if (snapshot.plans.length !== 5) errors.push(`plans=${snapshot.plans.length}, expected 5`);
  if (snapshot.variants.length !== 9) errors.push(`variants=${snapshot.variants.length}, expected 9`);
  if (snapshot.credits.length !== 6) errors.push(`credit_products=${snapshot.credits.length}, expected 6`);
  if (snapshot.limits.length !== 5) errors.push(`storage_limits=${snapshot.limits.length}, expected 5`);
  if (snapshot.packs.length !== 3) errors.push(`storage_packs=${snapshot.packs.length}, expected 3`);

  for (const plan of COMMERCIAL_CATALOG_PLANS) {
    const row = snapshot.plans.find((item) => item.plan_id === plan.plan_id);
    if (!row) {
      errors.push(`missing plan ${plan.plan_id}`);
      continue;
    }
    if (Number(row.included_credits) !== plan.included_credits) {
      errors.push(`plan ${plan.plan_id} included_credits=${row.included_credits}, expected ${plan.included_credits}`);
    }
    const monthly = Number(PLAN_MONTHLY_JPY[plan.plan_id] ?? 0);
    const planMonthly = snapshot.variants.find((item) => item.plan_id === plan.plan_id && item.billing_cycle === 'monthly');
    if (!planMonthly || Number(planMonthly.recurring_amount) !== monthly) {
      errors.push(`plan ${plan.plan_id} monthly amount mismatch`);
    }
    if (plan.plan_id !== 'free') {
      const annual = Number(PLAN_ANNUAL_JPY[plan.plan_id]);
      const planAnnual = snapshot.variants.find((item) => item.plan_id === plan.plan_id && item.billing_cycle === 'annual');
      if (!planAnnual || Number(planAnnual.recurring_amount) !== annual) {
        errors.push(`plan ${plan.plan_id} annual amount mismatch`);
      }
    }
  }

  for (const expected of CREDIT_PRODUCTS_CANON) {
    const row = snapshot.credits.find((item) => item.product_id === expected.product_id);
    if (!row || Number(row.amount) !== expected.amount || Number(row.credits) !== expected.credits) {
      errors.push(`credit product ${expected.product_id} mismatch`);
    }
  }

  for (const [planId, maxGb] of Object.entries(STORAGE_PLAN_MAX_GB)) {
    const row = snapshot.limits.find((item) => item.plan_id === planId);
    if (!row || Number(row.max_capacity_gb) !== maxGb) {
      errors.push(`storage limit ${planId}=${row?.max_capacity_gb}, expected ${maxGb}`);
    }
  }

  for (const expected of STORAGE_PACKS) {
    const row = snapshot.packs.find((item) => item.product_id === expected.product_id);
    if (!row || Number(row.price_jpy) !== expected.price_jpy || Number(row.capacity_gb) !== expected.capacity_gb) {
      errors.push(`storage pack ${expected.product_id} mismatch`);
    }
  }

  const paidVariants = snapshot.variants.filter((item) => PAID_PLAN_IDS.includes(item.plan_id));
  if (paidVariants.length !== 8) errors.push(`paid variants=${paidVariants.length}, expected 8`);

  if (errors.length > 0) {
    throw new Error(`Catalog integrity failed: ${errors.join('; ')}`);
  }
}

export function buildChecksumPayload(snapshot) {
  return {
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
      square_plan_variation_id: row.square_plan_variation_id ?? null,
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
    included_credits_canon: PLAN_INCLUDED_CREDITS_CANON,
  };
}
