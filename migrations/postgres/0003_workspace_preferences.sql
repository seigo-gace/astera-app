ALTER TABLE results ADD COLUMN IF NOT EXISTS title TEXT NOT NULL DEFAULT 'Astera Result';
ALTER TABLE results ADD COLUMN IF NOT EXISTS created_by_user_id TEXT;
ALTER TABLE results ADD COLUMN IF NOT EXISTS purpose TEXT;
ALTER TABLE results ADD COLUMN IF NOT EXISTS private_mode BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS results_tenant_created
  ON results(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS results_tenant_user_created
  ON results(tenant_id, created_by_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS user_preferences (
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  namespace TEXT NOT NULL,
  values_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  version BIGINT NOT NULL DEFAULT 0 CHECK (version >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, user_id, namespace)
);

CREATE INDEX IF NOT EXISTS user_preferences_user
  ON user_preferences(tenant_id, user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS personal_templates (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  version BIGINT NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS personal_templates_user
  ON personal_templates(tenant_id, user_id, updated_at DESC)
  WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS storage_destinations (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  display_name TEXT NOT NULL,
  vault_reference TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'expired', 'revoked', 'error')),
  capabilities JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS storage_destinations_user
  ON storage_destinations(tenant_id, user_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS developer_api_keys (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  scopes JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL CHECK (status IN ('active', 'revoked', 'expired')),
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS developer_api_keys_user
  ON developer_api_keys(tenant_id, user_id, status, created_at DESC);
