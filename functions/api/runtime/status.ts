import type { AsteraFunctionEnv } from '../../_account-projection';
import type { RuntimeEnv } from '../../_runtime';

type Env = AsteraFunctionEnv & RuntimeEnv;
type PagesContext = { request: Request; env: Env };

function configured(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

async function runtimeHealth(origin: string | undefined): Promise<number> {
  if (!configured(origin)) return 0;
  try {
    const url = new URL('/health', origin!.trim());
    if (url.protocol !== 'https:') return 0;
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      redirect: 'error',
    });
    return response.status;
  } catch {
    return 0;
  }
}

export async function onRequestGet(context: PagesContext): Promise<Response> {
  const originConfigured = configured(context.env.ASTERA_RUNTIME_ORIGIN);
  const tokenConfigured = configured(context.env.ASTERA_RUNTIME_SERVICE_TOKEN);
  const healthHttp = await runtimeHealth(context.env.ASTERA_RUNTIME_ORIGIN);
  const ready = originConfigured && tokenConfigured && healthHttp === 200;

  return Response.json(
    {
      status: ready ? 'operational' : 'degraded',
      runtime_origin_configured: originConfigured,
      runtime_service_token_configured: tokenConfigured,
      runtime_health_http: healthHttp,
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
