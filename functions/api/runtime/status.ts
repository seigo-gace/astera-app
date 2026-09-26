import type { AsteraFunctionEnv } from '../../_account-projection';
import type { RuntimeEnv } from '../../_runtime';

type Env = AsteraFunctionEnv & RuntimeEnv;
type PagesContext = { request: Request; env: Env };

type SafeFetchError = {
  error_class: string | null;
  error_message: string | null;
  cause_class: string | null;
  cause_code: string | null;
};

type RuntimeProbe = SafeFetchError & {
  http_status: number;
};

type RuntimeAuthProbe = RuntimeProbe & {
  authenticated: boolean;
  response_code: string | null;
};

function configured(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function safeErrorMessage(value: unknown, origin: string | undefined): string | null {
  if (typeof value !== 'string') return null;
  let message = value.trim();
  if (!message) return null;

  const rawOrigin = origin?.trim();
  if (rawOrigin) {
    message = message.split(rawOrigin).join('[runtime-origin]');
  }

  message = message.replace(/https?:\/\/[^\s"']+/gi, '[url]');
  return message.slice(0, 240);
}

function errorClass(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const name = (value as { name?: unknown }).name;
  return typeof name === 'string' && name.trim() ? name.trim().slice(0, 80) : null;
}

function causeCode(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const code = (value as { code?: unknown }).code;
  if (typeof code === 'string' && code.trim()) return code.trim().slice(0, 80);
  if (typeof code === 'number' && Number.isFinite(code)) return String(code);
  return null;
}

function classifyFetchError(error: unknown, origin: string | undefined): SafeFetchError {
  const cause = error && typeof error === 'object' ? (error as { cause?: unknown }).cause : undefined;
  const rawMessage = error && typeof error === 'object' ? (error as { message?: unknown }).message : undefined;

  return {
    error_class: errorClass(error) ?? (typeof error === 'string' ? 'StringThrown' : 'UnknownThrown'),
    error_message: safeErrorMessage(rawMessage ?? (typeof error === 'string' ? error : null), origin),
    cause_class: errorClass(cause),
    cause_code: causeCode(cause),
  };
}

function zeroProbe(errorClassValue: string): RuntimeProbe {
  return {
    http_status: 0,
    error_class: errorClassValue,
    error_message: null,
    cause_class: null,
    cause_code: null,
  };
}

function runtimeHttpsUrl(origin: string | undefined, path: string): URL | null {
  if (!configured(origin)) return null;
  const url = new URL(path, origin!.trim());
  return url.protocol === 'https:' ? url : null;
}

async function runtimeHealth(origin: string | undefined): Promise<RuntimeProbe> {
  if (!configured(origin)) return zeroProbe('OriginNotConfigured');

  try {
    const url = runtimeHttpsUrl(origin, '/health');
    if (!url) return zeroProbe('HttpsRequired');

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      redirect: 'manual',
    });

    return {
      http_status: response.status,
      error_class: null,
      error_message: null,
      cause_class: null,
      cause_code: null,
    };
  } catch (error) {
    return {
      http_status: 0,
      ...classifyFetchError(error, origin),
    };
  }
}

async function runtimeAuth(
  origin: string | undefined,
  token: string | undefined,
): Promise<RuntimeAuthProbe> {
  if (!configured(origin)) return { ...zeroProbe('OriginNotConfigured'), authenticated: false, response_code: null };
  if (!configured(token)) return { ...zeroProbe('TokenNotConfigured'), authenticated: false, response_code: null };

  const sentinelId = `astera-status-${crypto.randomUUID()}`;
  try {
    const url = runtimeHttpsUrl(origin, `/internal/v1/jobs/${encodeURIComponent(sentinelId)}`);
    if (!url) return { ...zeroProbe('HttpsRequired'), authenticated: false, response_code: null };

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token!.trim()}`,
        Accept: 'application/json',
        'X-Correlation-ID': 'astera-runtime-status-probe',
      },
      redirect: 'manual',
    });
    const payload: unknown = await response.json().catch(() => null);
    const root = payload && typeof payload === 'object' && !Array.isArray(payload)
      ? payload as Record<string, unknown>
      : {};
    const rootError = root.error && typeof root.error === 'object' && !Array.isArray(root.error)
      ? root.error as Record<string, unknown>
      : {};
    const job = root.job && typeof root.job === 'object' && !Array.isArray(root.job)
      ? root.job as Record<string, unknown>
      : {};
    const jobError = job.error && typeof job.error === 'object' && !Array.isArray(job.error)
      ? job.error as Record<string, unknown>
      : {};
    const responseCode = typeof rootError.code === 'string'
      ? rootError.code.slice(0, 80)
      : typeof jobError.code === 'string'
        ? jobError.code.slice(0, 80)
        : null;
    const jobMatchesSentinel = [job.runtime_job_id, job.job_id, job.id].some((value) => value === sentinelId);
    const authenticated =
      (response.status === 404 && responseCode === 'RUNTIME_JOB_NOT_FOUND') ||
      (response.status === 200 && jobMatchesSentinel && responseCode === 'RUNTIME_STATE_LOST_AFTER_RESTART');

    return {
      http_status: response.status,
      authenticated,
      response_code: responseCode,
      error_class: null,
      error_message: null,
      cause_class: null,
      cause_code: null,
    };
  } catch (error) {
    return {
      http_status: 0,
      authenticated: false,
      response_code: null,
      ...classifyFetchError(error, origin),
    };
  }
}

export async function onRequestGet(context: PagesContext): Promise<Response> {
  const originConfigured = configured(context.env.ASTERA_RUNTIME_ORIGIN);
  const tokenConfigured = configured(context.env.ASTERA_RUNTIME_SERVICE_TOKEN);
  const [health, auth] = await Promise.all([
    runtimeHealth(context.env.ASTERA_RUNTIME_ORIGIN),
    runtimeAuth(context.env.ASTERA_RUNTIME_ORIGIN, context.env.ASTERA_RUNTIME_SERVICE_TOKEN),
  ]);
  const ready = originConfigured && tokenConfigured && health.http_status === 200 && auth.authenticated;

  return Response.json(
    {
      status: ready ? 'operational' : 'degraded',
      runtime_origin_configured: originConfigured,
      runtime_service_token_configured: tokenConfigured,
      runtime_health_http: health.http_status,
      runtime_health_error_class: health.error_class,
      runtime_health_error_message: health.error_message,
      runtime_health_cause_class: health.cause_class,
      runtime_health_cause_code: health.cause_code,
      runtime_auth_http: auth.http_status,
      runtime_auth_authenticated: auth.authenticated,
      runtime_auth_response_code: auth.response_code,
      runtime_auth_error_class: auth.error_class,
      runtime_auth_error_message: auth.error_message,
      runtime_auth_cause_class: auth.cause_class,
      runtime_auth_cause_code: auth.cause_code,
    },
    {
      status: ready ? 200 : 503,
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    },
  );
}

export function onRequest(context: PagesContext): Promise<Response> {
  if (context.request.method !== 'GET') {
    return Promise.resolve(
      Response.json(
        { error: { code: 'METHOD_NOT_ALLOWED', message: 'GETのみ対応しています。' } },
        { status: 405, headers: { 'Cache-Control': 'no-store' } },
      ),
    );
  }
  return onRequestGet(context);
}
