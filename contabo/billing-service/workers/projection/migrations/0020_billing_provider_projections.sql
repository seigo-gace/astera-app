-- Provider-neutral billing projections written by astera-billing via internal Pages API.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS billing_event_projections (
  provider_event_id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  correlation_id TEXT NOT NULL,
  tenant_id TEXT REFERENCES tenants(id),
  event_type TEXT NOT NULL,
  object_kind TEXT NOT NULL,
  object_id TEXT,
  status TEXT,
  amount INTEGER,
  currency TEXT,
  provider_created_at TEXT,
  billing_intent_id TEXT,
  processing_status TEXT NOT NULL,
  recorded_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS billing_event_projections_type_recorded
  ON billing_event_projections(event_type, recorded_at DESC);

CREATE TABLE IF NOT EXISTS billing_subscription_projections (
  idempotency_key TEXT PRIMARY KEY,
  correlation_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL,
  catalog_version TEXT NOT NULL REFERENCES catalog_versions(version),
  plan_id TEXT NOT NULL,
  billing_cycle TEXT NOT NULL CHECK (billing_cycle IN ('monthly', 'annual')),
  provider_subscription_id TEXT,
  status TEXT NOT NULL,
  current_period_start TEXT,
  current_period_end TEXT,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0 CHECK (cancel_at_period_end IN (0, 1)),
  recorded_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS billing_subscription_projections_tenant_recorded
  ON billing_subscription_projections(tenant_id, recorded_at DESC);

CREATE TABLE IF NOT EXISTS billing_internal_idempotency (
  operation TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (operation, idempotency_key)
);
