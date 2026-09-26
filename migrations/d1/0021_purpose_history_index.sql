PRAGMA foreign_keys = ON;

-- Purpose is persisted as execution provenance and is an exact History filter.
-- Keep this query path indexed without deriving or reclassifying Purpose from Result text.
CREATE INDEX IF NOT EXISTS results_tenant_purpose_created
  ON results(tenant_id, purpose, created_at DESC);
