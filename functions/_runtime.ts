import { FunctionHttpError } from './_account-projection';

export type RuntimeEnv = {
  ASTERA_RUNTIME_ORIGIN?: string;
  ASTERA_RUNTIME_SERVICE_TOKEN?: string;
  ASTERA_RUNTIME_TIMEOUT_MS?: string;
};

export type RuntimeJobState =
  | 'queued'
  | 'running'
  | 'assembling_result'
  | 'completed'
  | 'partially_completed'
  | 'failed'
  | 'cancel_requested'
  | 'cancelled';

export type RuntimeJobEnvelope = {
  runtime_job_id: string;
  state: RuntimeJobState;
  result?: unknown;
  usage?: { credits?: number; input_units?: number; output_units?: number; duration_ms?: number };
  error?: { code?: string; message?: string; retryable?: boolean };
};

export type RuntimeCreateJob = {
  job_id: string;
  tenant_id: string;
  user_id: string;
  request_id: string;
  prompt: string;
  purpose: string;
  options: Array<{ key: string; config: Record<string, string> }>;
  files: Array<{
    upload_id: string;
    storage_key: string;
    name: string;
    content_type: string;
    size_bytes: number;
    sha256: string;
    private_mode: boolean;
  }>;
  private_mode: boolean;
  project_id: string | null;
  reserved_credits: number;
  policy_version: string;
  correlation_id: string;
};

function normalizedOrigin(value: string | undefined): URL {
  const raw = value?.trim();
  if (!raw) throw new FunctionHttpError(503, 'ASTERA_RUNTIME_ORIGIN_NOT_CONFIGURED', 'Astera Runtime接続先が設定されていません。');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new FunctionHttpError(503, 'ASTERA_RUNTIME_ORIGIN_INVALID', 'Astera Runtime接続先URLが不正です。');
  }
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
    throw new FunctionHttpError(503, 'ASTERA_RUNTIME_HTTPS_REQUIRED', 'Astera Runtime接続先はHTTPSである必要があります。');
  }
  url.pathname = url.pathname.replace(/\/+$/, '');
  url.search = '';
  url.hash = '';
  return url;
}

function requiredToken(value: string | undefined): string {
  const token = value?.trim();
  if (!token) throw new FunctionHttpError(503, 'ASTERA_RUNTIME_SERVICE_TOKEN_NOT_CONFIGURED', 'Astera Runtime Service Tokenが設定されていません。');
  return token;
}

function timeoutMs(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 20_000;
  return Math.min(120_000, Math.max(3_000, Math.trunc(parsed)));
}

function runtimeUrl(env: RuntimeEnv, path: string): string {
  const origin = normalizedOrigin(env.ASTERA_RUNTIME_ORIGIN);
  return new URL(`${origin.pathname}${path}`, origin.origin).toString();
}

function isRuntimeState(value: string): value is RuntimeJobState {
  return ['queued', 'running', 'assembling_result', 'completed', 'partially_completed', 'failed', 'cancel_requested', 'cancelled'].includes(value);
}

