PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS personal_template_versions (
  template_id TEXT NOT NULL REFERENCES personal_templates(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
  change_kind TEXT NOT NULL CHECK (change_kind IN ('create','update','duplicate','delete')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (template_id, version)
);
CREATE INDEX IF NOT EXISTS personal_template_versions_owner
  ON personal_template_versions(tenant_id, user_id, template_id, version DESC);
