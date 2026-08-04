-- Astera App D1 migration candidate.
-- Source only: this file has not been applied to local, staging, or production D1.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('personal', 'shared')),
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_profiles (
  user_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  nickname TEXT NOT NULL,
  account_status TEXT NOT NULL CHECK (account_status IN (
    'pending_email_verification', 'pending_password_setup', 'active',
    'security_hold', 'suspended', 'deletion_scheduled', 'deleted'
  )),
  ui_language TEXT NOT NULL DEFAULT 'ja-JP',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS catalog_versions (
  version TEXT PRIMARY KEY,
  checksum TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'retired')),
  published_at TEXT,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS one_active_catalog
  ON catalog_versions(status) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS billing_intents (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL,
  catalog_version TEXT NOT NULL REFERENCES catalog_versions(version),
  product_id TEXT NOT NULL,
  currency TEXT NOT NULL CHECK (currency = 'JPY'),
  amount INTEGER NOT NULL CHECK (amount >= 0),
  status TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  provider_checkout_id TEXT UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS billing_events (
  provider_event_id TEXT PRIMARY KEY,
  billing_intent_id TEXT REFERENCES billing_intents(id),
  signature_verified INTEGER NOT NULL CHECK (signature_verified IN (0, 1)),
  event_type TEXT NOT NULL,
  received_at TEXT NOT NULL,
  processed_at TEXT,
  processing_status TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS credit_accounts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL UNIQUE REFERENCES tenants(id),
  available_balance INTEGER NOT NULL DEFAULT 0 CHECK (available_balance >= 0),
  reserved_balance INTEGER NOT NULL DEFAULT 0 CHECK (reserved_balance >= 0),
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS credit_ledger (
  transaction_id TEXT PRIMARY KEY,
  credit_account_id TEXT NOT NULL REFERENCES credit_accounts(id),
  kind TEXT NOT NULL CHECK (kind IN ('grant', 'reserve', 'commit', 'release', 'refund', 'adjustment')),
  amount INTEGER NOT NULL CHECK (amount <> 0),
  idempotency_key TEXT NOT NULL UNIQUE,
  reference_type TEXT NOT NULL,
  reference_id TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(reference_type, reference_id, kind)
);

CREATE INDEX IF NOT EXISTS credit_ledger_account_created
  ON credit_ledger(credit_account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS credit_reservations (
  id TEXT PRIMARY KEY,
  credit_account_id TEXT NOT NULL REFERENCES credit_accounts(id),
  job_id TEXT NOT NULL UNIQUE,
  estimated_amount INTEGER NOT NULL CHECK (estimated_amount > 0),
  committed_amount INTEGER CHECK (committed_amount >= 0),
  status TEXT NOT NULL CHECK (status IN ('reserved', 'committed', 'released', 'expired')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
