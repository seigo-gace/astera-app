import {
  FunctionHttpError, functionErrorResponse, requestCorrelationId, requireAsteraActor,
  type AsteraFunctionEnv,
} from '../_account-projection';
import { HistoryStoreError, listHistoryPage, parseHistoryQuery } from '../_history-store';

type C = { request: Request; env: AsteraFunctionEnv };
export async function onRequestGet(c: C): Promise<Response> {
  const id = requestCorrelationId(c.request);
  try {
    const actor = await requireAsteraActor(c.request, c.env);
    return Response.json(
      await listHistoryPage(
        c.env.ASTERA_DB,
        { userId: actor.user.id, tenantId: actor.profile.tenant_id },
        parseHistoryQuery(new URL(c.request.url)),
      ),
      { headers: { 'Cache-Control': 'no-store', 'X-Correlation-ID': id } },
    );
  } catch (error) {
    const normalized = error instanceof HistoryStoreError
      ? new FunctionHttpError(error.status, error.code, error.message, error.details)
      : error;
    return functionErrorResponse(normalized, id);
  }
}
export function onRequest(c: C): Promise<Response> {
  return c.request.method === 'GET'
    ? onRequestGet(c)
    : Promise.resolve(Response.json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'GETのみ対応しています。' } }, { status: 405 }));
}
