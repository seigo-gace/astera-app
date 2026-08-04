-- Astera App PostgreSQL migration candidate.
-- Source only: this file has not been applied to local, staging, or production PostgreSQL.

CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  name text NOT NULL,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS astera_results (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  job_id text NOT NULL UNIQUE,
  schema_version text NOT NULL,
  runtime_version text NOT NULL,
  completion_state text NOT NULL CHECK (completion_state IN ('complete', 'partial', 'failed')),
  current_revision integer NOT NULL DEFAULT 1 CHECK (current_revision >= 1),
  deleted_at timestamptz,
  undo_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS astera_results_tenant_created
  ON astera_results(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS astera_results_tenant_project
  ON astera_results(tenant_id, project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS result_revisions (
  id uuid PRIMARY KEY,
  result_id uuid NOT NULL REFERENCES astera_results(id) ON DELETE CASCADE,
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
  result_id uuid NOT NULL REFERENCES astera_results(id) ON DELETE CASCADE,
  source_url text NOT NULL,
  title text NOT NULL,
  retrieved_at timestamptz NOT NULL,
  verification_status text NOT NULL CHECK (verification_status IN ('verified', 'unverified', 'unavailable'))
);

CREATE TABLE IF NOT EXISTS share_links (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  result_id uuid NOT NULL REFERENCES astera_results(id) ON DELETE CASCADE,
  revision_id uuid NOT NULL REFERENCES result_revisions(id),
  visibility text NOT NULL CHECK (visibility IN ('public', 'private')),
  token_hash text UNIQUE,
  password_hash text,
  download_allowed boolean NOT NULL DEFAULT false,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS share_links_token_hash ON share_links(token_hash);

CREATE TABLE IF NOT EXISTS share_recipients (
  share_id uuid NOT NULL REFERENCES share_links(id) ON DELETE CASCADE,
  recipient_user_id text NOT NULL,
  PRIMARY KEY (share_id, recipient_user_id)
);

CREATE TABLE IF NOT EXISTS storage_destinations (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  provider text NOT NULL,
  account_label text NOT NULL,
  vault_reference text NOT NULL,
  status text NOT NULL,
  last_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS transfer_jobs (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  destination_id uuid NOT NULL REFERENCES storage_destinations(id),
  result_id uuid REFERENCES astera_results(id),
  checksum text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  status text NOT NULL,
  attempt integer NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
