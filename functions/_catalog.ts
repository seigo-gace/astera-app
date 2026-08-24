import { FunctionHttpError, type D1Database } from './_account-projection';

type CatalogVersionRow = {
  version: string;
  checksum: string;
  published_at: string | null;
};

type PlanRow = {
  plan_id: string;
  display_name: string;
  description: string;
  currency: 'JPY';
  recurring_amount: number;
  recurring_interval: 'month' | 'year' | 'none';
  included_credits: number;
  entitlement_ids: string;
  recommended: number;
  active: number;
  square_plan_variation_id: string | null;
};

type BillingVariantRow = {
  plan_id: string;
  billing_cycle: 'monthly' | 'annual';
  recurring_amount: number;
  recurring_interval: 'month' | 'year';
  included_credits: number;
  square_plan_variation_id: string | null;
  active: number;
};

type CreditProductRow = {
  product_id: string;
  display_name: string;
  description: string;
  currency: 'JPY';
  amount: number;
  credits: number;
  active: number;
  square_catalog_object_id: string | null;
};

type SubscriptionRow = {
  id: string;
  tenant_id: string;
  catalog_version: string;
  plan_id: string;
  billing_cycle: 'monthly' | 'annual';
  provider_subscription_id: string | null;
  status: string;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: number;
};

function parseStringArray(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
  } catch {
    return [];
  }
}

function yen(amount: number, interval?: string): string {
  const base = `¥${Math.trunc(amount).toLocaleString('ja-JP')}`;
  if (interval === 'month') return `${base} / 月`;
  if (interval === 'year') return `${base} / 年`;
  return base;
}

export type BillingCycle = 'monthly' | 'annual';

export type ActiveCommercialCatalog = {
  catalog_version: string;
  checksum: string;
  published_at: string;
  plans: Array<{
    plan_id: string;
    id: string;
    display_name: string;
    name: string;
    description: string;
    currency: 'JPY';
    recurring_amount: number;
    recurring_interval: string;
    monthly_price_yen: number;
    price_label: string;
    included_credits: number;
    monthly_credits: number;
    monthly_credits_label: string;
    entitlement_ids: string[];
    features: string[];
    recommended: boolean;
    active: boolean;
    square_plan_variation_id: string | null;
    billing_variants: Array<{
      billing_cycle: BillingCycle;
      recurring_amount: number;
      recurring_interval: 'month' | 'year';
      included_credits: number;
      price_label: string;
      square_plan_variation_id: string | null;
      active: boolean;
    }>;
  }>;
  creditProducts: Array<{
    product_id: string;
    id: string;
    display_name: string;
    name: string;
    description: string;
    currency: 'JPY';
    amount: number;
    price_label: string;
    credits: number;
    credits_label: string;
    active: boolean;
    square_catalog_object_id: string | null;
  }>;
};

