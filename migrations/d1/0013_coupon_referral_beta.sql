PRAGMA foreign_keys = ON;

-- User-facing App projection for Admini-owned reward definitions.
-- Survey/feedback bodies are intentionally NOT stored in App D1.

CREATE TABLE IF NOT EXISTS reward_package_projection (
  id TEXT PRIMARY KEY,
  version INTEGER NOT NULL CHECK (version >= 1),
  status TEXT NOT NULL CHECK (status IN ('active', 'retired')),
  items_json TEXT NOT NULL,
  checksum TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS coupon_campaign_projection (
  id TEXT PRIMARY KEY,
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

CREATE INDEX IF NOT EXISTS coupon_code_campaign_idx
  ON coupon_code_projection(campaign_id, status);

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
  UNIQUE(code_digest, user_id, redemption_seq),
  UNIQUE(user_id, client_request_id)
);

CREATE INDEX IF NOT EXISTS coupon_redemption_user_idx
  ON coupon_redemptions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS coupon_redemption_state_idx
  ON coupon_redemptions(state, updated_at);

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
  UNIQUE(reference_type, reference_id, entitlement_type, entitlement_key)
);

CREATE INDEX IF NOT EXISTS reward_entitlement_subject_idx
  ON reward_entitlements(tenant_id, user_id, status, expires_at);

CREATE TABLE IF NOT EXISTS referral_policy_projection (
  id TEXT PRIMARY KEY CHECK (id = 'active'),
  status TEXT NOT NULL CHECK (status IN ('active','paused')),
  referred_reward_credit INTEGER NOT NULL CHECK (referred_reward_credit >= 0),
  milestones_json TEXT NOT NULL,
  minimum_account_age_hours INTEGER NOT NULL DEFAULT 24 CHECK (minimum_account_age_hours >= 0),
  minimum_completed_jobs INTEGER NOT NULL DEFAULT 1 CHECK (minimum_completed_jobs >= 0),
  policy_version INTEGER NOT NULL CHECK (policy_version >= 1),
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS referral_codes (
  user_id TEXT PRIMARY KEY,
  code_digest TEXT NOT NULL UNIQUE,
  masked_hint TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active','disabled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS referrals (
  id TEXT PRIMARY KEY,
  referrer_user_id TEXT NOT NULL,
  referred_user_id TEXT NOT NULL UNIQUE,
  referral_code_digest TEXT NOT NULL REFERENCES referral_codes(code_digest),
  state TEXT NOT NULL CHECK (state IN ('pending','qualified','rewarded','rejected','fraud_hold')),
  risk_level TEXT NOT NULL DEFAULT 'low' CHECK (risk_level IN ('low','medium','high')),
  qualification_reason TEXT,
  qualified_at TEXT,
  rewarded_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (referrer_user_id <> referred_user_id)
);

CREATE INDEX IF NOT EXISTS referrals_referrer_idx
  ON referrals(referrer_user_id, state, created_at);

CREATE TABLE IF NOT EXISTS referral_milestone_grants (
  id TEXT PRIMARY KEY,
  referrer_user_id TEXT NOT NULL,
  threshold INTEGER NOT NULL CHECK (threshold IN (1,3,5,10)),
  cumulative_credit INTEGER NOT NULL CHECK (cumulative_credit >= 0),
  delta_credit INTEGER NOT NULL CHECK (delta_credit >= 0),
  ledger_transaction_id TEXT,
  state TEXT NOT NULL CHECK (state IN ('pending','applied','failed','reconcile_required')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(referrer_user_id, threshold)
);

CREATE TABLE IF NOT EXISTS beta_policy_projection (
  id TEXT PRIMARY KEY CHECK (id = 'active'),
  status TEXT NOT NULL CHECK (status IN ('active','paused')),
  monthly_credit INTEGER NOT NULL CHECK (monthly_credit >= 0),
  minimum_commitment_days INTEGER NOT NULL CHECK (minimum_commitment_days > 0),
  policy_version INTEGER NOT NULL CHECK (policy_version >= 1),
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS beta_feature_projection (
  feature_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  lifecycle TEXT NOT NULL CHECK (lifecycle IN ('draft','active','paused','graduated','retired')),
  version TEXT NOT NULL,
  default_enabled INTEGER NOT NULL DEFAULT 0 CHECK (default_enabled IN (0,1)),
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS beta_participants (
  user_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('commitment_active','active','permanently_exited','blocked')),
  joined_at TEXT NOT NULL,
  commitment_until TEXT NOT NULL,
  commitment_days_snapshot INTEGER NOT NULL CHECK (commitment_days_snapshot > 0),
  policy_version_snapshot INTEGER NOT NULL CHECK (policy_version_snapshot >= 1),
  telemetry_enabled INTEGER NOT NULL DEFAULT 1 CHECK (telemetry_enabled IN (0,1)),
  exited_at TEXT,
  exit_reason TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS beta_feature_preferences (
  user_id TEXT NOT NULL REFERENCES beta_participants(user_id),
  feature_id TEXT NOT NULL REFERENCES beta_feature_projection(feature_id),
  enabled INTEGER NOT NULL CHECK (enabled IN (0,1)),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(user_id, feature_id)
);

CREATE TABLE IF NOT EXISTS beta_feature_usage_receipts (
  event_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES beta_participants(user_id),
  feature_id TEXT NOT NULL REFERENCES beta_feature_projection(feature_id),
  feature_version TEXT NOT NULL,
  target_month TEXT NOT NULL,
  server_received_at TEXT NOT NULL,
  CHECK (length(target_month) = 7)
);

CREATE INDEX IF NOT EXISTS beta_usage_subject_month_idx
  ON beta_feature_usage_receipts(user_id, target_month, feature_id);

-- Only an opaque Admini receipt is retained to unblock the forced overlay in the current session.
-- It is not a survey/feedback body, answer history, or duplicated submission record.
CREATE TABLE IF NOT EXISTS beta_survey_unlock_receipts (
  receipt_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  target_month TEXT NOT NULL,
  accepted_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  UNIQUE(user_id, target_month)
);
