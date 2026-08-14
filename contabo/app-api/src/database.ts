import { Pool, type PoolClient } from 'pg';

export type RuntimeState =
  | 'queued'
  | 'running'
  | 'assembling_result'
  | 'completed'
  | 'partially_completed'
  | 'failed'
  | 'cancel_requested'
  | 'cancelled';

export type RuntimeJobRow = {
  id: string;
  tenant_id: string;
  user_id: string;
  request_id: string;
  state: RuntimeState;
  purpose: string;
  private_mode: boolean;
  project_id: string | null;
  policy_version: string;
  reserved_credits: string;
  request_ciphertext: string | null;
  request_iv: string | null;
  result_json: unknown | null;
  usage_json: unknown | null;
  error_code: string | null;
  error_message: string | null;
  retryable: boolean;
  correlation_id: string;
  created_at: Date;
  updated_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
  cancelled_at: Date | null;
};

export type InsertRuntimeJob = {
  id: string;
  tenantId: string;
  userId: string;
  requestId: string;
  purpose: string;
  privateMode: boolean;
  projectId: string | null;
  policyVersion: string;
  reservedCredits: number;
  requestCiphertext: string | null;
  requestIv: string | null;
  correlationId: string;
};

export type TerminalUpdate = {
  state: 'completed' | 'partially_completed' | 'failed' | 'cancelled';
  result?: unknown;
  usage?: unknown;
  errorCode?: string | null;
  errorMessage?: string | null;
  retryable?: boolean;
};

export class RuntimeDatabase {
  readonly pool: Pool;

  constructor(databaseUrl: string) {
    this.pool = new Pool({
      connectionString: databaseUrl,
      max: 12,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      application_name: 'astera-app-api',
      ssl: databaseUrl.includes('sslmode=disable') ? false : { rejectUnauthorized: false },
    });
  }

