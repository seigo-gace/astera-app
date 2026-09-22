import { FunctionHttpError, type D1Database } from './_account-projection';

export type StoragePackProduct = {
  productId: string;
  displayName: string;
  capacityGb: number;
  priceJpy: number;
};

export type StorageCommerceProjection = {
  catalogVersion: string;
  planId: string;
  planBaseCapacityGb: number;
  planMaxCapacityGb: number;
  legacyCapacityGb: number;
  purchasedCapacityGb: number;
  currentCapacityGb: number;
  packs: Array<StoragePackProduct & { canPurchase: boolean }>;
};

type ActiveVersionRow = { version: string };
type SubscriptionRow = { plan_id: string; status: string };
type LimitRow = { max_capacity_gb: number };
type PackRow = { product_id: string; display_name: string; capacity_gb: number; price_jpy: number };
type SumRow = { total: number };
type LegacyRow = { capacity_gb: number; state: string };

const LIVE_PLAN_STATES = new Set(['active', 'paused', 'grace', 'cancel_pending']);

function safeNonNegativeInteger(value: unknown, code: string): number {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < 0) {
    throw new FunctionHttpError(503, code, 'Storage容量を安全に計算できません。');
  }
  return numeric;
}

export async function activeStorageCatalogVersion(db: D1Database): Promise<string> {
  const row = await db.prepare(
    `SELECT version FROM catalog_versions WHERE status='active' LIMIT 1`,
  ).first<ActiveVersionRow>();
  if (!row?.version) throw new FunctionHttpError(503, 'ACTIVE_CATALOG_NOT_PUBLISHED', 'Active Catalogを確認できません。');
  return row.version;
}

export async function currentPlanId(db: D1Database, tenantId: string): Promise<string> {
  const subscription = await db.prepare(
    `SELECT plan_id, status FROM tenant_subscriptions WHERE tenant_id=?1 LIMIT 1`,
  ).bind(tenantId).first<SubscriptionRow>();
  if (!subscription?.plan_id || !LIVE_PLAN_STATES.has(subscription.status)) return 'free';
  return subscription.plan_id.trim().toLowerCase();
}

export async function loadStorageCommerceProjection(db: D1Database, tenantId: string): Promise<StorageCommerceProjection> {
  try {
    const catalogVersion = await activeStorageCatalogVersion(db);
    const planId = await currentPlanId(db, tenantId);
    const [limit, legacy, purchased, packResult] = await Promise.all([
      db.prepare(
        `SELECT max_capacity_gb FROM astera_storage_plan_limits
         WHERE catalog_version=?1 AND plan_id=?2 AND active=1 LIMIT 1`,
      ).bind(catalogVersion, planId).first<LimitRow>(),
      db.prepare(
        `SELECT capacity_gb, state FROM astera_storage_contracts WHERE tenant_id=?1 LIMIT 1`,
      ).bind(tenantId).first<LegacyRow>(),
      db.prepare(
        `SELECT COALESCE(SUM(capacity_gb),0) total
         FROM astera_storage_pack_purchases WHERE tenant_id=?1`,
      ).bind(tenantId).first<SumRow>(),
      db.prepare(
        `SELECT product_id, display_name, capacity_gb, price_jpy
         FROM astera_storage_pack_catalog
         WHERE catalog_version=?1 AND active=1
         ORDER BY display_order ASC, capacity_gb ASC`,
      ).bind(catalogVersion).all<PackRow>(),
    ]);

    // The legacy DB column is named max_capacity_gb, but the current commercial
    // contract treats this value as the plan-included/base Storage capacity.
    // Purchased buy-once packs are additive and are not capped by that base.
    const planBaseCapacityGb = safeNonNegativeInteger(limit?.max_capacity_gb ?? 0, 'STORAGE_PLAN_BASE_INVALID');
    const legacyCapacityGb = safeNonNegativeInteger(legacy?.capacity_gb ?? 0, 'STORAGE_LEGACY_CAPACITY_INVALID');
    const purchasedCapacityGb = safeNonNegativeInteger(purchased?.total ?? 0, 'STORAGE_PURCHASE_CAPACITY_INVALID');
    const currentCapacityGb = planBaseCapacityGb + legacyCapacityGb + purchasedCapacityGb;
    if (!Number.isSafeInteger(currentCapacityGb)) {
      throw new FunctionHttpError(503, 'STORAGE_TOTAL_CAPACITY_INVALID', 'Storage合計容量を安全に計算できません。');
    }
    const packs = (packResult.results ?? []).map((row) => {
      const capacityGb = safeNonNegativeInteger(row.capacity_gb, 'STORAGE_PACK_CAPACITY_INVALID');
      const priceJpy = safeNonNegativeInteger(row.price_jpy, 'STORAGE_PACK_PRICE_INVALID');
      return {
        productId: row.product_id,
        displayName: row.display_name,
        capacityGb,
        priceJpy,
        canPurchase: planId !== 'free' && planBaseCapacityGb > 0,
      };
    });

    return {
      catalogVersion,
      planId,
      planBaseCapacityGb,
      // Compatibility alias for older internal consumers. It must not be treated
      // as a total-capacity ceiling; new code must use planBaseCapacityGb.
      planMaxCapacityGb: planBaseCapacityGb,
      legacyCapacityGb,
      purchasedCapacityGb,
      currentCapacityGb,
      packs,
    };
  } catch (error) {
    if (error instanceof FunctionHttpError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    if (/no such table|D1_ERROR/i.test(message)) {
      throw new FunctionHttpError(503, 'STORAGE_COMMERCE_SCHEMA_NOT_READY', 'Storage購入用D1 Migrationが適用されていません。', message);
    }
    throw new FunctionHttpError(500, 'STORAGE_COMMERCE_READ_FAILED', 'Storage購入状態を取得できませんでした。', message);
  }
}

export async function loadStoragePackProduct(db: D1Database, catalogVersion: string, productId: string): Promise<StoragePackProduct> {
  const row = await db.prepare(
    `SELECT product_id, display_name, capacity_gb, price_jpy
     FROM astera_storage_pack_catalog
     WHERE catalog_version=?1 AND product_id=?2 AND active=1 LIMIT 1`,
  ).bind(catalogVersion, productId).first<PackRow>();
  if (!row) throw new FunctionHttpError(422, 'STORAGE_PACK_NOT_AVAILABLE', '選択したStorage Packは現在購入できません。');
  return {
    productId: row.product_id,
    displayName: row.display_name,
    capacityGb: safeNonNegativeInteger(row.capacity_gb, 'STORAGE_PACK_CAPACITY_INVALID'),
    priceJpy: safeNonNegativeInteger(row.price_jpy, 'STORAGE_PACK_PRICE_INVALID'),
  };
}
