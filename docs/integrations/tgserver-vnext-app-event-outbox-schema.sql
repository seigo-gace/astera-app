-- DESIGN AUTHORITY ONLY. NOT A D1 MIGRATION.
-- Migration number must be assigned only after the real integration target sequence is reconciled.
-- Current open-branch audit found PR #17 already owns an independent 0024 migration.

CREATE TABLE app_event_outbox (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 256),
  event_id TEXT NOT NULL UNIQUE CHECK (length(event_id) BETWEEN 1 AND 256),
  idempotency_key TEXT NOT NULL UNIQUE CHECK (length(idempotency_key) BETWEEN 1 AND 512),
  scope TEXT NOT NULL CHECK (scope IN ('system','user')),
  domain TEXT NOT NULL CHECK (domain IN (
    'runtime','auth','account','security','conversation','job','result','project','file','storage',
    'billing','credit','plan','share','template','notification','privacy','developer_api','integration','reconciliation'
  )),
  event_json TEXT NOT NULL CHECK (json_valid(event_json)),
  state TEXT NOT NULL CHECK (state IN ('pending','sending','delivered','retry_wait','dead_letter')),
  attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  next_retry_at TEXT,
  lease_expires_at TEXT,
  tgs_operation_id TEXT CHECK (tgs_operation_id IS NULL OR length(tgs_operation_id) BETWEEN 1 AND 512),
  created_at TEXT NOT NULL CHECK (length(created_at) = 24 AND substr(created_at, 24, 1) = 'Z'),
  updated_at TEXT NOT NULL CHECK (length(updated_at) = 24 AND substr(updated_at, 24, 1) = 'Z'),

  CHECK (json_extract(event_json, '$.schema') = 'astera.app.event.v1'),
  CHECK (event_id = json_extract(event_json, '$.eventId')),
  CHECK (scope = json_extract(event_json, '$.scope')),
  CHECK (domain = json_extract(event_json, '$.domain')),
  CHECK (typeof(json_extract(event_json, '$.event')) = 'text' AND length(json_extract(event_json, '$.event')) BETWEEN 1 AND 128),
  CHECK (typeof(json_extract(event_json, '$.correlationId')) = 'text' AND length(json_extract(event_json, '$.correlationId')) BETWEEN 1 AND 256),
  CHECK (updated_at >= created_at),
  CHECK (next_retry_at IS NULL OR (length(next_retry_at) = 24 AND substr(next_retry_at, 24, 1) = 'Z')),
  CHECK (lease_expires_at IS NULL OR (length(lease_expires_at) = 24 AND substr(lease_expires_at, 24, 1) = 'Z')),
  CHECK (state <> 'delivered' OR tgs_operation_id IS NOT NULL),
  CHECK (
    (state = 'sending' AND lease_expires_at IS NOT NULL AND lease_expires_at > updated_at AND next_retry_at IS NULL AND attempt >= 1)
    OR (state = 'retry_wait' AND next_retry_at IS NOT NULL AND next_retry_at > updated_at AND lease_expires_at IS NULL)
    OR (state IN ('pending','delivered','dead_letter') AND next_retry_at IS NULL AND lease_expires_at IS NULL)
  )
);

CREATE INDEX app_event_outbox_ready_idx
  ON app_event_outbox(state, next_retry_at, created_at, id);

CREATE INDEX app_event_outbox_lease_idx
  ON app_event_outbox(state, lease_expires_at);

CREATE INDEX app_event_outbox_route_idx
  ON app_event_outbox(scope, domain, state, created_at);
