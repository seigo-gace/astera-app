import type { AsteraFunctionEnv } from '../../_account-projection';
import type { RuntimeEnv } from '../../_runtime';

type Env = AsteraFunctionEnv & RuntimeEnv;
type PagesContext = { request: Request; env: Env };

function configured(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

export async function onRequestGet(context: PagesContext): Promise<Response> {
  const origin = context.env.ASTERA_RUNTIME_ORIGIN?.trim() ?? '';
  const token = context.env.ASTERA_RUNTIME_SERVICE_TOKEN?.trim() ?? '';
  if (!configured(origin) || !configured(token)) {
    return Response.json({ status: 'blocked', origin_configured: configured(origin), token_configured: configured(token) }, { status: 503 });
  }

  try {
    const url = new URL('/internal/v1/jobs/__astera_status_probe_never_created__', origin);
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'X-Correlation-ID': 'astera-runtime-auth-diagnostic',
      },
      redirect: 'manual',
    });
    const contentType = response.headers.get('content-type') ?? '';
    const location = response.headers.get('location') ?? '';
    const text = await response.text();
    let payload: unknown = null;
    try { payload = JSON.parse(text); } catch {}
    const root = payload && typeof payload === 'object' && !Array.isArray(payload)
      ? payload as Record<string, unknown>
      : {};
    const error = root.error && typeof root.error === 'object' && !Array.isArray(root.error)
      ? root.error as Record<string, unknown>
      : {};
    const job = root.job && typeof root.job === 'object' && !Array.isArray(root.job)
      ? root.job as Record<string, unknown>
      : {};

    return Response.json({
      upstream_http: response.status,
      content_type: contentType.slice(0, 120),
      redirect_location_present: Boolean(location),
      response_is_json_object: Object.keys(root).length > 0,
      top_level_keys: Object.keys(root).sort().slice(0, 20),
      error_keys: Object.keys(error).sort().slice(0, 20),
      error_code: typeof error.code === 'string' ? error.code.slice(0, 80) : null,
      job_keys: Object.keys(job).sort().slice(0, 20),
      job_id_matches_sentinel: [job.runtime_job_id, job.job_id, job.id].some((value) => value === '__astera_status_probe_never_created__'),
      body_length: text.length,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({
      upstream_http: 0,
      error_class: error instanceof Error ? error.name : 'UnknownThrown',
      error_message: error instanceof Error ? error.message.replace(/https?:\/\/[^\s"']+/gi, '[url]').slice(0, 240) : String(error).slice(0, 240),
    }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}

export function onRequest(context: PagesContext): Promise<Response> {
  if (context.request.method !== 'GET') {
    return Promise.resolve(Response.json({ error: { code: 'METHOD_NOT_ALLOWED' } }, { status: 405 }));
  }
  return onRequestGet(context);
}
