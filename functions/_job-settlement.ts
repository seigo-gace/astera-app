import {
  FunctionHttpError,
  type AsteraFunctionEnv,
} from './_account-projection';
import type { RuntimeJobEnvelope } from './_runtime';

const RESULT_KEYS = [
  'true_purpose',
  'missing_assumptions',
  'fact_check',
  'risk_detection',
  'counter_view',
  'alternatives',
  'recommendation',
  'next_prompt',
] as const;

type ResultKey = (typeof RESULT_KEYS)[number];

type NormalizedSection = {
  key: ResultKey;
  title: string;
  body: string;
  sourceIds: string[];
};

export type JobRow = {
  id: string;
  tenant_id: string;
  user_id: string;
  request_id: string;
  estimate_id: string;
  request_fingerprint: string;
  state: string;
  purpose: string;
  option_summary: string;
  file_count: number;
  private_mode: number;
  project_id: string | null;
  runtime_job_id: string | null;
  reserved_credits: number;
  committed_credits: number | null;
  result_schema_version: string | null;
  result_payload: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  cancelled_at: string | null;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function body(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.map(String).join('\n').trim();
  const source = record(value);
  for (const key of ['body', 'content', 'text']) {
    if (typeof source[key] === 'string' && source[key].trim()) return source[key].trim();
  }
  return '';
}

function sourceIds(value: unknown): string[] {
  const source = record(value);
  const list = source.sourceIds ?? source.source_ids;
  return Array.isArray(list) ? list.map(String).filter(Boolean) : [];
}

export function normalizeRuntimeResult(value: unknown, jobId: string): {
  schema_version: string;
  runtime_version: string;
  purpose_version: string;
  job_id: string;
  completion_state: 'complete' | 'partial';
  sections: NormalizedSection[];
  sources: unknown[];
  warnings: string[];
  generated_at: string;
} {
  const root = record(value);
  const result = record(root.result ?? root.data ?? root);
  const rawSections = result.sections;
  const byKey = new Map<string, NormalizedSection>();

  if (Array.isArray(rawSections)) {
    for (const item of rawSections) {
      const section = record(item);
      const key = typeof section.key === 'string' ? section.key.trim() : '';
      if (!RESULT_KEYS.includes(key as ResultKey) || byKey.has(key)) continue;
      const sectionBody = body(section);
      if (!sectionBody) continue;
      byKey.set(key, {
        key: key as ResultKey,
        title: typeof section.title === 'string' && section.title.trim() ? section.title.trim() : key,
        body: sectionBody,
        sourceIds: sourceIds(section),
      });
    }
  } else {
    const objectSections = record(rawSections);
    for (const key of RESULT_KEYS) {
      const source = objectSections[key] ?? result[key];
      const sectionBody = body(source);
      if (!sectionBody) continue;
      const section = record(source);
      byKey.set(key, {
        key,
        title: typeof section.title === 'string' && section.title.trim() ? section.title.trim() : key,
        body: sectionBody,
        sourceIds: sourceIds(source),
      });
    }
  }

  const sections = RESULT_KEYS.map((key) => byKey.get(key)).filter((item): item is NormalizedSection => Boolean(item));
  if (sections.length !== RESULT_KEYS.length) {
    throw new FunctionHttpError(502, 'ASTERA_RESPONSE_SECTIONS_INCOMPLETE', `固定8項目Resultが不足しています。受信: ${sections.length}`, {
      required: RESULT_KEYS,
      received: sections.map((section) => section.key),
    });
  }

  const completion = typeof result.completion_state === 'string'
    ? result.completion_state
    : typeof result.completionState === 'string'
      ? result.completionState
      : 'complete';
  if (!['complete', 'partial'].includes(completion)) {
    throw new FunctionHttpError(502, 'ASTERA_COMPLETION_STATE_INVALID', 'Result Completion Stateが不正です。');
  }

  return {
    schema_version: typeof result.schema_version === 'string' ? result.schema_version : typeof result.schemaVersion === 'string' ? result.schemaVersion : 'astera-result-v1',
    runtime_version: typeof result.runtime_version === 'string' ? result.runtime_version : typeof result.runtimeVersion === 'string' ? result.runtimeVersion : 'unknown',
    purpose_version: typeof result.purpose_version === 'string' ? result.purpose_version : typeof result.purposeVersion === 'string' ? result.purposeVersion : 'unknown',
    job_id: jobId,
    completion_state: completion as 'complete' | 'partial',
    sections,
    sources: Array.isArray(result.sources) ? result.sources : [],
    warnings: Array.isArray(result.warnings) ? result.warnings.map(String) : [],
    generated_at: typeof result.generated_at === 'string'
      ? result.generated_at
      : typeof result.generatedAt === 'string'
        ? result.generatedAt
        : new Date().toISOString(),
  };
}

function actualCredits(runtime: RuntimeJobEnvelope, reserved: number): { committed: number; exceeded: boolean } {
  const reported = runtime.usage?.credits;
  if (reported === undefined || !Number.isFinite(reported) || reported <= 0) return { committed: reserved, exceeded: false };
  const rounded = Math.ceil(reported);
  return { committed: Math.min(reserved, rounded), exceeded: rounded > reserved };
}

export async function settleCompletedJob(
  env: AsteraFunctionEnv,
  job: JobRow,
  runtime: RuntimeJobEnvelope,
  correlationId: string,
): Promise<JobRow> {
  if (job.state === 'completed' || job.state === 'partially_completed') return job;
  if (!runtime.result) throw new FunctionHttpError(502, 'ASTERA_RUNTIME_RESULT_MISSING', 'RuntimeがCompletedを返しましたがResultがありません。');
  const normalized = normalizeRuntimeResult(runtime.result, job.id);
  const { committed, exceeded } = actualCredits(runtime, Number(job.reserved_credits));
  const completionState = exceeded || normalized.completion_state === 'partial' ? 'partially_completed' : 'completed';
  if (exceeded) normalized.warnings.push('Runtime usage exceeded the reservation. Billing was capped at the confirmed reservation.');
  const now = new Date().toISOString();
  const releaseDifference = Number(job.reserved_credits) - committed;
  const transientResult = JSON.stringify(normalized);
  const persistedResult = Boolean(job.private_mode) ? null : transientResult;

  const statements = [
    env.ASTERA_DB.prepare(
      `UPDATE credit_reservations
       SET status = 'committed', committed_amount = ?1, updated_at = ?2
       WHERE job_id = ?3 AND status = 'reserved'`,
    ).bind(committed, now, job.id),
    env.ASTERA_DB.prepare(
      `INSERT OR IGNORE INTO credit_ledger
        (transaction_id, credit_account_id, kind, amount, idempotency_key,
         reference_type, reference_id, request_fingerprint, created_at)
       SELECT ?1, id, 'commit', ?2, ?3, 'job', ?4, ?5, ?6
       FROM credit_accounts WHERE tenant_id = ?7`,
    ).bind(`job-commit:${job.id}`, -committed, `job:${job.id}:commit`, job.id, job.request_fingerprint, now, job.tenant_id),
  ];
  if (releaseDifference > 0) {
    statements.push(env.ASTERA_DB.prepare(
      `INSERT OR IGNORE INTO credit_ledger
        (transaction_id, credit_account_id, kind, amount, idempotency_key,
         reference_type, reference_id, request_fingerprint, created_at)
       SELECT ?1, id, 'release', ?2, ?3, 'job', ?4, ?5, ?6
       FROM credit_accounts WHERE tenant_id = ?7`,
    ).bind(`job-release-difference:${job.id}`, -releaseDifference, `job:${job.id}:release-difference`, job.id, job.request_fingerprint, now, job.tenant_id));
  }
  statements.push(
    env.ASTERA_DB.prepare(
      `UPDATE app_jobs
       SET state = ?1, committed_credits = ?2, result_schema_version = ?3, result_payload = ?4,
           error_code = ?5, error_message = ?6, updated_at = ?7, completed_at = ?7
       WHERE id = ?8 AND state NOT IN ('completed', 'partially_completed')`,
    ).bind(
      completionState,
      committed,
      normalized.schema_version,
      persistedResult,
      exceeded ? 'CREDIT_USAGE_EXCEEDED_RESERVATION' : null,
      exceeded ? '実使用量が予約量を超えたため、請求を予約量で上限固定しました。' : null,
      now,
      job.id,
    ),
    env.ASTERA_DB.prepare(
      `INSERT OR IGNORE INTO job_events
        (id, job_id, from_state, to_state, correlation_id, metadata, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    ).bind(`event:settle:${job.id}`, job.id, job.state, completionState, correlationId, JSON.stringify({ committed, reserved: job.reserved_credits, exceeded }), now),
  );
  await env.ASTERA_DB.batch(statements);

  // For Private Mode the returned row carries the Result only in this response
  // object. D1 receives NULL, so subsequent reads cannot recover the content.
  return {
    ...job,
    state: completionState,
    committed_credits: committed,
    result_schema_version: normalized.schema_version,
    result_payload: transientResult,
    updated_at: now,
    completed_at: now,
  };
}

export async function releaseFailedJob(
  env: AsteraFunctionEnv,
  job: JobRow,
  state: 'failed' | 'cancelled',
  code: string,
  message: string,
  correlationId: string,
): Promise<JobRow> {
  if (['completed', 'partially_completed', 'failed', 'cancelled'].includes(job.state)) return job;
  const now = new Date().toISOString();
  await env.ASTERA_DB.batch([
    env.ASTERA_DB.prepare(
      `UPDATE credit_reservations SET status = 'released', updated_at = ?1
       WHERE job_id = ?2 AND status = 'reserved'`,
    ).bind(now, job.id),
    env.ASTERA_DB.prepare(
      `INSERT OR IGNORE INTO credit_ledger
        (transaction_id, credit_account_id, kind, amount, idempotency_key,
         reference_type, reference_id, request_fingerprint, created_at)
       SELECT ?1, id, 'release', ?2, ?3, 'job', ?4, ?5, ?6
       FROM credit_accounts WHERE tenant_id = ?7`,
    ).bind(`job-release:${job.id}`, -Number(job.reserved_credits), `job:${job.id}:release`, job.id, job.request_fingerprint, now, job.tenant_id),
    env.ASTERA_DB.prepare(
      `UPDATE app_jobs
       SET state = ?1, error_code = ?2, error_message = ?3, updated_at = ?4,
           cancelled_at = CASE WHEN ?1 = 'cancelled' THEN ?4 ELSE cancelled_at END
       WHERE id = ?5`,
    ).bind(state, code, message, now, job.id),
    env.ASTERA_DB.prepare(
      `INSERT OR IGNORE INTO job_events
        (id, job_id, from_state, to_state, correlation_id, metadata, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    ).bind(`event:${state}:${job.id}`, job.id, job.state, state, correlationId, JSON.stringify({ code, message }), now),
  ]);
  return { ...job, state, error_code: code, error_message: message, updated_at: now, cancelled_at: state === 'cancelled' ? now : job.cancelled_at };
}

export function publicJob(job: JobRow): Record<string, unknown> {
  let result: unknown = undefined;
  if (job.result_payload) {
    try { result = JSON.parse(job.result_payload); } catch { result = undefined; }
  }
  return {
    job_id: job.id,
    id: job.id,
    state: job.state,
    status: job.state,
    purpose: job.purpose,
    private_mode: Boolean(job.private_mode),
    project_id: job.project_id,
    reserved_credits: Number(job.reserved_credits),
    committed_credits: job.committed_credits === null ? null : Number(job.committed_credits),
    result,
    error: job.error_code ? { code: job.error_code, message: job.error_message } : null,
    created_at: job.created_at,
    updated_at: job.updated_at,
    completed_at: job.completed_at,
    cancelled_at: job.cancelled_at,
  };
}
