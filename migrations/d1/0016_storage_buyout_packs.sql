-- Buy-once Astera Storage packs and plan capacity limits.
-- Canon: 1GB=480 JPY, 10GB=1,980 JPY, 50GB=5,980 JPY; purchases accumulate.
-- Current plan caps: free=0, basic=10GB, pro=100GB, business=500GB, enterprise=1000GB.
-- A draft Storage-only fallback catalog is seeded so Storage does not disappear when the commercial catalog has no active version.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS astera_storage_plan_limits (
  catalog_version TEXT NOT NULL REFERENCES catalog_versions(version),
  plan_id TEXT NOT NULL,
  max_capacity_gb INTEGER NOT NULL CHECK (max_capacity_gb >= 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  PRIMARY KEY (catalog_version, plan_id)
);

INSERT OR IGNORE INTO catalog_versions
  (version, checksum, status, published_at, created_at)
VALUES
  ('storage-2026-09-17-v1', 'storage-2026-09-17-v1', 'draft', '2026-09-17T00:00:00.000Z', '2026-09-17T00:00:00.000Z');

INSERT OR REPLACE INTO astera_storage_plan_limits (catalog_version, plan_id, max_capacity_gb, active)
SELECT version, 'free', 0, 1 FROM catalog_versions WHERE status='active';
INSERT OR REPLACE INTO astera_storage_plan_limits (catalog_version, plan_id, max_capacity_gb, active)
SELECT version, 'basic', 10, 1 FROM catalog_versions WHERE status='active';
INSERT OR REPLACE INTO astera_storage_plan_limits (catalog_version, plan_id, max_capacity_gb, active)
SELECT version, 'pro', 100, 1 FROM catalog_versions WHERE status='active';
INSERT OR REPLACE INTO astera_storage_plan_limits (catalog_version, plan_id, max_capacity_gb, active)
SELECT version, 'business', 500, 1 FROM catalog_versions WHERE status='active';
INSERT OR REPLACE INTO astera_storage_plan_limits (catalog_version, plan_id, max_capacity_gb, active)
SELECT version, 'enterprise', 1000, 1 FROM catalog_versions WHERE status='active';

INSERT OR REPLACE INTO astera_storage_plan_limits
  (catalog_version, plan_id, max_capacity_gb, active)
VALUES
  ('storage-2026-09-17-v1', 'free', 0, 1),
  ('storage-2026-09-17-v1', 'basic', 10, 1),
  ('storage-2026-09-17-v1', 'pro', 100, 1),
  ('storage-2026-09-17-v1', 'business', 500, 1),
  ('storage-2026-09-17-v1', 'enterprise', 1000, 1);

CREATE TABLE IF NOT EXISTS astera_storage_pack_catalog (
  catalog_version TEXT NOT NULL REFERENCES catalog_versions(version),
  product_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  capacity_gb INTEGER NOT NULL CHECK (capacity_gb IN (1,10,50)),
  price_jpy INTEGER NOT NULL CHECK (price_jpy > 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  display_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (catalog_version, product_id),
  UNIQUE (catalog_version, capacity_gb)
);

INSERT OR REPLACE INTO astera_storage_pack_catalog
  (catalog_version, product_id, display_name, capacity_gb, price_jpy, active, display_order)
SELECT version, 'storage_1gb', '+1GB', 1, 480, 1, 10 FROM catalog_versions WHERE status='active';
INSERT OR REPLACE INTO astera_storage_pack_catalog
  (catalog_version, product_id, display_name, capacity_gb, price_jpy, active, display_order)
SELECT version, 'storage_10gb', '+10GB', 10, 1980, 1, 20 FROM catalog_versions WHERE status='active';
INSERT OR REPLACE INTO astera_storage_pack_catalog
  (catalog_version, product_id, display_name, capacity_gb, price_jpy, active, display_order)
SELECT version, 'storage_50gb', '+50GB', 50, 5980, 1, 30 FROM catalog_versions WHERE status='active';

INSERT OR REPLACE INTO astera_storage_pack_catalog
  (catalog_version, product_id, display_name, capacity_gb, price_jpy, active, display_order)
VALUES
  ('storage-2026-09-17-v1', 'storage_1gb', '+1GB', 1, 480, 1, 10),
  ('storage-2026-09-17-v1', 'storage_10gb', '+10GB', 10, 1980, 1, 20),
  ('storage-2026-09-17-v1', 'storage_50gb', '+50GB', 50, 5980, 1, 30);

CREATE TABLE IF NOT EXISTS astera_storage_pack_intents (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL,
  catalog_version TEXT NOT NULL REFERENCES catalog_versions(version),
  product_id TEXT NOT NULL,
  capacity_gb INTEGER NOT NULL CHECK (capacity_gb IN (1,10,50)),
  price_jpy INTEGER NOT NULL CHECK (price_jpy > 0),
  status TEXT NOT NULL CHECK (status IN ('creating_checkout','checkout_created','payment_pending','completed','failed','cancelled','reconciliation_required')),
  idempotency_key TEXT NOT NULL UNIQUE,
  provider_checkout_id TEXT,
  provider_order_id TEXT UNIQUE,
  provider_payment_id TEXT UNIQUE,
  checkout_url TEXT,
  expires_at TEXT,
  completed_at TEXT,
  failure_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (catalog_version, product_id) REFERENCES astera_storage_pack_catalog(catalog_version, product_id)
);

CREATE INDEX IF NOT EXISTS astera_storage_pack_intents_tenant_created
  ON astera_storage_pack_intents(tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS astera_storage_pack_purchases (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL,
  catalog_version TEXT NOT NULL REFERENCES catalog_versions(version),
  product_id TEXT NOT NULL,
  capacity_gb INTEGER NOT NULL CHECK (capacity_gb IN (1,10,50)),
  price_jpy INTEGER NOT NULL CHECK (price_jpy > 0),
  provider_order_id TEXT NOT NULL UNIQUE,
  provider_payment_id TEXT,
  purchased_at TEXT NOT NULL,
  FOREIGN KEY (catalog_version, product_id) REFERENCES astera_storage_pack_catalog(catalog_version, product_id)
);

CREATE INDEX IF NOT EXISTS astera_storage_pack_purchases_tenant
  ON astera_storage_pack_purchases(tenant_id, purchased_at DESC);
