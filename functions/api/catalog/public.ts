import { functionErrorResponse, requestCorrelationId, type AsteraFunctionEnv } from '../../_account-projection';
import { loadActiveCatalog } from '../../_catalog';

type PagesContext = { request: Request; env: AsteraFunctionEnv };

export async function onRequestGet(context: PagesContext): Promise<Response> {
  const requestId = requestCorrelationId(context.request);
  try {
    const catalog = await loadActiveCatalog(context.env.ASTERA_DB);
    return Response.json(catalog, {
      headers: {
        'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
        'ETag': `"${catalog.checksum}"`,
        'X-Correlation-ID': requestId,
      },
    });
  } catch (error) {
    return functionErrorResponse(error, requestId);
  }
}

export function onRequest(context: PagesContext): Promise<Response> {
  if (context.request.method !== 'GET') {
    return Promise.resolve(Response.json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'GETのみ対応しています。' } }, { status: 405 }));
  }
  return onRequestGet(context);
}
