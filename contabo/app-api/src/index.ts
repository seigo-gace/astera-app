import { Hono } from 'hono';
import { constantTimeTokenEqual, type RuntimeConfig } from './config.js';
import { RuntimeDatabase, type RuntimeJobRow } from './database.js';
import { translateAsteraResult } from './translation-runtime.js';
import { VaultClient } from './vault-client.js';

const PURPOSES = ['auto', 'review', 'compare', 'verify', 'improve', 'research', 'plan', 'consider'] as const;
const OPTIONS = ['translation', 'agent-mode', 'document', 'external-storage-transfer'] as const;
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

type Purpose = (typeof PURPOSES)[number];
type OptionKey = (typeof OPTIONS)[number];

type RuntimeFile = {
  upload_id: string;
  storage_key: string;
  name: string;
  content_type: string;
  size_bytes: number;
  sha256: string;
  private_mode: boolean;
};

export type RuntimeCreateRequest = {
  job_id: string;
  tenant_id: string;
  user_id: string;
  request_id: string;
  prompt: string;
  purpose: Purpose;
  options: Array<{ key: OptionKey; config: Record<string, string> }>;
  files: RuntimeFile[];
  private_mode: boolean;
  project_id: string | null;
  reserved_credits: number;
  policy_version: string;
  correlation_id: string;
};

type ProcessError = Error & { code?: string; retryable?: boolean };

