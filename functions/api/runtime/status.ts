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

type RuntimeHealthProbe = SafeFetchError & {
  http_status: number;
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

async function runtimeHealth(origin: string | undefined): Promise<RuntimeHealthProbe> {
  if (!configured(origin)) {
    return {
      http_status: 0,
      error_class: 'OriginNotConfigured',
      error_message: null,
      cause_class: null,
      cause_code: null,
    };
  }

  try {
    const url = new URL('/health', origin!.trim());
    if (url.protocol !== 'https:') {
      return {
        http_status: 0,
        error_class: 'HttpsRequired',
        error_message: null,
        cause_class: null,
        cause_code: null,
      };
    }

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

export async function onRequestGet(context: PagesContext): Promise<Response> {
  const originConfigured = configured(context.env.ASTERA_RUNTIME_ORIGIN);
  const tokenConfigured = configured(context.env.ASTERA_RUNTIME_SERVICE_TOKEN);
  const health = await runtimeHealth(context.env.ASTERA_RUNTIME_ORIGIN);
  const ready = originConfigured && tokenConfigured && health.http_status === 200;

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
