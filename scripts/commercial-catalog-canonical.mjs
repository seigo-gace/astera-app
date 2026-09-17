/** Storage and plan pricing canon for staging catalog publish (not UI copy). */

export const STAGING_D1 = {
  database_name: 'astera-app-staging',
  database_id: '08a705ac-50f4-4592-b726-d50154a2a8cb',
};

/** @readonly */
export const STORAGE_PLAN_MAX_GB = Object.freeze({
  free: 1,
  basic: 5,
  pro: 20,
  business: 50,
  enterprise: 150,
});

/** @readonly */
export const STORAGE_PACKS = Object.freeze([
  { product_id: 'storage_1gb', display_name: '+1GB', capacity_gb: 1, price_jpy: 480, display_order: 10 },
  { product_id: 'storage_10gb', display_name: '+10GB', capacity_gb: 10, price_jpy: 1980, display_order: 20 },
  { product_id: 'storage_50gb', display_name: '+50GB', capacity_gb: 50, price_jpy: 5980, display_order: 30 },
]);

/** Monthly recurring amounts (JPY). Matches scripts/square-sandbox-bootstrap.mjs */
export const PLAN_MONTHLY_JPY = Object.freeze({
  free: 0,
  basic: 980,
  pro: 2980,
  business: 9980,
  enterprise: 29800,
});

/** Annual recurring amounts (JPY). Matches scripts/square-sandbox-bootstrap.mjs */
export const PLAN_ANNUAL_JPY = Object.freeze({
  basic: 9800,
  pro: 29800,
  business: 99800,
  enterprise: 298000,
});

/**
 * origin/main has no INSERT seed for included_credits / credit_products (schema + readers only).
 * Do not infer from tests or plan-credit-text UI copy.
 */
export const PLAN_INCLUDED_CREDITS_CANON = null;

export const CREDIT_PRODUCTS_CANON = null;

export const DEFAULT_CATALOG_VERSION = 'astera-commercial-2026-09-17-v1';