export async function loadActiveCatalog(db: D1Database): Promise<ActiveCommercialCatalog> {
  try {
    const version = await db.prepare(
      `SELECT version, checksum, published_at
       FROM catalog_versions WHERE status = 'active' LIMIT 1`,
    ).first<CatalogVersionRow>();
    if (!version?.version || !version.checksum || !version.published_at) {
      throw new FunctionHttpError(503, 'ACTIVE_CATALOG_NOT_PUBLISHED', '公開可能なActive Catalogがありません。');
    }

    const [planResult, variantResult, creditResult] = await Promise.all([
      db.prepare(
        `SELECT plan_id, display_name, description, currency, recurring_amount, recurring_interval,
                included_credits, entitlement_ids, recommended, active, square_plan_variation_id
         FROM plan_catalog_entries
         WHERE catalog_version = ?1 AND active = 1
         ORDER BY display_order ASC, recurring_amount ASC, plan_id ASC`,
      ).bind(version.version).all<PlanRow>(),
      db.prepare(
        `SELECT plan_id, billing_cycle, recurring_amount, recurring_interval, included_credits,
                square_plan_variation_id, active
         FROM plan_billing_variants
         WHERE catalog_version = ?1 AND active = 1
         ORDER BY plan_id ASC, CASE billing_cycle WHEN 'monthly' THEN 0 ELSE 1 END ASC`,
      ).bind(version.version).all<BillingVariantRow>(),
      db.prepare(
        `SELECT product_id, display_name, description, currency, amount, credits, active, square_catalog_object_id
         FROM credit_products
         WHERE catalog_version = ?1 AND active = 1
         ORDER BY display_order ASC, amount ASC, product_id ASC`,
      ).bind(version.version).all<CreditProductRow>(),
    ]);

    const allVariants = variantResult.results ?? [];
    const plans = (planResult.results ?? []).map((row) => {
      const entitlements = parseStringArray(row.entitlement_ids);
      const billingVariants = allVariants
        .filter((variant) => variant.plan_id === row.plan_id)
        .map((variant) => ({
          billing_cycle: variant.billing_cycle,
          recurring_amount: Number(variant.recurring_amount),
          recurring_interval: variant.recurring_interval,
          included_credits: Number(variant.included_credits),
          price_label: yen(Number(variant.recurring_amount), variant.recurring_interval),
          square_plan_variation_id: variant.square_plan_variation_id,
          active: variant.active === 1,
        }));
      const monthly = billingVariants.find((variant) => variant.billing_cycle === 'monthly');
      return {
        plan_id: row.plan_id,
        id: row.plan_id,
        display_name: row.display_name,
        name: row.display_name,
        description: row.description,
        currency: row.currency,
        recurring_amount: monthly?.recurring_amount ?? Number(row.recurring_amount),
        recurring_interval: monthly?.recurring_interval ?? row.recurring_interval,
        monthly_price_yen: monthly?.recurring_amount ?? Number(row.recurring_amount),
        price_label: monthly?.price_label ?? yen(Number(row.recurring_amount), row.recurring_interval),
        included_credits: Number(row.included_credits),
        monthly_credits: Number(row.included_credits),
        monthly_credits_label: Number(row.included_credits).toLocaleString('ja-JP'),
        entitlement_ids: entitlements,
        features: entitlements,
        recommended: row.recommended === 1,
        active: row.active === 1,
        square_plan_variation_id: monthly?.square_plan_variation_id ?? row.square_plan_variation_id,
        billing_variants: billingVariants,
      };
    });

    const creditProducts = (creditResult.results ?? []).map((row) => ({
      product_id: row.product_id,
      id: row.product_id,
      display_name: row.display_name,
      name: row.display_name,
      description: row.description,
      currency: row.currency,
      amount: Number(row.amount),
      price_label: yen(Number(row.amount)),
      credits: Number(row.credits),
      credits_label: Number(row.credits).toLocaleString('ja-JP'),
      active: row.active === 1,
      square_catalog_object_id: row.square_catalog_object_id,
    }));

    return {
      catalog_version: version.version,
      checksum: version.checksum,
      published_at: version.published_at,
      plans,
      creditProducts,
    };
  } catch (error) {
    if (error instanceof FunctionHttpError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    if (/no such table|D1_ERROR/i.test(message)) {
      throw new FunctionHttpError(503, 'COMMERCIAL_CATALOG_SCHEMA_NOT_READY', 'Commercial Catalog用D1 Migrationが適用されていません。', message);
    }
    throw new FunctionHttpError(500, 'COMMERCIAL_CATALOG_READ_FAILED', 'Commercial Catalogを読み取れませんでした。', message);
  }
}

export async function loadTenantSubscription(db: D1Database, tenantId: string): Promise<SubscriptionRow | null> {
  try {
    return await db.prepare(
      `SELECT id, tenant_id, catalog_version, plan_id, billing_cycle, provider_subscription_id, status,
              current_period_start, current_period_end, cancel_at_period_end
       FROM tenant_subscriptions WHERE tenant_id = ?1 LIMIT 1`,
    ).bind(tenantId).first<SubscriptionRow>();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/no such table|D1_ERROR/i.test(message)) {
      throw new FunctionHttpError(503, 'SUBSCRIPTION_SCHEMA_NOT_READY', 'Subscription用D1 Migrationが適用されていません。', message);
    }
    throw error;
  }
}
