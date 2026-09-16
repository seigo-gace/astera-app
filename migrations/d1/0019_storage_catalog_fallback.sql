-- Stable Astera Storage fallback catalog.
-- This catalog remains draft intentionally: it must not replace or publish the commercial plan/credit catalog.
-- Storage runtime may use it when no global active commercial catalog is available.
PRAGMA foreign_keys = ON;

INSERT OR IGNORE INTO catalog_versions
  (version, checksum, status, published_at, created_at)
VALUES
  ('storage-2026-09-17-v1', 'storage-2026-09-17-v1', 'draft', '2026-09-17T00:00:00.000Z', '2026-09-17T00:00:00.000Z');

INSERT OR REPLACE INTO astera_storage_plan_limits
  (catalog_version, plan_id, max_capacity_gb, active)
VALUES
  ('storage-2026-09-17-v1', 'free', 0, 1),
  ('storage-2026-09-17-v1', 'basic', 10, 1),
  ('storage-2026-09-17-v1', 'pro', 100, 1),
  ('storage-2026-09-17-v1', 'business', 500, 1),
  ('storage-2026-09-17-v1', 'enterprise', 1000, 1);

INSERT OR REPLACE INTO astera_storage_pack_catalog
  (catalog_version, product_id, display_name, capacity_gb, price_jpy, active, display_order)
VALUES
  ('storage-2026-09-17-v1', 'storage_1gb', '+1GB', 1, 480, 1, 10),
  ('storage-2026-09-17-v1', 'storage_10gb', '+10GB', 10, 1980, 1, 20),
  ('storage-2026-09-17-v1', 'storage_50gb', '+50GB', 50, 5980, 1, 30);
