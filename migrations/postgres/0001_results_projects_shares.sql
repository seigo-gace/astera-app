-- Astera App PostgreSQL initial workspace schema.
-- This migration has not been applied to staging or production; keep it aligned with the current runtime contract.

CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  owner_user_id text NOT NULL,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS project_members (
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  role text NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE IF NOT EXISTS results (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  job_id text NOT NULL UNIQUE,
  title text NOT NULL DEFAULT 'Astera Result',
  created_by_user_id text,
  purpose text,
  private_mode boolean NOT NULL DEFAULT false,
  schema_version text NOT NULL,
  runtime_version text NOT NULL,
  purpose_version text NOT NULL DEFAULT 'unknown',
  completion_state text NOT NULL CHECK (completion_state IN ('complete', 'partial', 'failed')),
  result_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  current_revision integer NOT NULL DEFAULT 1 CHECK (current_revision >= 1),
  deleted_at timestamptz,
  undo_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS results_tenant_created
  ON results(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS results_tenant_user_created
  ON results(tenant_id, created_by_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS results_tenant_project
  ON results(tenant_id, project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS result_revisions (
  id uuid PRIMARY KEY,
  result_id uuid NOT NULL REFERENCES results(id) ON DELETE CASCADE,
  revision_number integer NOT NULL CHECK (revision_number >= 1),
  parent_revision_id uuid REFERENCES result_revisions(id),
  editor_user_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (result_id, revision_number)
);

CREATE TABLE IF NOT EXISTS result_sections (
  revision_id uuid NOT NULL REFERENCES result_revisions(id) ON DELETE CASCADE,
  section_key text NOT NULL CHECK (section_key IN (
    'true_purpose', 'missing_assumptions', 'fact_check', 'risk_detection',
    'counter_view', 'alternatives', 'recommendation', 'next_prompt'
  )),
  title text NOT NULL,
  content text NOT NULL,
  source_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  PRIMARY KEY (revision_id, section_key)
);

CREATE TABLE IF NOT EXISTS source_references (
  id uuid PRIMARY KEY,
  result_id uuid NOT NULL REFERENCES results(id) ON DELETE CASCADE,
  source_url text NOT NULL,
  title text NOT NULL,
  retrieved_at timestamptz NOT NULL,
  verification_status text NOT NULL CHECK (verification_status IN ('verified', 'unverified', 'unavailable'))
);

CREATE TABLE IF NOT EXISTS result_shares (
  id uuid PRIMARY KEY,
  result_id uuid NOT NULL REFERENCES results(id) ON DELETE CASCADE,
  tenant_id text NOT NULL,
  created_by text NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS result_shares_result ON result_shares(result_id, created_at DESC);
CREATE INDEX IF NOT EXISTS result_shares_tenant_created ON result_shares(tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS storage_destinations (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  user_id text NOT NULL,
  provider text NOT NULL,
  display_name text NOT NULL,
  vault_reference text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'active', 'expired', 'revoked', 'error')),
  capabilities jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS storage_destinations_user
  ON storage_destinations(tenant_id, user_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS transfer_jobs (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  destination_id uuid NOT NULL REFERENCES storage_destinations(id),
  result_id uuid REFERENCES results(id),
  checksum text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  status text NOT NULL,
  attempt integer NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
