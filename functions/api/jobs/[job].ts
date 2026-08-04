import {
  FunctionHttpError,
  functionErrorResponse,
  requestCorrelationId,
  requireAsteraActor,
  type AsteraFunctionEnv,
} from '../../_account-projection';
import {
  publicJob,
  releaseFailedJob,
  settleCompletedJob,
  type JobRow,
} from '../../_job-settlement';
import {
  getRuntimeJob,
  type RuntimeEnv,
  type RuntimeJobState,
} from '../../_runtime';

type Env = AsteraFunctionEnv & RuntimeEnv;
type PagesContext = { request: Request; env: Env; params: { job?: string } };

async function loadJob(context: PagesContext, tenantId: string, userId: string, jobId: string): Promise<JobRow> {
  const job = await context.env.ASTERA_DB.prepare(
    `SELECT id, tenant_id, user_id, request_id, estimate_id, request_fingerprint, state, purpose,
            option_summary, file_count, private_mode, project_id, runtime_job_id, reserved_credits,
            committed_credits, result_schema_version, result_payload, error_code, error_message,
            created_at, updated_at, completed_at, cancelled_at
     FROM app_jobs WHERE id = ?1 AND tenant_id = ?2 LIMIT 1`,
  ).bind(jobId, tenantId).first<JobRow>();
  if (!job) throw new FunctionHttpError(404, 'JOB_NOT_FOUND', 'Jobが見つかりません。');
  if (job.user_id !== userId) throw new FunctionHttpError(403, 'JOB_OWNERSHIP_MISMATCH', '別UserのJobは参照できません。');
  return job;
}

function localState(runtime: RuntimeJobState): string {
  if (runtime === 'completed' || runtime === 'partially_completed') return 'assembling_result';
  return runtime;
}

export async function onRequestGet(context: PagesContext): Promise<Response> {
  const correlationId = requestCorrelationId(context.request);
  try {
    const actor = await requireAsteraActor(context.request, context.env);
    const jobId = context.params.job?.trim();
    if (!jobId) throw new FunctionHttpError(400, 'JOB_ID_REQUIRED', 'Job IDが必要です。');
    let job = await loadJob(context, actor.profile.tenant_id, actor.user.id, jobId);
    if (['completed', 'partially_completed', 'failed', 'cancelled'].includes(job.state) || !job.runtime_job_id) {
      return Response.json({ job: publicJob(job) }, { headers: { 'Cache-Control': 'no-store', 'X-Correlation-ID': correlationId } });
    }

    const runtime = await getRuntimeJob(context.env, job.runtime_job_id, correlationId);
    if (runtime.state === 'completed' || runtime.state === 'partially_completed') {
      job = await settleCompletedJob(context.env, job, runtime, correlationId);
    } else if (runtime.state === 'failed' || runtime.state === 'cancelled') {
      job = await releaseFailedJob(
        context.env,
        job,
        runtime.state === 'cancelled' ? 'cancelled' : 'failed',
        runtime.error?.code || `ASTERA_RUNTIME_${runtime.state.toUpperCase()}`,
        runtime.error?.message || `Astera Runtimeが${runtime.state}を返しました。`,
        correlationId,
      );
    } else {
      const nextState = localState(runtime.state);
      if (nextState !== job.state) {
        const now = new Date().toISOString();
        await context.env.ASTERA_DB.batch([
          context.env.ASTERA_DB.prepare(
            `UPDATE app_jobs SET state = ?1, updated_at = ?2 WHERE id = ?3`,
          ).bind(nextState, now, job.id),
          context.env.ASTERA_DB.prepare(
            `INSERT INTO job_events (id, job_id, from_state, to_state, correlation_id, metadata, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
          ).bind(crypto.randomUUID(), job.id, job.state, nextState, correlationId, JSON.stringify({ runtime_job_id: runtime.runtime_job_id }), now),
        ]);
        job = { ...job, state: nextState, updated_at: now };
      }
    }

    return Response.json({ job: publicJob(job) }, {
      headers: { 'Cache-Control': 'no-store', 'X-Correlation-ID': correlationId },
    });
  } catch (error) {
    return functionErrorResponse(error, correlationId);
  }
}

export function onRequest(context: PagesContext): Promise<Response> {
  if (context.request.method !== 'GET') {
    return Promise.resolve(Response.json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'GETのみ対応しています。' } }, { status: 405 }));
  }
  return onRequestGet(context);
}
