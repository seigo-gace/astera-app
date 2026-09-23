-- Restore the Master-confirmed plan-included Storage capacities.
-- Current canon: free=1GB, basic=5GB, pro=20GB, business=50GB, enterprise=150GB.
-- The legacy column name max_capacity_gb is retained for compatibility, but its
-- value is the plan-included/base capacity. Buy-once Storage packs are additive.
PRAGMA foreign_keys = ON;

INSERT OR REPLACE INTO astera_storage_plan_limits (catalog_version, plan_id, max_capacity_gb, active)
SELECT version, 'free', 1, 1 FROM catalog_versions WHERE status='active';
INSERT OR REPLACE INTO astera_storage_plan_limits (catalog_version, plan_id, max_capacity_gb, active)
SELECT version, 'basic', 5, 1 FROM catalog_versions WHERE status='active';
INSERT OR REPLACE INTO astera_storage_plan_limits (catalog_version, plan_id, max_capacity_gb, active)
SELECT version, 'pro', 20, 1 FROM catalog_versions WHERE status='active';
INSERT OR REPLACE INTO astera_storage_plan_limits (catalog_version, plan_id, max_capacity_gb, active)
SELECT version, 'business', 50, 1 FROM catalog_versions WHERE status='active';
INSERT OR REPLACE INTO astera_storage_plan_limits (catalog_version, plan_id, max_capacity_gb, active)
SELECT version, 'enterprise', 150, 1 FROM catalog_versions WHERE status='active';