  async ready(): Promise<void> {
    const result = await this.pool.query<{ table_name: string | null }>(
      `SELECT to_regclass('public.runtime_jobs')::text AS table_name`,
    );
    if (!result.rows[0]?.table_name) throw new Error('RUNTIME_JOBS_MIGRATION_NOT_APPLIED');
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const value = await work(client);
      await client.query('COMMIT');
      return value;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async insertOrGet(input: InsertRuntimeJob): Promise<{ job: RuntimeJobRow; created: boolean }> {
    return this.transaction(async (client) => {
      const inserted = await client.query<RuntimeJobRow>(
        `INSERT INTO runtime_jobs
          (id, tenant_id, user_id, request_id, state, purpose, private_mode, project_id,
           policy_version, reserved_credits, request_ciphertext, request_iv, correlation_id)
         VALUES ($1, $2, $3, $4, 'queued', $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (tenant_id, request_id) DO NOTHING
         RETURNING *`,
        [
          input.id,
          input.tenantId,
          input.userId,
          input.requestId,
          input.purpose,
          input.privateMode,
          input.projectId,
          input.policyVersion,
          input.reservedCredits,
          input.requestCiphertext,
          input.requestIv,
          input.correlationId,
        ],
      );
      if (inserted.rows[0]) {
        await client.query(
          `INSERT INTO runtime_job_events (id, job_id, from_state, to_state, correlation_id, metadata)
           VALUES ($1, $2, NULL, 'queued', $3, $4::jsonb)`,
          [crypto.randomUUID(), input.id, input.correlationId, JSON.stringify({ private_mode: input.privateMode })],
        );
        return { job: inserted.rows[0], created: true };
      }
      const existing = await client.query<RuntimeJobRow>(
        `SELECT * FROM runtime_jobs WHERE tenant_id = $1 AND request_id = $2 LIMIT 1`,
        [input.tenantId, input.requestId],
      );
      const job = existing.rows[0];
      if (!job) throw new Error('RUNTIME_JOB_IDEMPOTENCY_LOOKUP_FAILED');
      if (job.user_id !== input.userId) throw new Error('RUNTIME_JOB_IDEMPOTENCY_OWNERSHIP_MISMATCH');
      return { job, created: false };
    });
  }

  async get(id: string): Promise<RuntimeJobRow | null> {
    const result = await this.pool.query<RuntimeJobRow>(`SELECT * FROM runtime_jobs WHERE id = $1 LIMIT 1`, [id]);
    return result.rows[0] ?? null;
  }

  async transition(
    id: string,
    expectedStates: RuntimeState[],
    nextState: RuntimeState,
    correlationId: string,
    metadata: Record<string, unknown> = {},
  ): Promise<RuntimeJobRow | null> {
    return this.transaction(async (client) => {
      const current = await client.query<RuntimeJobRow>(`SELECT * FROM runtime_jobs WHERE id = $1 FOR UPDATE`, [id]);
      const job = current.rows[0];
      if (!job) return null;
      if (!expectedStates.includes(job.state)) return job;
      const result = await client.query<RuntimeJobRow>(
        `UPDATE runtime_jobs
         SET state = $1,
             updated_at = NOW(),
             started_at = CASE WHEN $1 = 'running' AND started_at IS NULL THEN NOW() ELSE started_at END,
             cancelled_at = CASE WHEN $1 = 'cancelled' THEN NOW() ELSE cancelled_at END
         WHERE id = $2
         RETURNING *`,
        [nextState, id],
      );
      await client.query(
        `INSERT INTO runtime_job_events (id, job_id, from_state, to_state, correlation_id, metadata)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
        [crypto.randomUUID(), id, job.state, nextState, correlationId, JSON.stringify(metadata)],
      );
      return result.rows[0] ?? job;
    });
  }

  async finish(id: string, update: TerminalUpdate, correlationId: string): Promise<RuntimeJobRow> {
    return this.transaction(async (client) => {
      const current = await client.query<RuntimeJobRow>(`SELECT * FROM runtime_jobs WHERE id = $1 FOR UPDATE`, [id]);
      const job = current.rows[0];
      if (!job) throw new Error('RUNTIME_JOB_NOT_FOUND');
      if (['completed', 'partially_completed', 'failed', 'cancelled'].includes(job.state)) return job;
      const persistedResult = job.private_mode || update.result === undefined ? null : JSON.stringify(update.result);
      const result = await client.query<RuntimeJobRow>(
        `UPDATE runtime_jobs
         SET state = $1,
             result_json = $2::jsonb,
             usage_json = $3::jsonb,
             error_code = $4,
             error_message = $5,
             retryable = $6,
             request_ciphertext = NULL,
             request_iv = NULL,
             updated_at = NOW(),
             completed_at = CASE WHEN $1 IN ('completed', 'partially_completed', 'failed') THEN NOW() ELSE completed_at END,
             cancelled_at = CASE WHEN $1 = 'cancelled' THEN NOW() ELSE cancelled_at END
         WHERE id = $7
         RETURNING *`,
        [
          update.state,
          persistedResult,
          update.usage === undefined ? null : JSON.stringify(update.usage),
          update.errorCode ?? null,
          update.errorMessage ?? null,
          update.retryable ?? false,
          id,
        ],
      );
      await client.query(
        `INSERT INTO runtime_job_events (id, job_id, from_state, to_state, correlation_id, metadata)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
        [crypto.randomUUID(), id, job.state, update.state, correlationId, JSON.stringify({ error_code: update.errorCode ?? null })],
      );
      return result.rows[0] as RuntimeJobRow;
    });
  }

  async recoverable(): Promise<RuntimeJobRow[]> {
    const result = await this.pool.query<RuntimeJobRow>(
      `SELECT * FROM runtime_jobs
       WHERE state IN ('queued', 'running', 'assembling_result', 'cancel_requested')
       ORDER BY created_at ASC`,
    );
    return result.rows;
  }
}
