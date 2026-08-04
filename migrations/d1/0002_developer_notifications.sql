-- Astera App D1 migration candidate.
-- Source only: this file has not been applied to local, staging, or production D1.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS credit_notification_preferences (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id),
  app_enabled INTEGER NOT NULL DEFAULT 1 CHECK (app_enabled = 1),
  email_enabled INTEGER NOT NULL DEFAULT 0 CHECK (email_enabled IN (0, 1)),
  push_enabled INTEGER NOT NULL DEFAULT 0 CHECK (push_enabled IN (0, 1)),
  warning_policy_version TEXT NOT NULL,
  quiet_hours_json TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS credit_notification_events (
  id TEXT PRIMARY KEY,
  credit_account_id TEXT NOT NULL REFERENCES credit_accounts(id),
  state TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  warning_cycle TEXT NOT NULL,
  balance_snapshot_version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  UNIQUE(credit_account_id, policy_version, warning_cycle, state, balance_snapshot_version)
);

CREATE TABLE IF NOT EXISTS credit_return_contexts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL,
  surface TEXT NOT NULL CHECK (surface IN ('app', 'developer-api')),
  return_path TEXT NOT NULL,
  reference_id TEXT,
  required_credits INTEGER NOT NULL CHECK (required_credits >= 0),
  private_mode INTEGER NOT NULL DEFAULT 0 CHECK (private_mode IN (0, 1)),
  consumed_at TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS developer_api_targets (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  availability TEXT NOT NULL CHECK (availability IN ('available', 'preparing', 'blocked')),
  version TEXT,
  key_issuance_allowed INTEGER NOT NULL DEFAULT 0 CHECK (key_issuance_allowed IN (0, 1)),
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS api_key_fingerprints (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  target_id TEXT NOT NULL REFERENCES developer_api_targets(id),
  environment TEXT NOT NULL CHECK (environment IN ('sandbox', 'production')),
  key_name TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  scopes_json TEXT NOT NULL,
  control_status TEXT NOT NULL CHECK (control_status IN ('active', 'paused_user', 'revoked', 'expired')),
  auto_resume_after_credit INTEGER NOT NULL DEFAULT 1 CHECK (auto_resume_after_credit IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS api_key_runtime_holds (
  key_id TEXT NOT NULL REFERENCES api_key_fingerprints(id),
  reason TEXT NOT NULL CHECK (reason IN (
    'credit_insufficient', 'plan_entitlement', 'account_suspended', 'security_hold', 'target_suspended'
  )),
  created_at TEXT NOT NULL,
  released_at TEXT,
  PRIMARY KEY (key_id, reason)
);

CREATE TABLE IF NOT EXISTS api_key_status_history (
  id TEXT PRIMARY KEY,
  key_id TEXT NOT NULL REFERENCES api_key_fingerprints(id),
  event_type TEXT NOT NULL,
  reason TEXT,
  correlation_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
