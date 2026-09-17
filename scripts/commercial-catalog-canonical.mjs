import { loadCommercialCatalogCanonical } from './load-commercial-catalog-canonical.mjs';

const canon = loadCommercialCatalogCanonical();

export const STAGING_D1 = Object.freeze({ ...canon.staging_d1 });

export const STORAGE_PLAN_MAX_GB = Object.freeze({ ...canon.storage_plan_max_gb });

export const STORAGE_PACKS = Object.freeze(canon.storage_packs.map((pack) => ({ ...pack })));

/** @type {Record<string, number>} */
export const PLAN_MONTHLY_JPY = Object.freeze(
  Object.fromEntries(canon.plans.map((plan) => [plan.plan_id, plan.monthly_jpy])),
);

/** @type {Record<string, number>} */
export const PLAN_ANNUAL_JPY = Object.freeze(
  Object.fromEntries(
    canon.plans.filter((plan) => plan.plan_id !== 'free').map((plan) => [plan.plan_id, plan.annual_jpy]),
  ),
);

/** @type {Record<string, number>} */
export const PLAN_INCLUDED_CREDITS_CANON = Object.freeze(
  Object.fromEntries(canon.plans.map((plan) => [plan.plan_id, plan.included_credits])),
);

export const CREDIT_PRODUCTS_CANON = Object.freeze(canon.credit_products.map((product) => ({ ...product })));

export const COMMERCIAL_CATALOG_PLANS = Object.freeze(canon.plans.map((plan) => ({ ...plan })));

export const DEFAULT_CATALOG_VERSION_PREFIX = 'astera-commercial';

export function newDraftCatalogVersion(now = new Date()) {
  const stamp = now.toISOString().slice(0, 10);
  const suffix = now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return `${DEFAULT_CATALOG_VERSION_PREFIX}-${stamp}-draft-${suffix}`;
}

export { loadCommercialCatalogCanonical };