type ProcessResponse = {
  result?: unknown;
  resourceUsage?: Record<string, unknown>;
  resource_usage?: Record<string, unknown>;
  usage?: Record<string, unknown>;
  error?: { code?: string; message?: string; retryable?: boolean };
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function validateCreateRequest(value: unknown): RuntimeCreateRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Object.assign(new Error('Job RequestのJSONを確認できません。'), { code: 'JOB_REQUEST_INVALID' });
  const source = value as Record<string, unknown>;
  const requiredText = (key: string): string => {
    const result = text(source[key]);
    if (!result) throw Object.assign(new Error(`${key}が必要です。`), { code: `${key.toUpperCase()}_REQUIRED` });
    return result;
  };
  const purpose = text(source.purpose) as Purpose;
  if (!PURPOSES.includes(purpose)) throw Object.assign(new Error('Purposeは8種から一つだけ指定してください。'), { code: 'PURPOSE_INVALID' });
  const prompt = text(source.prompt);
  if (!prompt) throw Object.assign(new Error('Promptがありません。'), { code: 'PROMPT_REQUIRED' });
  if ([...prompt].length > 200_000) throw Object.assign(new Error('Promptは200,000文字以内です。'), { code: 'PROMPT_TOO_LARGE' });
  const privateMode = source.private_mode === true;
  const options = Array.isArray(source.options) ? source.options.map((item) => {
    const option = record(item);
    const key = text(option.key) as OptionKey;
    if (!OPTIONS.includes(key)) throw Object.assign(new Error(`未対応Optionです: ${key || 'unknown'}`), { code: 'EXECUTION_OPTION_UNSUPPORTED' });
    const config = record(option.config);
    const normalizedConfig = Object.fromEntries(Object.entries(config).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
    return { key, config: normalizedConfig };
  }) : [];
  if (new Set(options.map((option) => option.key)).size !== options.length) throw Object.assign(new Error('Optionが重複しています。'), { code: 'EXECUTION_OPTION_DUPLICATED' });
  if (privateMode && options.some((option) => option.key === 'external-storage-transfer')) throw Object.assign(new Error('Private Modeでは外部Storage転送を実行できません。'), { code: 'PRIVATE_MODE_TRANSFER_FORBIDDEN' });
  const files = Array.isArray(source.files) ? source.files.map((item) => {
    const file = record(item);
    const normalized: RuntimeFile = {
      upload_id: text(file.upload_id),
      storage_key: text(file.storage_key),
      name: text(file.name),
      content_type: text(file.content_type) || 'application/octet-stream',
      size_bytes: Number(file.size_bytes),
      sha256: text(file.sha256),
      private_mode: file.private_mode === true,
    };
    if (!normalized.upload_id || !normalized.storage_key || !normalized.name || !normalized.sha256 || !Number.isSafeInteger(normalized.size_bytes) || normalized.size_bytes < 0) {
      throw Object.assign(new Error('File参照が不完全です。'), { code: 'FILE_REFERENCE_INVALID' });
    }
    if (normalized.private_mode !== privateMode) throw Object.assign(new Error('FileとJobのPrivate Modeが一致しません。'), { code: 'FILE_PRIVACY_MODE_MISMATCH' });
    return normalized;
  }) : [];
  const reservedCredits = Number(source.reserved_credits);
  if (!Number.isSafeInteger(reservedCredits) || reservedCredits <= 0) throw Object.assign(new Error('reserved_creditsが不正です。'), { code: 'RESERVED_CREDITS_INVALID' });
  return {
    job_id: requiredText('job_id'),
    tenant_id: requiredText('tenant_id'),
    user_id: requiredText('user_id'),
    request_id: requiredText('request_id'),
    prompt,
    purpose,
    options,
    files,
    private_mode: privateMode,
    project_id: text(source.project_id) || null,
    reserved_credits: reservedCredits,
    policy_version: requiredText('policy_version'),
    correlation_id: requiredText('correlation_id'),
  };
}

function sectionBody(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.map(String).join('\n').trim();
  const source = record(value);
  for (const key of ['body', 'content', 'text']) {
    if (typeof source[key] === 'string' && source[key].trim()) return source[key].trim();
  }
  return '';
}

function validateResult(payload: unknown): { result: unknown; partial: boolean } {
  const root = record(payload);
  const result = record(root.result ?? root.data ?? root);
  const rawSections = result.sections;
  const found = new Map<string, string>();
  if (Array.isArray(rawSections)) {
    for (const item of rawSections) {
      const section = record(item);
      const key = text(section.key);
      const body = sectionBody(section);
      if (RESULT_KEYS.includes(key as (typeof RESULT_KEYS)[number]) && body && !found.has(key)) found.set(key, body);
    }
  } else {
    const sections = record(rawSections);
    for (const key of RESULT_KEYS) {
      const body = sectionBody(sections[key] ?? result[key]);
      if (body) found.set(key, body);
    }
  }
  if (found.size !== RESULT_KEYS.length) {
    throw Object.assign(new Error(`固定8項目Resultが不足しています。受信: ${found.size}`), {
      code: 'ASTERA_RESPONSE_SECTIONS_INCOMPLETE',
      retryable: false,
    });
  }
  const completion = text(result.completion_state ?? result.completionState) || 'complete';
  if (!['complete', 'partial'].includes(completion)) {
    throw Object.assign(new Error('Completion Stateが不正です。'), { code: 'ASTERA_COMPLETION_STATE_INVALID', retryable: false });
  }
  return { result: payload, partial: completion === 'partial' };
}

function publicJob(job: RuntimeJobRow): Record<string, unknown> {
  return {
    runtime_job_id: job.id,
    job_id: job.id,
    id: job.id,
    state: job.state,
    status: job.state,
    result: job.result_json,
    usage: job.usage_json,
    error: job.error_code ? { code: job.error_code, message: job.error_message, retryable: job.retryable } : null,
    created_at: job.created_at.toISOString(),
    updated_at: job.updated_at.toISOString(),
    started_at: job.started_at?.toISOString() ?? null,
    completed_at: job.completed_at?.toISOString() ?? null,
    cancelled_at: job.cancelled_at?.toISOString() ?? null,
  };
}

export class AsteraRuntimeService {
  readonly database: RuntimeDatabase;
  readonly config: RuntimeConfig;
  readonly active = new Map<string, AbortController>();
  readonly vault: VaultClient;

  constructor(config: RuntimeConfig, database = new RuntimeDatabase(config.databaseUrl), vault = new VaultClient(config)) {
    this.config = config;
    this.database = database;
    this.vault = vault;
  }

  private async processRequest(input: RuntimeCreateRequest, signal: AbortSignal): Promise<ProcessResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort('process_timeout'), this.config.processTimeoutMs);
    const abort = () => controller.abort(signal.reason || 'cancelled');
    signal.addEventListener('abort', abort, { once: true });
    try {
      const response = await fetch(`${this.config.processOrigin}/process`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.processToken}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'Idempotency-Key': input.job_id,
          'X-Request-ID': input.request_id,
          'X-Correlation-ID': input.correlation_id,
        },
        body: JSON.stringify({
          actor: {
            user_id: input.user_id,
            tenant_id: input.tenant_id,
            account_status: 'active',
            auth_stage: 'authenticated',
          },
          job: {
            job_id: input.job_id,
            request_id: input.request_id,
            prompt: input.prompt,
            purpose: input.purpose,
            options: input.options,
            files: input.files,
            private_mode: input.private_mode,
            project_id: input.project_id,
            policy_version: input.policy_version,
          },
        }),
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => null) as ProcessResponse | null;
      if (!response.ok) {
        const runtimeError = payload?.error;
        throw Object.assign(new Error(runtimeError?.message || `Astera Process APIに失敗しました (${response.status})`), {
          code: runtimeError?.code || `ASTERA_PROCESS_HTTP_${response.status}`,
          retryable: runtimeError?.retryable ?? response.status >= 500,
        });
      }
      if (!payload) throw Object.assign(new Error('Astera Process ResponseがJSONではありません。'), { code: 'ASTERA_PROCESS_RESPONSE_INVALID', retryable: true });
      return payload;
    } catch (error) {
      if (controller.signal.aborted) {
        const cancelled = signal.aborted && signal.reason !== 'process_timeout';
        throw Object.assign(new Error(cancelled ? 'Jobを取り消しました。' : 'Astera Processの応答期限を超えました。'), {
          code: cancelled ? 'JOB_CANCELLED' : 'ASTERA_PROCESS_TIMEOUT',
          retryable: !cancelled,
        });
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
    }
  }

  async execute(input: RuntimeCreateRequest): Promise<void> {
    if (this.active.has(input.job_id)) return;
    const controller = new AbortController();
    this.active.set(input.job_id, controller);
    try {
      const current = await this.database.transition(
        input.job_id,
        ['queued', 'running', 'assembling_result'],
        'running',
        input.correlation_id,
        { resumed: false },
      );
      if (!current || ['completed', 'partially_completed', 'failed', 'cancelled'].includes(current.state)) return;
      if (current.state === 'cancel_requested') {
        await this.database.finish(input.job_id, { state: 'cancelled', errorCode: 'JOB_CANCELLED', errorMessage: '実行前に取り消しました。' }, input.correlation_id);
        return;
      }
      const response = await this.processRequest(input, controller.signal);
      let resultPayload = response.result ?? response;
      const usage: Record<string, unknown> = { ...record(response.resourceUsage ?? response.resource_usage ?? response.usage) };
      const translation = input.options.find((option) => option.key === 'translation');
      if (translation) {
        const targetLanguage = text(translation.config.targetLanguage);
        const translated = await translateAsteraResult(resultPayload, targetLanguage, this.vault, {
          modelId: this.config.translationModelId,
          apiKeyRef: this.config.translationGeminiKeyRef,
          timeoutMs: this.config.translationTimeoutMs,
        });
        resultPayload = translated.result;
        usage.translation = translated.usage;
      }
      const checked = validateResult(resultPayload);
      await this.database.transition(input.job_id, ['running'], 'assembling_result', input.correlation_id);
      await this.database.finish(input.job_id, {
        state: checked.partial ? 'partially_completed' : 'completed',
        result: checked.result,
        usage,
      }, input.correlation_id);
    } catch (caught) {
      const error = caught as ProcessError;
      const code = error.code || 'ASTERA_RUNTIME_EXECUTION_FAILED';
      const cancelled = code === 'JOB_CANCELLED' || controller.signal.aborted;
      await this.database.finish(input.job_id, {
        state: cancelled ? 'cancelled' : 'failed',
        errorCode: code,
        errorMessage: error.message || 'Astera Runtime Executionに失敗しました。',
        retryable: error.retryable === true,
      }, input.correlation_id).catch(() => undefined);
    } finally {
      this.active.delete(input.job_id);
      input.prompt = '';
      input.files.length = 0;
      input.options.length = 0;
    }
  }

  async recover(): Promise<void> {
    const jobs = await this.database.recoverable();
    for (const job of jobs) {
      if (job.private_mode) {
        await this.database.finish(job.id, {
          state: 'failed',
          errorCode: 'PRIVATE_JOB_CONTEXT_LOST',
          errorMessage: 'Server再起動によりPrivate ModeのMemory Contextを保持できませんでした。CreditはApp側でReleaseされます。',
          retryable: false,
        }, job.correlation_id);
        continue;
      }
      if (!job.request_ciphertext || !job.request_iv) {
        await this.database.finish(job.id, {
          state: 'failed',
          errorCode: 'RUNTIME_JOB_PAYLOAD_MISSING',
          errorMessage: '再開用の暗号化Payloadがありません。',
          retryable: false,
        }, job.correlation_id);
        continue;
      }
      if (job.state === 'cancel_requested') {
        await this.database.finish(job.id, {
          state: 'cancelled',
          errorCode: 'JOB_CANCELLED_DURING_RECOVERY',
          errorMessage: '再起動時に取消Requestを確定しました。',
        }, job.correlation_id);
        continue;
      }
      try {
        const input = await this.vault.unsealJson<RuntimeCreateRequest>({ ciphertext: job.request_ciphertext, iv: job.request_iv });
        void this.execute(input);
      } catch (error) {
        await this.database.finish(job.id, {
          state: 'failed',
          errorCode: 'RUNTIME_JOB_DECRYPTION_FAILED',
          errorMessage: error instanceof Error ? error.message : '暗号化Job Payloadを復元できません。',
          retryable: false,
        }, job.correlation_id);
      }
    }
  }

  async cancel(jobId: string, correlationId: string): Promise<RuntimeJobRow> {
    const job = await this.database.get(jobId);
    if (!job) throw Object.assign(new Error('Runtime Jobが見つかりません。'), { code: 'RUNTIME_JOB_NOT_FOUND' });
    if (['completed', 'partially_completed', 'failed', 'cancelled'].includes(job.state)) return job;
    const updated = await this.database.transition(jobId, ['queued', 'running', 'assembling_result'], 'cancel_requested', correlationId);
    this.active.get(jobId)?.abort('user_cancelled');
    if (!this.active.has(jobId)) {
      return this.database.finish(jobId, {
        state: 'cancelled',
        errorCode: 'JOB_CANCELLED',
        errorMessage: 'Jobを取り消しました。',
      }, correlationId);
    }
    return updated ?? job;
  }
}

