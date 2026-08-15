import { functionErrorResponse, requestCorrelationId, requireAsteraActor, type AsteraFunctionEnv } from '../../_account-projection';
import { listExternalStorageDestinations } from '../../_external-storage-store';
type C = { request: Request; env: AsteraFunctionEnv };
export async function onRequestGet(c: C): Promise<Response> {
  const id = requestCorrelationId(c.request);
  try {
    const a = await requireAsteraActor(c.request, c.env);
    return Response.json(await listExternalStorageDestinations(c.env.ASTERA_DB, { userId: a.user.id, tenantId: a.profile.tenant_id }), { headers: { 'Cache-Control': 'no-store', 'X-Correlation-ID': id } });
  } catch (e) { return functionErrorResponse(e, id); }
}
export function onRequest(c: C): Promise<Response> {
  return c.request.method === 'GET' ? onRequestGet(c) : Promise.resolve(Response.json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'GETのみ対応しています。' } }, { status: 405 }));
}
