-- Minimal Square webhook projections (no PII).
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS square_billing_projections (
  provider_event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  object_kind TEXT NOT NULL,
  object_id TEXT,
  status TEXT,
  amount INTEGER,
  currency TEXT,
  square_created_at TEXT,
  billing_intent_id TEXT,
  processing_status TEXT NOT NULL,
  recorded_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS square_billing_projections_type_recorded
  ON square_billing_projections(event_type, recorded_at DESC);
