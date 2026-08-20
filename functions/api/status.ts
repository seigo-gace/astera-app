import { functionErrorResponse, requestCorrelationId, type AsteraFunctionEnv } from '../_account-projection';

type PagesContext = { request: Request; env: AsteraFunctionEnv };

export async function onRequestGet(context: PagesContext): Promise<Response> {
  const requestId = requestCorrelationId(context.request);
  try {
    await context.env.ASTERA_DB.prepare('SELECT 1 AS ok').first<{ ok: number }>();
    return Response.json(
      { status: 'operational', updated_at: new Date().toISOString() },
      {
        headers: {
          'Cache-Control': 'no-store',
          'X-Correlation-ID': requestId,
        },
      },
    );
  } catch (error) {
    return functionErrorResponse(error, requestId);
  }
}

export function onRequest(context: PagesContext): Promise<Response> {
  if (context.request.method !== 'GET') {
    return Promise.resolve(
      Response.json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'GETのみ対応しています。' } }, { status: 405 }),
    );
  }
  return onRequestGet(context);
}
