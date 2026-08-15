-- Astera managed Storage metadata. Binary lives in TGserver/Telegram user topics.
-- Commercial entitlement/capacity remains Cloudflare/D1 owned.

CREATE TABLE IF NOT EXISTS astera_storage_objects (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  user_id text NOT NULL,
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  folder_id text,
  topic_id bigint,
  message_id bigint,
  file_name text NOT NULL,
  mime_type text NOT NULL,
  file_size bigint NOT NULL CHECK (file_size >= 0),
  checksum_sha256 text CHECK (checksum_sha256 IS NULL OR checksum_sha256 ~ '^[0-9a-f]{64}$'),
  checksum_verified_at timestamptz,
  encryption_profile text,
  retention_policy text,
  source_result_id uuid REFERENCES results(id) ON DELETE SET NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  contract_capacity_bytes_snapshot bigint NOT NULL CHECK (contract_capacity_bytes_snapshot > 0),
  status text NOT NULL CHECK (status IN ('pending','stored','soft_deleted','deleting','deleted','error','corrupt')),
  error_code text,
  deleted_at timestamptz,
  restored_at timestamptz,
  primary_deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS astera_storage_objects_owner_status
  ON astera_storage_objects(tenant_id, user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS astera_storage_objects_project
  ON astera_storage_objects(tenant_id, project_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS astera_storage_objects_checksum
  ON astera_storage_objects(tenant_id, checksum_sha256) WHERE checksum_sha256 IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS astera_storage_objects_telegram_message
  ON astera_storage_objects(tenant_id, topic_id, message_id)
  WHERE topic_id IS NOT NULL AND message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS astera_storage_deletion_receipts (
  id uuid PRIMARY KEY,
  object_id uuid NOT NULL REFERENCES astera_storage_objects(id),
  tenant_id text NOT NULL,
  user_id text NOT NULL,
  topic_id bigint NOT NULL,
  message_id bigint NOT NULL,
  reason text NOT NULL,
  deleted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS astera_storage_deletion_receipts_owner
  ON astera_storage_deletion_receipts(tenant_id, user_id, deleted_at DESC);
