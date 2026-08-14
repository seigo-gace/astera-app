-- Server-verifiable provenance for revision-only Credit estimates.
-- Raw prompt text is not persisted here. The SHA-256 verifier only lets the
-- server confirm that a client-supplied base prompt is the exact text used by
-- the completed parent job before calculating changed characters.

ALTER TABLE job_estimates ADD COLUMN prompt_sha256 TEXT;
ALTER TABLE job_estimates ADD COLUMN revision_parent_job_id TEXT;
ALTER TABLE job_estimates ADD COLUMN revision_billable_characters INTEGER
  CHECK (revision_billable_characters IS NULL OR revision_billable_characters >= 0);

CREATE INDEX IF NOT EXISTS job_estimates_revision_parent
  ON job_estimates(revision_parent_job_id, created_at DESC);
