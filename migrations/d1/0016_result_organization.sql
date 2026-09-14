-- Result organization state for GPT-style Pin / Archive navigation.
ALTER TABLE results ADD COLUMN archived_at TEXT;
ALTER TABLE results ADD COLUMN pinned_at TEXT;

CREATE INDEX IF NOT EXISTS results_tenant_archive_created
  ON results(tenant_id, archived_at, created_at DESC);

CREATE INDEX IF NOT EXISTS results_tenant_pin_created
  ON results(tenant_id, pinned_at, created_at DESC);
