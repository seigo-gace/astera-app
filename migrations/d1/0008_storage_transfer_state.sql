CREATE TABLE IF NOT EXISTS storage_destinations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  account_label TEXT NOT NULL,
  root_folder TEXT,
  vault_reference TEXT NOT NULL,
  scopes_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(scopes_json)),
  capabilities_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(capabilities_json)),
  status TEXT NOT NULL CHECK (status IN ('pending','active','expired','revoked','error')),
  last_verified_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS storage_destinations_user ON storage_destinations(tenant_id, user_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS transfer_jobs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  destination_id TEXT NOT NULL REFERENCES storage_destinations(id),
  result_id TEXT REFERENCES results(id) ON DELETE SET NULL,
  storage_object_id TEXT,
  provider_object_id TEXT,
  checksum_sha256 TEXT NOT NULL CHECK (length(checksum_sha256) = 64),
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  final_name TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('queued','running','completed','retry_wait','failed','cancelled')),
  attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  next_retry_at TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS transfer_jobs_tenant_state ON transfer_jobs(tenant_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS astera_storage_objects (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  folder_id TEXT,
  topic_id TEXT,
  message_id TEXT,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size INTEGER NOT NULL CHECK (file_size >= 0),
  checksum_sha256 TEXT CHECK (checksum_sha256 IS NULL OR length(checksum_sha256) = 64),
  checksum_verified_at TEXT,
  encryption_profile TEXT CHECK (encryption_profile IS NULL OR encryption_profile = 'AES-256-GCM'),
  dek_wrap_ciphertext TEXT,
  dek_wrap_iv TEXT,
  content_iv_base64 TEXT,
  auth_tag_base64 TEXT,
  encrypted_at TEXT,
  retention_policy TEXT,
  source_result_id TEXT REFERENCES results(id) ON DELETE SET NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  contract_capacity_bytes_snapshot INTEGER NOT NULL CHECK (contract_capacity_bytes_snapshot > 0),
  status TEXT NOT NULL CHECK (status IN ('pending','stored','soft_deleted','deleting','deleted','error','corrupt')),
  error_code TEXT,
  deleted_at TEXT,
  restored_at TEXT,
  primary_deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    (encryption_profile IS NULL AND dek_wrap_ciphertext IS NULL AND dek_wrap_iv IS NULL AND content_iv_base64 IS NULL AND auth_tag_base64 IS NULL AND encrypted_at IS NULL)
    OR
    (encryption_profile = 'AES-256-GCM' AND dek_wrap_ciphertext IS NOT NULL AND dek_wrap_iv IS NOT NULL AND content_iv_base64 IS NOT NULL AND encrypted_at IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS astera_storage_objects_owner_status ON astera_storage_objects(tenant_id, user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS astera_storage_objects_project ON astera_storage_objects(tenant_id, project_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS astera_storage_objects_checksum ON astera_storage_objects(tenant_id, checksum_sha256) WHERE checksum_sha256 IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS astera_storage_objects_telegram_message ON astera_storage_objects(tenant_id, topic_id, message_id) WHERE topic_id IS NOT NULL AND message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS astera_storage_deletion_receipts (
  id TEXT PRIMARY KEY,
  object_id TEXT NOT NULL REFERENCES astera_storage_objects(id),
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  topic_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  deleted_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS astera_storage_deletion_receipts_owner ON astera_storage_deletion_receipts(tenant_id, user_id, deleted_at DESC);

