PRAGMA foreign_keys = ON;

ALTER TABLE astera_storage_objects
  ADD COLUMN tgs_profile TEXT NOT NULL DEFAULT 'legacy_v15'
  CHECK (tgs_profile IN ('legacy_v15', 'native_v1'));

ALTER TABLE astera_storage_objects ADD COLUMN tgs_namespace_ref TEXT;
ALTER TABLE astera_storage_objects ADD COLUMN tgs_object_ref TEXT;
ALTER TABLE astera_storage_objects ADD COLUMN tgs_operation_id TEXT;
ALTER TABLE astera_storage_objects ADD COLUMN tgs_commit_state TEXT;
ALTER TABLE astera_storage_objects ADD COLUMN tgs_last_reconciled_at TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS astera_storage_objects_native_ref_unique
ON astera_storage_objects(tenant_id, tgs_object_ref)
WHERE tgs_profile = 'native_v1' AND tgs_object_ref IS NOT NULL;
