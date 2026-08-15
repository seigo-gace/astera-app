PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  owner_user_id TEXT NOT NULL,
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, name)
);
CREATE INDEX IF NOT EXISTS projects_tenant_updated ON projects(tenant_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS project_members (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','editor','viewer')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (project_id, user_id)
);
CREATE INDEX IF NOT EXISTS project_members_tenant_user ON project_members(tenant_id, user_id, role);

CREATE TABLE IF NOT EXISTS results (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  job_id TEXT NOT NULL UNIQUE REFERENCES app_jobs(id),
  title TEXT NOT NULL DEFAULT 'Astera Result',
  created_by_user_id TEXT NOT NULL,
  purpose TEXT CHECK (purpose IS NULL OR purpose IN ('auto','review','compare','verify','improve','research','plan','consider')),
  private_mode INTEGER NOT NULL DEFAULT 0 CHECK (private_mode = 0),
  schema_version TEXT NOT NULL,
  runtime_version TEXT NOT NULL,
  purpose_version TEXT NOT NULL DEFAULT 'unknown',
  completion_state TEXT NOT NULL CHECK (completion_state IN ('complete','partial')),
  current_revision INTEGER NOT NULL DEFAULT 1 CHECK (current_revision >= 1),
  deleted_at TEXT,
  undo_until TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS results_tenant_created ON results(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS results_tenant_user_created ON results(tenant_id, created_by_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS results_tenant_project ON results(tenant_id, project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS results_active_history ON results(tenant_id, deleted_at, created_at DESC);

CREATE TABLE IF NOT EXISTS result_revisions (
  id TEXT PRIMARY KEY,
  result_id TEXT NOT NULL REFERENCES results(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  revision_number INTEGER NOT NULL CHECK (revision_number >= 1),
  parent_revision_id TEXT REFERENCES result_revisions(id),
  editor_user_id TEXT NOT NULL,
  revision_kind TEXT NOT NULL CHECK (revision_kind IN ('generated','manual_edit')),
  created_at TEXT NOT NULL,
  UNIQUE (result_id, revision_number)
);
CREATE INDEX IF NOT EXISTS result_revisions_result ON result_revisions(result_id, revision_number DESC);

CREATE TABLE IF NOT EXISTS result_sections (
  revision_id TEXT NOT NULL REFERENCES result_revisions(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  section_key TEXT NOT NULL CHECK (section_key IN (
    'true_purpose','missing_assumptions','fact_check','risk_detection',
    'counter_view','alternatives','recommendation','next_prompt'
  )),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  source_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(source_ids_json)),
  PRIMARY KEY (revision_id, section_key)
);

CREATE TABLE IF NOT EXISTS source_references (
  result_id TEXT NOT NULL REFERENCES results(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL,
  display_number INTEGER NOT NULL CHECK (display_number > 0),
  source_url TEXT NOT NULL,
  title TEXT NOT NULL,
  retrieved_at TEXT NOT NULL,
  verification_status TEXT NOT NULL CHECK (verification_status IN ('verified','unverified','unavailable')),
  PRIMARY KEY (result_id, source_id),
  UNIQUE (result_id, display_number)
);

CREATE TABLE IF NOT EXISTS result_shares (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  result_id TEXT NOT NULL REFERENCES results(id) ON DELETE CASCADE,
  revision_number INTEGER NOT NULL CHECK (revision_number >= 1),
  share_kind TEXT NOT NULL CHECK (share_kind IN ('public','private')),
  created_by_user_id TEXT NOT NULL,
  recipient_user_id TEXT,
  token_prefix TEXT,
  token_hash TEXT UNIQUE,
  password_hash TEXT,
  download_allowed INTEGER NOT NULL DEFAULT 0 CHECK (download_allowed IN (0,1)),
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (result_id, revision_number) REFERENCES result_revisions(result_id, revision_number),
  CHECK (
    (share_kind = 'public' AND token_hash IS NOT NULL AND recipient_user_id IS NULL)
    OR
    (share_kind = 'private' AND token_hash IS NULL AND recipient_user_id IS NOT NULL AND password_hash IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS result_shares_result ON result_shares(result_id, created_at DESC);
CREATE INDEX IF NOT EXISTS result_shares_tenant ON result_shares(tenant_id, revoked_at, expires_at);
CREATE INDEX IF NOT EXISTS result_shares_recipient ON result_shares(recipient_user_id, revoked_at, expires_at) WHERE recipient_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS user_preferences (
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  namespace TEXT NOT NULL,
  values_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(values_json)),
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, user_id, namespace)
);
CREATE INDEX IF NOT EXISTS user_preferences_user ON user_preferences(tenant_id, user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS personal_templates (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);
CREATE INDEX IF NOT EXISTS personal_templates_user ON personal_templates(tenant_id, user_id, archived_at, updated_at DESC);

