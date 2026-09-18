CREATE TABLE IF NOT EXISTS beta_telemetry_outbox (
  event_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  feature_id TEXT NOT NULL,
  sanitized_event_json TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS beta_telemetry_outbox_retry_idx
  ON beta_telemetry_outbox(next_attempt_at, expires_at);
