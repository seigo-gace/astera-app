-- DESIGN AUTHORITY ONLY. NOT A D1 MIGRATION.
-- Migration number must be assigned only after the real integration target sequence is reconciled.

CREATE TABLE app_event_outbox (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE,
  idempotency_key TEXT NOT NULL UNIQUE,
  event_json TEXT NOT NULL CHECK (json_valid(event_json)),
  state TEXT NOT NULL CHECK (state IN ('pending','sending','delivered','retry_wait','dead_letter')),
  attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  next_retry_at TEXT,
  lease_expires_at TEXT,
  tgs_operation_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    (state = 'sending' AND lease_expires_at IS NOT NULL AND next_retry_at IS NULL AND attempt >= 1)
    OR (state = 'retry_wait' AND next_retry_at IS NOT NULL AND lease_expires_at IS NULL)
    OR (state IN ('pending','delivered','dead_letter') AND next_retry_at IS NULL AND lease_expires_at IS NULL)
  )
);

CREATE INDEX app_event_outbox_ready_idx
  ON app_event_outbox(state, next_retry_at, created_at, id);

CREATE INDEX app_event_outbox_lease_idx
  ON app_event_outbox(state, lease_expires_at);