function normalizeRuntimeEnvelope(payload: unknown): RuntimeJobEnvelope {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new FunctionHttpError(502, 'ASTERA_RUNTIME_RESPONSE_INVALID', 'Astera Runtime ResponseがObjectではありません。', payload);
  }
  const root = payload as Record<string, unknown>;
  const job = root.job && typeof root.job === 'object' && !Array.isArray(root.job) ? root.job as Record<string, unknown> : root;
  const runtimeJobId = typeof (job.runtime_job_id ?? job.job_id ?? job.id) === 'string'
    ? String(job.runtime_job_id ?? job.job_id ?? job.id).trim()
    : '';
  const stateValue = typeof (job.state ?? job.status) === 'string' ? String(job.state ?? job.status).trim().toLowerCase() : '';
  if (!runtimeJobId || !isRuntimeState(stateValue)) {
    throw new FunctionHttpError(502, 'ASTERA_RUNTIME_RESPONSE_INCOMPLETE', 'Astera Runtime ResponseにJob IDまたはStateがありません。', payload);
  }
  const errorSource = job.error && typeof job.error === 'object' && !Array.isArray(job.error) ? job.error as Record<string, unknown> : {};
  const usageSource = job.usage && typeof job.usage === 'object' && !Array.isArray(job.usage) ? job.usage as Record<string, unknown> : {};
  return {
    runtime_job_id: runtimeJobId,
    state: stateValue,
    result: job.result ?? root.result,
    usage: {
      credits: Number.isFinite(Number(usageSource.credits)) ? Number(usageSource.credits) : undefined,
      input_units: Number.isFinite(Number(usageSource.input_units ?? usageSource.inputUnits)) ? Number(usageSource.input_units ?? usageSource.inputUnits) : undefined,
      output_units: Number.isFinite(Number(usageSource.output_units ?? usageSource.outputUnits)) ? Number(usageSource.output_units ?? usageSource.outputUnits) : undefined,
      duration_ms: Number.isFinite(Number(usageSource.duration_ms ?? usageSource.durationMs)) ? Number(usageSource.duration_ms ?? usageSource.durationMs) : undefined,
    },
    error: Object.keys(errorSource).length > 0 ? {
      code: typeof errorSource.code === 'string' ? errorSource.code : undefined,
      message: typeof errorSource.message === 'string' ? errorSource.message : undefined,
      retryable: errorSource.retryable === true,
    } : undefined,
  };
}

async function runtimeRequest(
  env: RuntimeEnv,
  path: string,
  init: RequestInit,
  correlationId: string,
): Promise<RuntimeJobEnvelope> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort('runtime_timeout'), timeoutMs(env.ASTERA_RUNTIME_TIMEOUT_MS));
  try {
    const response = await fetch(runtimeUrl(env, path), {
      ...init,
      headers: {
        Authorization: `Bearer ${requiredToken(env.ASTERA_RUNTIME_SERVICE_TOKEN)}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Correlation-ID': correlationId,
        ...(init.headers ?? {}),
      },
      signal: controller.signal,
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const source = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
      const error = source.error && typeof source.error === 'object' && !Array.isArray(source.error) ? source.error as Record<string, unknown> : source;
      throw new FunctionHttpError(
        response.status >= 500 ? 502 : response.status,
        typeof error.code === 'string' ? error.code : `ASTERA_RUNTIME_HTTP_${response.status}`,
        typeof error.message === 'string' ? error.message : `Astera Runtime Requestに失敗しました (${response.status})`,
        payload,
      );
    }
    return normalizeRuntimeEnvelope(payload);
  } catch (error) {
    if (error instanceof FunctionHttpError) throw error;
    if (controller.signal.aborted) throw new FunctionHttpError(504, 'ASTERA_RUNTIME_TIMEOUT', 'Astera Runtimeの応答期限を超えました。');
    throw new FunctionHttpError(502, 'ASTERA_RUNTIME_UNAVAILABLE', 'Astera Runtimeへ接続できません。', error instanceof Error ? error.message : String(error));
  } finally {
    clearTimeout(timeout);
  }
}

export function createRuntimeJob(env: RuntimeEnv, input: RuntimeCreateJob): Promise<RuntimeJobEnvelope> {
  return runtimeRequest(env, '/internal/v1/jobs', {
    method: 'POST',
    headers: { 'Idempotency-Key': input.request_id, 'X-Request-ID': input.request_id },
    body: JSON.stringify(input),
  }, input.correlation_id);
}

export function getRuntimeJob(env: RuntimeEnv, runtimeJobId: string, correlationId: string): Promise<RuntimeJobEnvelope> {
  return runtimeRequest(env, `/internal/v1/jobs/${encodeURIComponent(runtimeJobId)}`, { method: 'GET' }, correlationId);
}

export function cancelRuntimeJob(env: RuntimeEnv, runtimeJobId: string, correlationId: string): Promise<RuntimeJobEnvelope> {
  return runtimeRequest(env, `/internal/v1/jobs/${encodeURIComponent(runtimeJobId)}/cancel`, {
    method: 'POST',
    headers: { 'Idempotency-Key': `cancel:${runtimeJobId}` },
    body: '{}',
  }, correlationId);
}
