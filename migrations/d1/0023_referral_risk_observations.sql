CREATE TABLE IF NOT EXISTS referral_risk_observations (
  user_id TEXT PRIMARY KEY,
  network_hash TEXT,
  device_hash TEXT,
  observed_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS referral_risk_observation_expiry_idx
  ON referral_risk_observations(expires_at);
