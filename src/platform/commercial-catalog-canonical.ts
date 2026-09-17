import canonical from '../../catalog/commercial-catalog.canonical.json';

export type CanonicalPlan = (typeof canonical.plans)[number];
export type CanonicalCreditProduct = (typeof canonical.credit_products)[number];
export type CanonicalStoragePack = (typeof canonical.storage_packs)[number];

export const COMMERCIAL_CATALOG_CANONICAL = canonical;

export const STAGING_D1 = canonical.staging_d1;

export const STORAGE_PLAN_MAX_GB = canonical.storage_plan_max_gb;

export const STORAGE_PACKS = canonical.storage_packs;

export const PLAN_INCLUDED_CREDITS: Record<string, number> = Object.fromEntries(
  canonical.plans.map((plan) => [plan.plan_id, plan.included_credits]),
);

export const PLAN_MONTHLY_JPY: Record<string, number> = Object.fromEntries(
  canonical.plans.map((plan) => [plan.plan_id, plan.monthly_jpy]),
);

export const PLAN_ANNUAL_JPY: Record<string, number> = Object.fromEntries(
  canonical.plans.filter((plan) => plan.plan_id !== 'free').map((plan) => [plan.plan_id, plan.annual_jpy]),
);

export const CREDIT_PRODUCTS = canonical.credit_products;

export function formatCreditsAmount(value: number, locale: 'ja-JP' | 'en-US' = 'ja-JP'): string {
  return `${value.toLocaleString(locale)} ©`;
}

export function formatYenMonthly(amount: number, locale: 'ja' | 'en'): string {
  const formatted = amount.toLocaleString(locale === 'ja' ? 'ja-JP' : 'en-US');
  return locale === 'ja' ? `¥${formatted} / 月` : `¥${formatted} / month`;
}

export function formatYenAnnual(amount: number, locale: 'ja' | 'en'): string {
  const formatted = amount.toLocaleString(locale === 'ja' ? 'ja-JP' : 'en-US');
  return locale === 'ja' ? `¥${formatted} / 年` : `¥${formatted} / year`;
}

export function formatYenPack(amount: number, locale: 'ja' | 'en'): string {
  const formatted = amount.toLocaleString(locale === 'ja' ? 'ja-JP' : 'en-US');
  return `¥${formatted}`;
}

export function annualMonthlyEquivalent(planId: string, locale: 'ja' | 'en'): string | undefined {
  const annual = PLAN_ANNUAL_JPY[planId];
  if (!annual) return undefined;
  const monthly = Math.round(annual / 12);
  const formatted = monthly.toLocaleString(locale === 'ja' ? 'ja-JP' : 'en-US');
  return locale === 'ja' ? `約 ¥${formatted} / 月` : `About ¥${formatted} / month`;
}
