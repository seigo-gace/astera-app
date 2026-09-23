PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS reward_package_projection (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  status TEXT NOT NULL CHECK (status IN ('active','retired')),
  items_json TEXT NOT NULL,
  checksum TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS coupon_campaign_projection (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  purpose TEXT NOT NULL,
  reward_package_id TEXT NOT NULL REFERENCES reward_package_projection(id),
  status TEXT NOT NULL CHECK (status IN ('draft','scheduled','active','paused','exhausted','expired','revoked')),
  distribution_mode TEXT NOT NULL CHECK (distribution_mode IN ('UNIQUE','SHARED','ACCOUNT_BOUND')),
  starts_at TEXT,
  expires_at TEXT,
  total_limit INTEGER CHECK (total_limit IS NULL OR total_limit > 0),
  per_account_limit INTEGER NOT NULL DEFAULT 1 CHECK (per_account_limit > 0),
  redeemed_count INTEGER NOT NULL DEFAULT 0 CHECK (redeemed_count >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS coupon_code_projection (
  code_digest TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES coupon_campaign_projection(id),
  masked_hint TEXT NOT NULL,
  bound_user_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('active','paused','exhausted','expired','revoked')),
  redemption_limit INTEGER NOT NULL DEFAULT 1 CHECK (redemption_limit > 0),
  redeemed_count INTEGER NOT NULL DEFAULT 0 CHECK (redeemed_count >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS coupon_code_campaign_idx ON coupon_code_projection(campaign_id,status);

CREATE TABLE IF NOT EXISTS coupon_redemptions (
  id TEXT PRIMARY KEY,
  code_digest TEXT NOT NULL REFERENCES coupon_code_projection(code_digest),
  campaign_id TEXT NOT NULL REFERENCES coupon_campaign_projection(id),
  reward_package_id TEXT NOT NULL REFERENCES reward_package_projection(id),
  user_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  redemption_seq INTEGER NOT NULL CHECK (redemption_seq > 0),
  state TEXT NOT NULL CHECK (state IN ('reserved','applying','applied','failed','reconcile_required','revoked')),
  client_request_id TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  applied_at TEXT,
  UNIQUE(code_digest,user_id,redemption_seq),
  UNIQUE(campaign_id,user_id,redemption_seq),
  UNIQUE(user_id,client_request_id)
);
CREATE INDEX IF NOT EXISTS coupon_redemption_user_idx ON coupon_redemptions(user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS coupon_redemption_state_idx ON coupon_redemptions(state,updated_at);

CREATE TABLE IF NOT EXISTS reward_entitlements (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  entitlement_type TEXT NOT NULL CHECK (entitlement_type IN ('access_tier','feature','seat_limit','benefit')),
  entitlement_key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  expires_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('active','expired','revoked')),
  reference_type TEXT NOT NULL,
  reference_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(reference_type,reference_id,entitlement_type,entitlement_key)
);
CREATE INDEX IF NOT EXISTS reward_entitlement_subject_idx ON reward_entitlements(tenant_id,user_id,status,expires_at);

CREATE TABLE IF NOT EXISTS reward_credit_schedules (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  remaining_grants INTEGER NOT NULL CHECK (remaining_grants >= 0),
  grants_applied INTEGER NOT NULL DEFAULT 1 CHECK (grants_applied >= 1),
  cadence_months INTEGER NOT NULL DEFAULT 1 CHECK (cadence_months > 0),
  next_grant_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('active','completed','paused','revoked','reconcile_required')),
  reference_type TEXT NOT NULL,
  reference_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(reference_type,reference_id)
);
CREATE INDEX IF NOT EXISTS reward_credit_schedule_due_idx ON reward_credit_schedules(status,next_grant_at);
