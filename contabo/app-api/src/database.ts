import { Pool } from 'pg';

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

const TERMINAL_STATES = new Set<RuntimeState>(['completed', 'partially_completed', 'failed', 'cancelled']);
const TERMINAL_RETENTION_MS = 2 * 60 * 60 * 1000;

function cloneJob(job: RuntimeJobRow): RuntimeJobRow {
  return {
    ...job,
    created_at: new Date(job.created_at),
    updated_at: new Date(job.updated_at),
    started_at: job.started_at ? new Date(job.started_at) : null,
    completed_at: job.completed_at ? new Date(job.completed_at) : null,
    cancelled_at: job.cancelled_at ? new Date(job.cancelled_at) : null,
  };
}

function lostRuntimeJob(id: string): RuntimeJobRow {
  const now = new Date();
  return {
    id,
    tenant_id: '',
    user_id: '',
    request_id: '',
    state: 'failed',
    purpose: 'auto',
    private_mode: false,
    project_id: null,
    policy_version: '',
    reserved_credits: '0',
    request_ciphertext: null,
    request_iv: null,
    result_json: null,
    usage_json: null,
    error_code: 'RUNTIME_STATE_LOST_AFTER_RESTART',
    error_message: 'Runtime Memory Stateが失われました。Cloudflare D1側でJobを失敗確定し、予約CreditをReleaseしてください。',
    retryable: false,
    correlation_id: '',
    created_at: now,
    updated_at: now,
    started_at: null,
    completed_at: now,
    cancelled_at: null,
  };
}

/**
 * Runtime execution state is intentionally process-local.
 * Cloudflare D1 `app_jobs` is the only persistent App Job authority.
 * `pool` remains temporarily exposed only for legacy Workspace/Storage routes
 * and must not be used by Runtime state methods.
 */
export class RuntimeDatabase {
  readonly pool: Pool;
  private readonly jobs = new Map<string, RuntimeJobRow>();
  private readonly requestIndex = new Map<string, string>();

  constructor(databaseUrl: string) {
    this.pool = new Pool({
      connectionString: databaseUrl,
      max: 12,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      application_name: 'astera-app-api-legacy-storage',
      ssl: databaseUrl.includes('sslmode=disable') ? false : { rejectUnauthorized: false },
    });
  }

  async ready(): Promise<void> {
    // Runtime Job state does not depend on PostgreSQL. Legacy Storage/Workspace
    // routes validate their own database access when invoked during migration.
  }

  async close(): Promise<void> {
    this.jobs.clear();
    this.requestIndex.clear();
    await this.pool.end();
  }

  private requestKey(tenantId: string, requestId: string): string {
    return `${tenantId}\u0000${requestId}`;
  }

  private prune(now = Date.now()): void {
    for (const [id, job] of this.jobs) {
      if (!TERMINAL_STATES.has(job.state)) continue;
      if (now - job.updated_at.getTime() <= TERMINAL_RETENTION_MS) continue;
      this.jobs.delete(id);
      this.requestIndex.delete(this.requestKey(job.tenant_id, job.request_id));
    }
  }

  async insertOrGet(input: InsertRuntimeJob): Promise<{ job: RuntimeJobRow; created: boolean }> {
    this.prune();
    const key = this.requestKey(input.tenantId, input.requestId);
    const existingId = this.requestIndex.get(key);
    if (existingId) {
      const existing = this.jobs.get(existingId);
      if (existing) {
        if (existing.user_id !== input.userId) throw new Error('RUNTIME_JOB_IDEMPOTENCY_OWNERSHIP_MISMATCH');
        return { job: cloneJob(existing), created: false };
      }
      this.requestIndex.delete(key);
    }
    if (this.jobs.has(input.id)) {
      const existing = this.jobs.get(input.id)!;
      if (existing.tenant_id !== input.tenantId || existing.user_id !== input.userId || existing.request_id !== input.requestId) {
        throw new Error('RUNTIME_JOB_ID_COLLISION');
      }
      return { job: cloneJob(existing), created: false };
    }
    const now = new Date();
    const job: RuntimeJobRow = {
      id: input.id,
      tenant_id: input.tenantId,
      user_id: input.userId,
      request_id: input.requestId,
      state: 'queued',
      purpose: input.purpose,
      private_mode: input.privateMode,
      project_id: input.projectId,
      policy_version: input.policyVersion,
      reserved_credits: String(input.reservedCredits),
      request_ciphertext: input.requestCiphertext,
      request_iv: input.requestIv,
      result_json: null,
      usage_json: null,
      error_code: null,
      error_message: null,
      retryable: false,
      correlation_id: input.correlationId,
      created_at: now,
      updated_at: now,
      started_at: null,
      completed_at: null,
      cancelled_at: null,
    };
    this.jobs.set(job.id, job);
    this.requestIndex.set(key, job.id);
    return { job: cloneJob(job), created: true };
  }

  async get(id: string): Promise<RuntimeJobRow | null> {
    this.prune();
    const job = this.jobs.get(id);
    // A known D1 Job may outlive the process-local Runtime state after restart.
    // Returning a terminal loss envelope lets existing Cloudflare settlement
    // release reserved Credit instead of leaving the Job stuck indefinitely.
    return job ? cloneJob(job) : lostRuntimeJob(id);
  }

  async transition(
    id: string,
    expectedStates: RuntimeState[],
    nextState: RuntimeState,
    correlationId: string,
    _metadata: Record<string, unknown> = {},
  ): Promise<RuntimeJobRow | null> {
    const job = this.jobs.get(id);
    if (!job) return null;
    if (!expectedStates.includes(job.state)) return cloneJob(job);
    const now = new Date();
    const previous = job.state;
    job.state = nextState;
    job.correlation_id = correlationId || job.correlation_id;
    job.updated_at = now;
    if (nextState === 'running' && !job.started_at) job.started_at = now;
    if (nextState === 'cancelled') job.cancelled_at = now;
    if (previous !== nextState) this.jobs.set(id, job);
    return cloneJob(job);
  }

  async finish(id: string, update: TerminalUpdate, correlationId: string): Promise<RuntimeJobRow> {
    const job = this.jobs.get(id);
    if (!job) throw new Error('RUNTIME_JOB_NOT_FOUND');
    if (TERMINAL_STATES.has(job.state)) return cloneJob(job);
    const now = new Date();
    job.state = update.state;
    job.result_json = job.private_mode || update.result === undefined ? null : structuredClone(update.result);
    job.usage_json = update.usage === undefined ? null : structuredClone(update.usage);
    job.error_code = update.errorCode ?? null;
    job.error_message = update.errorMessage ?? null;
    job.retryable = update.retryable ?? false;
    job.request_ciphertext = null;
    job.request_iv = null;
    job.correlation_id = correlationId || job.correlation_id;
    job.updated_at = now;
    if (['completed', 'partially_completed', 'failed'].includes(update.state)) job.completed_at = now;
    if (update.state === 'cancelled') job.cancelled_at = now;
    this.jobs.set(id, job);
    return cloneJob(job);
  }

  async recoverable(): Promise<RuntimeJobRow[]> {
    // No Runtime request payload is persisted on Contabo. After a process
    // restart, D1 polling receives RUNTIME_STATE_LOST_AFTER_RESTART and closes
    // the Job/credit reservation safely instead of auto-replaying user input.
    return [];
  }
}
