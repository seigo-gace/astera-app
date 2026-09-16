-- Publish the canonical Astera credit formula used by the job runtime.
-- Commercial values come from the current Notion canon and are materialized in D1 for runtime use.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS credit_formula_policies (
  version TEXT PRIMARY KEY REFERENCES credit_policies(version) ON DELETE CASCADE,
  ascii_milli_per_char INTEGER NOT NULL CHECK (ascii_milli_per_char > 0),
  non_ascii_milli_per_char INTEGER NOT NULL CHECK (non_ascii_milli_per_char > 0),
  option_multiplier_milli INTEGER NOT NULL CHECK (option_multiplier_milli >= 0),
  output_billed INTEGER NOT NULL DEFAULT 0 CHECK (output_billed IN (0, 1)),
  warning_thresholds_published INTEGER NOT NULL DEFAULT 0 CHECK (warning_thresholds_published IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- An active policy is unique. Retire any previous active formula before activating the canonical one.
UPDATE credit_policies
SET status = 'retired'
WHERE status = 'active'
  AND version <> 'credit-formula-2026-09-16-v1';

-- Several legacy NOT NULL columns remain in credit_policies for schema compatibility.
-- The current runtime reads the formula from credit_formula_policies and does not use
-- base_credits / characters_per_credit / file_bytes_per_credit / option_costs for billing.
INSERT INTO credit_policies (
  version,
  status,
  base_credits,
  characters_per_credit,
  file_bytes_per_credit,
  option_costs,
  low_threshold,
  critical_threshold,
  max_estimate,
  estimate_ttl_seconds,
  reservation_ttl_seconds,
  published_at,
  created_at
) VALUES (
  'credit-formula-2026-09-16-v1',
  'active',
  1,
  1,
  2147483647,
  '{"translation":0,"agent-mode":0,"document":0,"external-storage-transfer":0}',
  0,
  0,
  1500,
  600,
  1800,
  '2026-09-16T00:00:00.000Z',
  '2026-09-16T00:00:00.000Z'
)
ON CONFLICT(version) DO UPDATE SET
  status = 'active',
  max_estimate = excluded.max_estimate,
  estimate_ttl_seconds = excluded.estimate_ttl_seconds,
  reservation_ttl_seconds = excluded.reservation_ttl_seconds,
  published_at = excluded.published_at;

INSERT INTO credit_formula_policies (
  version,
  ascii_milli_per_char,
  non_ascii_milli_per_char,
  option_multiplier_milli,
  output_billed,
  warning_thresholds_published,
  created_at,
  updated_at
) VALUES (
  'credit-formula-2026-09-16-v1',
  1000,
  1500,
  500,
  0,
  0,
  '2026-09-16T00:00:00.000Z',
  '2026-09-16T00:00:00.000Z'
)
ON CONFLICT(version) DO UPDATE SET
  ascii_milli_per_char = excluded.ascii_milli_per_char,
  non_ascii_milli_per_char = excluded.non_ascii_milli_per_char,
  option_multiplier_milli = excluded.option_multiplier_milli,
  output_billed = excluded.output_billed,
  warning_thresholds_published = excluded.warning_thresholds_published,
  updated_at = excluded.updated_at;
