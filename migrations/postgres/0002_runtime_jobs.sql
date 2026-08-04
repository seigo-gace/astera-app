BEGIN;

CREATE TABLE IF NOT EXISTS runtime_jobs (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN (
    'queued', 'running', 'assembling_result', 'completed', 'partially_completed',
    'failed', 'cancel_requested', 'cancelled'
  )),
  purpose TEXT NOT NULL CHECK (purpose IN ('auto', 'review', 'compare', 'verify', 'improve', 'research', 'plan', 'consider')),
  private_mode BOOLEAN NOT NULL DEFAULT FALSE,
  project_id TEXT,
  policy_version TEXT NOT NULL,
  reserved_credits BIGINT NOT NULL CHECK (reserved_credits > 0),
  request_ciphertext TEXT,
  request_iv TEXT,
  result_json JSONB,
  usage_json JSONB,
  error_code TEXT,
  error_message TEXT,
  retryable BOOLEAN NOT NULL DEFAULT FALSE,
  correlation_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  UNIQUE (tenant_id, request_id)
);

CREATE INDEX IF NOT EXISTS runtime_jobs_state_updated
  ON runtime_jobs(state, updated_at);
CREATE INDEX IF NOT EXISTS runtime_jobs_tenant_created
  ON runtime_jobs(tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS runtime_job_events (
  id UUID PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES runtime_jobs(id) ON DELETE CASCADE,
  from_state TEXT,
  to_state TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS runtime_job_events_job_created
  ON runtime_job_events(job_id, created_at ASC);

COMMIT;
