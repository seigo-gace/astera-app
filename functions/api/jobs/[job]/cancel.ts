import {
  FunctionHttpError,
  functionErrorResponse,
  requestCorrelationId,
  requireAsteraActor,
  type AsteraFunctionEnv,
} from '../../../_account-projection';
import {
  publicJob,
  releaseFailedJob,
  type JobRow,
} from '../../../_job-settlement';
import {
  cancelRuntimeJob,
  type RuntimeEnv,
} from '../../../_runtime';

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
  if (job.user_id !== userId) throw new FunctionHttpError(403, 'JOB_OWNERSHIP_MISMATCH', '別UserのJobは操作できません。');
  return job;
}

export async function onRequestPost(context: PagesContext): Promise<Response> {
  const correlationId = requestCorrelationId(context.request);
  try {
    const actor = await requireAsteraActor(context.request, context.env);
    const jobId = context.params.job?.trim();
    if (!jobId) throw new FunctionHttpError(400, 'JOB_ID_REQUIRED', 'Job IDが必要です。');
    let job = await loadJob(context, actor.profile.tenant_id, actor.user.id, jobId);

    if (['completed', 'partially_completed', 'failed', 'cancelled'].includes(job.state)) {
      return Response.json({ job: publicJob(job), terminal: true }, {
        headers: { 'Cache-Control': 'no-store', 'X-Correlation-ID': correlationId },
      });
    }

    if (!job.runtime_job_id) {
      job = await releaseFailedJob(context.env, job, 'cancelled', 'JOB_CANCELLED_BEFORE_RUNTIME', 'Runtime開始前に取消しました。', correlationId);
      return Response.json({ job: publicJob(job) }, { headers: { 'Cache-Control': 'no-store', 'X-Correlation-ID': correlationId } });
    }

    if (job.state !== 'cancel_requested') {
      const now = new Date().toISOString();
      await context.env.ASTERA_DB.batch([
        context.env.ASTERA_DB.prepare(
          `UPDATE app_jobs SET state = 'cancel_requested', updated_at = ?1 WHERE id = ?2`,
        ).bind(now, job.id),
        context.env.ASTERA_DB.prepare(
          `INSERT INTO job_events (id, job_id, from_state, to_state, correlation_id, metadata, created_at)
           VALUES (?1, ?2, ?3, 'cancel_requested', ?4, '{}', ?5)`,
        ).bind(crypto.randomUUID(), job.id, job.state, correlationId, now),
      ]);
      job = { ...job, state: 'cancel_requested', updated_at: now };
    }

    const runtime = await cancelRuntimeJob(context.env, job.runtime_job_id, correlationId);
    if (runtime.state === 'cancelled') {
      job = await releaseFailedJob(context.env, job, 'cancelled', 'JOB_CANCELLED_BY_USER', '利用者の操作でJobを取り消しました。', correlationId);
    } else if (runtime.state === 'failed') {
      job = await releaseFailedJob(
        context.env,
        job,
        'failed',
        runtime.error?.code || 'ASTERA_RUNTIME_CANCEL_FAILED',
        runtime.error?.message || 'Runtimeが取消処理に失敗しました。',
        correlationId,
      );
    }

    return Response.json({ job: publicJob(job), runtime_state: runtime.state }, {
      headers: { 'Cache-Control': 'no-store', 'X-Correlation-ID': correlationId },
    });
  } catch (error) {
    return functionErrorResponse(error, correlationId);
  }
}

export function onRequest(context: PagesContext): Promise<Response> {
  if (context.request.method !== 'POST') {
    return Promise.resolve(Response.json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'POSTのみ対応しています。' } }, { status: 405 }));
  }
  return onRequestPost(context);
}