function bearerToken(value: string | undefined): string {
  if (!value?.startsWith('Bearer ')) return '';
  return value.slice('Bearer '.length).trim();
}

function httpStatus(error: unknown): number {
  const code = typeof (error as ProcessError)?.code === 'string' ? (error as ProcessError).code as string : '';
  if (code.endsWith('_REQUIRED') || code.includes('INVALID') || code.includes('DUPLICATED') || code.includes('UNSUPPORTED')) return 422;
  if (code === 'RUNTIME_JOB_NOT_FOUND') return 404;
  if (code.includes('OWNERSHIP') || code.includes('TOKEN')) return 403;
  return 500;
}

export function createApp(config: RuntimeConfig, service = new AsteraRuntimeService(config)) {
  const app = new Hono();

  app.get('/health', (context) => context.json({ status: 'ok', service: 'astera-app-api' }));
  app.get('/ready', async (context) => {
    try {
      await service.database.ready();
      await service.vault.health();
      return context.json({ status: 'ready', database: true, vault: true, process_origin: new URL(config.processOrigin).origin });
    } catch (error) {
      return context.json({ status: 'not_ready', database: false, vault: false, error: error instanceof Error ? error.message : String(error) }, 503);
    }
  });

  app.use('/internal/*', async (context, next) => {
    const token = bearerToken(context.req.header('authorization'));
    if (!token || !constantTimeTokenEqual(token, config.internalServiceToken)) {
      return context.json({ error: { code: 'INTERNAL_AUTHENTICATION_FAILED', message: 'Internal Service Tokenを確認できません。' } }, 401);
    }
    await next();
  });

  app.post('/internal/v1/jobs', async (context) => {
    try {
      const input = validateCreateRequest(await context.req.json().catch(() => null));
      const encrypted = input.private_mode ? null : await service.vault.sealJson(input);
      const { job, created } = await service.database.insertOrGet({
        id: input.job_id,
        tenantId: input.tenant_id,
        userId: input.user_id,
        requestId: input.request_id,
        purpose: input.purpose,
        privateMode: input.private_mode,
        projectId: input.project_id,
        policyVersion: input.policy_version,
        reservedCredits: input.reserved_credits,
        requestCiphertext: encrypted?.ciphertext ?? null,
        requestIv: encrypted?.iv ?? null,
        correlationId: input.correlation_id,
      });
      if (created || (!service.active.has(job.id) && ['queued', 'running'].includes(job.state))) void service.execute(input);
      return context.json({ job: publicJob(job), created }, created ? 201 : 200);
    } catch (error) {
      const status = httpStatus(error);
      return context.json({ error: { code: (error as ProcessError).code || 'RUNTIME_JOB_CREATE_FAILED', message: error instanceof Error ? error.message : 'Runtime Jobを作成できません。', retryable: status >= 500 } }, status as 400 | 401 | 403 | 404 | 422 | 500);
    }
  });

  app.get('/internal/v1/jobs/:job', async (context) => {
    const job = await service.database.get(context.req.param('job'));
    if (!job) return context.json({ error: { code: 'RUNTIME_JOB_NOT_FOUND', message: 'Runtime Jobが見つかりません。' } }, 404);
    return context.json({ job: publicJob(job) });
  });

  app.post('/internal/v1/jobs/:job/cancel', async (context) => {
    try {
      const correlationId = context.req.header('x-correlation-id')?.trim() || crypto.randomUUID();
      const job = await service.cancel(context.req.param('job'), correlationId);
      return context.json({ job: publicJob(job) });
    } catch (error) {
      return context.json({ error: { code: (error as ProcessError).code || 'RUNTIME_JOB_CANCEL_FAILED', message: error instanceof Error ? error.message : 'Runtime Jobを取り消せません。' } }, httpStatus(error) as 404 | 500);
    }
  });

  app.notFound((context) => context.json({ error: { code: 'ROUTE_NOT_FOUND', message: 'Routeが定義されていません。' } }, 404));
  app.onError((error, context) => context.json({ error: { code: 'INTERNAL_SERVER_ERROR', message: error.message } }, 500));
  return { app, service };
}

export const contaboAppApiReadiness = {
  status: 'runtime_source_implemented',
  deployed: false,
  postgresMigrationApplied: false,
  vaultAdapterSourceIntegrated: true,
  vaultConnected: false,
  privateDataBrokerVerified: false,
  deterministicJapaneseMcpConnected: false,
} as const;
