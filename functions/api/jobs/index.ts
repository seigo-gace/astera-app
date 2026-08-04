import {
  FunctionHttpError,
  functionErrorResponse,
  requestCorrelationId,
  requireAsteraActor,
  type AsteraFunctionEnv,
} from '../../_account-projection';
import {
  loadActiveCreditPolicy,
  normalizeEstimateInput,
  requestFingerprint,
} from '../../_job-policy';
import {
  publicJob,
  releaseFailedJob,
  settleCompletedJob,
  type JobRow,
} from '../../_job-settlement';
import {
  createRuntimeJob,
  type RuntimeEnv,
} from '../../_runtime';

type Env = AsteraFunctionEnv & RuntimeEnv;
type PagesContext = { request: Request; env: Env };

type EstimateRow = {
  id: string;
  tenant_id: string;
  user_id: string;
  request_fingerprint: string;
  policy_version: string;
  required_credits: number;
  available_credits_snapshot: number;
  reserved_credits_snapshot: number;
  credit_account_version: number;
  credit_state: string;
  status: string;
  expires_at: string;
};

type UploadRow = {
  id: string;
  storage_key: string;
  original_name: string;
  content_type: string;
  size_bytes: number;
  sha256: string;
  private_mode: number;
  status: string;
  expires_at: string | null;
};

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

async function loadFiles(
  context: PagesContext,
  tenantId: string,
  userId: string,
  fileIds: string[],
  privateMode: boolean,
): Promise<UploadRow[]> {
  if (fileIds.length === 0) return [];
  const placeholders = fileIds.map((_, index) => `?${index + 3}`).join(', ');
  const result = await context.env.ASTERA_DB.prepare(
    `SELECT id, storage_key, original_name, content_type, size_bytes, sha256, private_mode, status, expires_at
     FROM upload_objects
     WHERE tenant_id = ?1 AND user_id = ?2 AND id IN (${placeholders})`,
  ).bind(tenantId, userId, ...fileIds).all<UploadRow>();
  const rows = result.results ?? [];
  if (rows.length !== fileIds.length) throw new FunctionHttpError(409, 'UPLOAD_REFERENCE_NOT_FOUND', '指定されたFileの一部を確認できません。');
  const byId = new Map(rows.map((row) => [row.id, row]));
  const ordered = fileIds.map((id) => byId.get(id)).filter((row): row is UploadRow => Boolean(row));
  const now = Date.now();
  for (const row of ordered) {
    if (row.status !== 'ready') throw new FunctionHttpError(409, 'UPLOAD_NOT_READY', 'File UploadがReady状態ではありません。', { upload_id: row.id });
    if (row.expires_at && Date.parse(row.expires_at) <= now) throw new FunctionHttpError(409, 'UPLOAD_EXPIRED', 'Private Fileの有効期限が切れています。', { upload_id: row.id });
    if (Boolean(row.private_mode) !== privateMode) throw new FunctionHttpError(409, 'UPLOAD_PRIVACY_MODE_MISMATCH', 'Fileの保存ModeとPrivate Modeが一致しません。', { upload_id: row.id });
  }
  return ordered;
}

async function existingJob(context: PagesContext, tenantId: string, requestId: string): Promise<JobRow | null> {
  return context.env.ASTERA_DB.prepare(
    `SELECT id, tenant_id, user_id, request_id, estimate_id, request_fingerprint, state, purpose,
            option_summary, file_count, private_mode, project_id, runtime_job_id, reserved_credits,
            committed_credits, result_schema_version, result_payload, error_code, error_message,
            created_at, updated_at, completed_at, cancelled_at
     FROM app_jobs WHERE tenant_id = ?1 AND request_id = ?2 LIMIT 1`,
  ).bind(tenantId, requestId).first<JobRow>();
}

