-- Job estimate, credit policy, upload reference and runtime state schema.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS credit_policies (
  version TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'retired')),
  base_credits INTEGER NOT NULL CHECK (base_credits > 0),
  characters_per_credit INTEGER NOT NULL CHECK (characters_per_credit > 0),
  file_bytes_per_credit INTEGER NOT NULL CHECK (file_bytes_per_credit > 0),
  option_costs TEXT NOT NULL DEFAULT '{}',
  low_threshold INTEGER NOT NULL CHECK (low_threshold >= 0),
  critical_threshold INTEGER NOT NULL CHECK (critical_threshold >= 0 AND critical_threshold <= low_threshold),
  max_estimate INTEGER NOT NULL CHECK (max_estimate > 0),
  estimate_ttl_seconds INTEGER NOT NULL DEFAULT 600 CHECK (estimate_ttl_seconds BETWEEN 60 AND 3600),
  reservation_ttl_seconds INTEGER NOT NULL DEFAULT 1800 CHECK (reservation_ttl_seconds BETWEEN 60 AND 86400),
  published_at TEXT,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS one_active_credit_policy
  ON credit_policies(status) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS upload_objects (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  sha256 TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('uploading', 'ready', 'quarantined', 'deleted', 'expired')),
  private_mode INTEGER NOT NULL DEFAULT 0 CHECK (private_mode IN (0, 1)),
  expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS upload_objects_tenant_status
  ON upload_objects(tenant_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS job_estimates (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  policy_version TEXT NOT NULL REFERENCES credit_policies(version),
  required_credits INTEGER NOT NULL CHECK (required_credits > 0),
  available_credits_snapshot INTEGER NOT NULL CHECK (available_credits_snapshot >= 0),
  reserved_credits_snapshot INTEGER NOT NULL CHECK (reserved_credits_snapshot >= 0),
  credit_account_version INTEGER NOT NULL CHECK (credit_account_version >= 0),
  credit_state TEXT NOT NULL CHECK (credit_state IN ('normal', 'low', 'critical', 'insufficient')),
  status TEXT NOT NULL CHECK (status IN ('active', 'consumed', 'expired', 'cancelled')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  consumed_at TEXT
);

CREATE INDEX IF NOT EXISTS job_estimates_tenant_expiry
  ON job_estimates(tenant_id, status, expires_at);

CREATE TABLE IF NOT EXISTS app_jobs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  estimate_id TEXT NOT NULL REFERENCES job_estimates(id),
  request_fingerprint TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN (
    'reserving_credit', 'uploading', 'queued', 'running', 'assembling_result',
    'completed', 'partially_completed', 'failed', 'cancel_requested', 'cancelled'
  )),
  purpose TEXT NOT NULL CHECK (purpose IN ('auto', 'review', 'compare', 'verify', 'improve', 'research', 'plan', 'consider')),
  option_summary TEXT NOT NULL DEFAULT '[]',
  file_count INTEGER NOT NULL DEFAULT 0 CHECK (file_count >= 0),
  private_mode INTEGER NOT NULL DEFAULT 0 CHECK (private_mode IN (0, 1)),
  project_id TEXT,
  runtime_job_id TEXT UNIQUE,
  reserved_credits INTEGER NOT NULL CHECK (reserved_credits > 0),
  committed_credits INTEGER CHECK (committed_credits >= 0),
  result_schema_version TEXT,
  result_payload TEXT,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  cancelled_at TEXT,
  UNIQUE (tenant_id, request_id)
);

CREATE INDEX IF NOT EXISTS app_jobs_tenant_created
  ON app_jobs(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS app_jobs_state
  ON app_jobs(state, updated_at);

CREATE TABLE IF NOT EXISTS job_events (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES app_jobs(id) ON DELETE CASCADE,
  from_state TEXT,
  to_state TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS job_events_job_created
  ON job_events(job_id, created_at ASC);

-- Reservation is rejected before any balance can become negative.
CREATE TRIGGER IF NOT EXISTS credit_reservation_before_insert
BEFORE INSERT ON credit_reservations
WHEN NEW.status = 'reserved'
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM credit_accounts
      WHERE id = NEW.credit_account_id
        AND (available_balance - reserved_balance) >= NEW.estimated_amount
    )
    THEN RAISE(ABORT, 'CREDIT_INSUFFICIENT_FOR_RESERVATION')
  END;
END;

CREATE TRIGGER IF NOT EXISTS credit_reservation_after_insert
AFTER INSERT ON credit_reservations
WHEN NEW.status = 'reserved'
BEGIN
  UPDATE credit_accounts
  SET reserved_balance = reserved_balance + NEW.estimated_amount,
      version = version + 1,
      updated_at = NEW.created_at
  WHERE id = NEW.credit_account_id;
END;

CREATE TRIGGER IF NOT EXISTS credit_reservation_commit
AFTER UPDATE OF status, committed_amount ON credit_reservations
WHEN OLD.status = 'reserved' AND NEW.status = 'committed'
BEGIN
  SELECT CASE
    WHEN NEW.committed_amount IS NULL OR NEW.committed_amount < 0 OR NEW.committed_amount > OLD.estimated_amount
    THEN RAISE(ABORT, 'CREDIT_COMMIT_AMOUNT_INVALID')
  END;
  UPDATE credit_accounts
  SET available_balance = available_balance - NEW.committed_amount,
      reserved_balance = reserved_balance - OLD.estimated_amount,
      version = version + 1,
      updated_at = NEW.updated_at
  WHERE id = NEW.credit_account_id;
END;

CREATE TRIGGER IF NOT EXISTS credit_reservation_release
AFTER UPDATE OF status ON credit_reservations
WHEN OLD.status = 'reserved' AND NEW.status IN ('released', 'expired')
BEGIN
  UPDATE credit_accounts
  SET reserved_balance = reserved_balance - OLD.estimated_amount,
      version = version + 1,
      updated_at = NEW.updated_at
  WHERE id = NEW.credit_account_id;
END;
