-- Astera Storage commercial projection and tenant contract state.
-- Business values come from the versioned Commercial Catalog canon; UI must not hardcode them.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS astera_storage_catalog_entries (
  catalog_version TEXT NOT NULL REFERENCES catalog_versions(version),
  product_id TEXT NOT NULL,
  capacity_gb INTEGER NOT NULL CHECK (capacity_gb IN (1, 10, 50, 100, 500, 1000)),
  monthly_credit_cost INTEGER NOT NULL CHECK (monthly_credit_cost > 0),
  allowed_plan_ids TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  display_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (catalog_version, product_id),
  UNIQUE (catalog_version, capacity_gb)
);

-- Initial Active Catalog v1 storage projection. Future Catalog Publisher versions own future rows.
INSERT OR IGNORE INTO astera_storage_catalog_entries
  (catalog_version, product_id, capacity_gb, monthly_credit_cost, allowed_plan_ids, active, display_order)
SELECT version, 'storage_1gb', 1, 3000, '["basic","pro","business","enterprise"]', 1, 10
FROM catalog_versions WHERE status = 'active';
INSERT OR IGNORE INTO astera_storage_catalog_entries
  (catalog_version, product_id, capacity_gb, monthly_credit_cost, allowed_plan_ids, active, display_order)
SELECT version, 'storage_10gb', 10, 15000, '["basic","pro","business","enterprise"]', 1, 20
FROM catalog_versions WHERE status = 'active';
INSERT OR IGNORE INTO astera_storage_catalog_entries
  (catalog_version, product_id, capacity_gb, monthly_credit_cost, allowed_plan_ids, active, display_order)
SELECT version, 'storage_50gb', 50, 50000, '["pro","business","enterprise"]', 1, 30
FROM catalog_versions WHERE status = 'active';
INSERT OR IGNORE INTO astera_storage_catalog_entries
  (catalog_version, product_id, capacity_gb, monthly_credit_cost, allowed_plan_ids, active, display_order)
SELECT version, 'storage_100gb', 100, 90000, '["pro","business","enterprise"]', 1, 40
FROM catalog_versions WHERE status = 'active';
INSERT OR IGNORE INTO astera_storage_catalog_entries
  (catalog_version, product_id, capacity_gb, monthly_credit_cost, allowed_plan_ids, active, display_order)
SELECT version, 'storage_500gb', 500, 350000, '["business","enterprise"]', 1, 50
FROM catalog_versions WHERE status = 'active';
INSERT OR IGNORE INTO astera_storage_catalog_entries
  (catalog_version, product_id, capacity_gb, monthly_credit_cost, allowed_plan_ids, active, display_order)
SELECT version, 'storage_1tb', 1000, 650000, '["enterprise"]', 1, 60
FROM catalog_versions WHERE status = 'active';

CREATE TABLE IF NOT EXISTS astera_storage_contracts (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id),
  user_id TEXT NOT NULL,
  catalog_version TEXT NOT NULL REFERENCES catalog_versions(version),
  product_id TEXT NOT NULL,
  capacity_gb INTEGER NOT NULL CHECK (capacity_gb IN (1, 10, 50, 100, 500, 1000)),
  monthly_credit_cost INTEGER NOT NULL CHECK (monthly_credit_cost > 0),
  state TEXT NOT NULL CHECK (state IN ('active', 'save_suspended', 'grace_period', 'ending')),
  next_charge_at TEXT,
  grace_ends_at TEXT,
  deletion_scheduled_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (catalog_version, product_id) REFERENCES astera_storage_catalog_entries(catalog_version, product_id)
);

CREATE INDEX IF NOT EXISTS astera_storage_contracts_state
  ON astera_storage_contracts(state, next_charge_at);