export async function onRequestPost(context: PagesContext): Promise<Response> {
  const correlationId = requestCorrelationId(context.request);
  let reservedJob: JobRow | null = null;
  try {
    const actor = await requireAsteraActor(context.request, context.env);
    const raw = await context.request.json().catch(() => null);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new FunctionHttpError(400, 'JOB_REQUEST_INVALID', 'Job RequestのJSONを確認できません。');
    const source = raw as Record<string, unknown>;
    const requestId = text(source.request_id ?? source.requestId);
    const estimateId = text(source.estimate_id ?? source.estimateId);
    if (!requestId) throw new FunctionHttpError(400, 'REQUEST_ID_REQUIRED', 'request_idが必要です。');
    if (!estimateId) throw new FunctionHttpError(400, 'ESTIMATE_ID_REQUIRED', 'estimate_idが必要です。');
    if (requestId.length > 192) throw new FunctionHttpError(400, 'REQUEST_ID_TOO_LONG', 'request_idは192文字以内です。');

    const duplicate = await existingJob(context, actor.profile.tenant_id, requestId);
    if (duplicate) {
      if (duplicate.user_id !== actor.user.id) throw new FunctionHttpError(409, 'REQUEST_ID_OWNERSHIP_MISMATCH', '同じrequest_idが別Userで使用されています。');
      return Response.json({ job: publicJob(duplicate), reused: true }, {
        headers: { 'Cache-Control': 'no-store', 'X-Correlation-ID': correlationId },
      });
    }

    const input = normalizeEstimateInput(raw);
    const [estimate, policy, files] = await Promise.all([
      context.env.ASTERA_DB.prepare(
        `SELECT id, tenant_id, user_id, request_fingerprint, policy_version, required_credits,
                available_credits_snapshot, reserved_credits_snapshot, credit_account_version,
                credit_state, status, expires_at
         FROM job_estimates WHERE id = ?1 LIMIT 1`,
      ).bind(estimateId).first<EstimateRow>(),
      loadActiveCreditPolicy(context.env.ASTERA_DB),
      loadFiles(context, actor.profile.tenant_id, actor.user.id, input.fileIds, input.privateMode),
    ]);
    if (!estimate) throw new FunctionHttpError(404, 'JOB_ESTIMATE_NOT_FOUND', 'Job Estimateが見つかりません。');
    if (estimate.tenant_id !== actor.profile.tenant_id || estimate.user_id !== actor.user.id) throw new FunctionHttpError(403, 'JOB_ESTIMATE_OWNERSHIP_MISMATCH', '別Account／TenantのEstimateは使用できません。');
    if (estimate.status !== 'active') throw new FunctionHttpError(409, 'JOB_ESTIMATE_NOT_ACTIVE', 'Job Estimateは既に使用済みまたは無効です。');
    if (Date.parse(estimate.expires_at) <= Date.now()) {
      await context.env.ASTERA_DB.prepare(`UPDATE job_estimates SET status = 'expired' WHERE id = ?1 AND status = 'active'`).bind(estimate.id).run();
      throw new FunctionHttpError(409, 'JOB_ESTIMATE_EXPIRED', 'Job Estimateの有効期限が切れています。');
    }
    if (estimate.credit_state === 'insufficient') throw new FunctionHttpError(409, 'CREDIT_INSUFFICIENT_FOR_ESTIMATE', 'Credit不足のEstimateは実行できません。');
    if (policy.version !== estimate.policy_version) throw new FunctionHttpError(409, 'CREDIT_POLICY_CHANGED', 'Credit Policyが変更されたため再見積りが必要です。');
    if (Number(actor.credit.version) !== Number(estimate.credit_account_version)) throw new FunctionHttpError(409, 'CREDIT_BALANCE_CHANGED', 'Credit残高が変わったため再見積りが必要です。');

    const fingerprint = await requestFingerprint(input, files.map((row) => `${row.id}:${row.sha256}:${row.size_bytes}`));
    if (fingerprint !== estimate.request_fingerprint) throw new FunctionHttpError(409, 'JOB_ESTIMATE_FINGERPRINT_MISMATCH', '入力条件が見積り時から変更されています。');

    const now = new Date();
    const jobId = crypto.randomUUID();
    const reservationId = crypto.randomUUID();
    const reservationExpiresAt = new Date(now.getTime() + policy.reservationTtlSeconds * 1000).toISOString();
    const optionSummary = JSON.stringify(input.options);
    reservedJob = {
      id: jobId,
      tenant_id: actor.profile.tenant_id,
      user_id: actor.user.id,
      request_id: requestId,
      estimate_id: estimate.id,
      request_fingerprint: fingerprint,
      state: 'reserving_credit',
      purpose: input.purpose,
      option_summary: optionSummary,
      file_count: files.length,
      private_mode: input.privateMode ? 1 : 0,
      project_id: input.projectId,
      runtime_job_id: null,
      reserved_credits: Number(estimate.required_credits),
      committed_credits: null,
      result_schema_version: null,
      result_payload: null,
      error_code: null,
      error_message: null,
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
      completed_at: null,
      cancelled_at: null,
    };

    try {
      await context.env.ASTERA_DB.batch([
        context.env.ASTERA_DB.prepare(
          `INSERT INTO credit_reservations
            (id, credit_account_id, job_id, estimated_amount, committed_amount, status, expires_at, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, NULL, 'reserved', ?5, ?6, ?6)`,
        ).bind(reservationId, actor.credit.id, jobId, Number(estimate.required_credits), reservationExpiresAt, now.toISOString()),
        context.env.ASTERA_DB.prepare(
          `INSERT INTO credit_ledger
            (transaction_id, credit_account_id, kind, amount, idempotency_key,
             reference_type, reference_id, request_fingerprint, created_at)
           VALUES (?1, ?2, 'reserve', ?3, ?4, 'job', ?5, ?6, ?7)`,
        ).bind(`job-reserve:${jobId}`, actor.credit.id, Number(estimate.required_credits), `job:${jobId}:reserve`, jobId, fingerprint, now.toISOString()),
        context.env.ASTERA_DB.prepare(
          `INSERT INTO app_jobs
            (id, tenant_id, user_id, request_id, estimate_id, request_fingerprint, state, purpose,
             option_summary, file_count, private_mode, project_id, runtime_job_id, reserved_credits,
             committed_credits, result_schema_version, result_payload, error_code, error_message,
             created_at, updated_at, completed_at, cancelled_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'reserving_credit', ?7, ?8, ?9, ?10, ?11,
                   NULL, ?12, NULL, NULL, NULL, NULL, NULL, ?13, ?13, NULL, NULL)`,
        ).bind(jobId, actor.profile.tenant_id, actor.user.id, requestId, estimate.id, fingerprint, input.purpose, optionSummary, files.length, input.privateMode ? 1 : 0, input.projectId, Number(estimate.required_credits), now.toISOString()),
        context.env.ASTERA_DB.prepare(
          `UPDATE job_estimates SET status = 'consumed', consumed_at = ?1 WHERE id = ?2 AND status = 'active'`,
        ).bind(now.toISOString(), estimate.id),
        context.env.ASTERA_DB.prepare(
          `INSERT INTO job_events (id, job_id, from_state, to_state, correlation_id, metadata, created_at)
           VALUES (?1, ?2, NULL, 'reserving_credit', ?3, ?4, ?5)`,
        ).bind(crypto.randomUUID(), jobId, correlationId, JSON.stringify({ estimate_id: estimate.id, policy_version: policy.version }), now.toISOString()),
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/CREDIT_INSUFFICIENT_FOR_RESERVATION/i.test(message)) {
        throw new FunctionHttpError(409, 'CREDIT_INSUFFICIENT_FOR_RESERVATION', '実行直前のCredit確保に失敗しました。最新残高で再見積りしてください。');
      }
      if (/UNIQUE constraint failed.*request_id/i.test(message)) {
        const concurrent = await existingJob(context, actor.profile.tenant_id, requestId);
        if (concurrent) return Response.json({ job: publicJob(concurrent), reused: true }, { headers: { 'Cache-Control': 'no-store', 'X-Correlation-ID': correlationId } });
      }
      throw error;
    }

    const runtime = await createRuntimeJob(context.env, {
      job_id: jobId,
      tenant_id: actor.profile.tenant_id,
      user_id: actor.user.id,
      request_id: requestId,
      prompt: input.prompt,
      purpose: input.purpose,
      options: input.options,
      files: files.map((file) => ({
        upload_id: file.id,
        storage_key: file.storage_key,
        name: file.original_name,
        content_type: file.content_type,
        size_bytes: Number(file.size_bytes),
        sha256: file.sha256,
        private_mode: Boolean(file.private_mode),
      })),
      private_mode: input.privateMode,
      project_id: input.projectId,
      reserved_credits: Number(estimate.required_credits),
      policy_version: policy.version,
      correlation_id: correlationId,
    });

    const runtimeState = runtime.state === 'completed'
      ? 'assembling_result'
      : runtime.state === 'partially_completed'
        ? 'assembling_result'
        : runtime.state;
    await context.env.ASTERA_DB.batch([
      context.env.ASTERA_DB.prepare(
        `UPDATE app_jobs SET runtime_job_id = ?1, state = ?2, updated_at = ?3 WHERE id = ?4`,
      ).bind(runtime.runtime_job_id, runtimeState, new Date().toISOString(), jobId),
      context.env.ASTERA_DB.prepare(
        `INSERT INTO job_events (id, job_id, from_state, to_state, correlation_id, metadata, created_at)
         VALUES (?1, ?2, 'reserving_credit', ?3, ?4, ?5, ?6)`,
      ).bind(crypto.randomUUID(), jobId, runtimeState, correlationId, JSON.stringify({ runtime_job_id: runtime.runtime_job_id }), new Date().toISOString()),
    ]);
    reservedJob = { ...reservedJob, runtime_job_id: runtime.runtime_job_id, state: runtimeState, updated_at: new Date().toISOString() };

    if (runtime.state === 'completed' || runtime.state === 'partially_completed') {
      reservedJob = await settleCompletedJob(context.env, reservedJob, runtime, correlationId);
    } else if (runtime.state === 'failed' || runtime.state === 'cancelled') {
      reservedJob = await releaseFailedJob(
        context.env,
        reservedJob,
        runtime.state === 'cancelled' ? 'cancelled' : 'failed',
        runtime.error?.code || `ASTERA_RUNTIME_${runtime.state.toUpperCase()}`,
        runtime.error?.message || `Astera Runtimeが${runtime.state}を返しました。`,
        correlationId,
      );
    }

    return Response.json({ job: publicJob(reservedJob) }, {
      status: 201,
      headers: { 'Cache-Control': 'no-store', 'X-Correlation-ID': correlationId },
    });
  } catch (error) {
    if (reservedJob && !['completed', 'partially_completed', 'failed', 'cancelled'].includes(reservedJob.state)) {
      await releaseFailedJob(
        context.env,
        reservedJob,
        'failed',
        error instanceof FunctionHttpError ? error.code : 'JOB_RUNTIME_DISPATCH_FAILED',
        error instanceof Error ? error.message : 'Job Runtimeへ送信できませんでした。',
        correlationId,
      ).catch(() => undefined);
    }
    return functionErrorResponse(error, correlationId);
  }
}

export function onRequest(context: PagesContext): Promise<Response> {
  if (context.request.method !== 'POST') {
    return Promise.resolve(Response.json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'POSTのみ対応しています。' } }, { status: 405 }));
  }
  return onRequestPost(context);
}
