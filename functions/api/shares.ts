import { FunctionHttpError, functionErrorResponse, requestCorrelationId, requireAsteraActor, type AsteraFunctionEnv } from '../_account-projection';
import { listManagedShares, ShareManagementError } from '../_share-management-store';
import { createShare, ShareStoreError } from '../_share-store';

type C = { request: Request; env: AsteraFunctionEnv };
function norm(error: unknown): unknown {
  if (error instanceof ShareStoreError || error instanceof ShareManagementError) {
    return new FunctionHttpError(error.status, error.code, error.message, error.details);
  }
  return error;
}
async function actor(c: C) {
  const a = await requireAsteraActor(c.request, c.env);
  return { userId: a.user.id, tenantId: a.profile.tenant_id };
}
export async function onRequestGet(c: C) {
  const id = requestCorrelationId(c.request);
  try {
    return Response.json(await listManagedShares(c.env.ASTERA_DB, await actor(c)), {
      headers: { 'Cache-Control': 'no-store', 'X-Correlation-ID': id },
    });
  } catch (error) {
    return functionErrorResponse(norm(error), id);
  }
}
export async function onRequestPost(c: C) {
  const id = requestCorrelationId(c.request);
  try {
    return Response.json(await createShare(c.env.ASTERA_DB, await actor(c), await c.request.json().catch(() => null)), {
      status: 201,
      headers: { 'Cache-Control': 'no-store', 'X-Correlation-ID': id },
    });
  } catch (error) {
    return functionErrorResponse(norm(error), id);
  }
}
export function onRequest(c: C) {
  if (c.request.method === 'GET') return onRequestGet(c);
  if (c.request.method === 'POST') return onRequestPost(c);
  return Promise.resolve(Response.json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'GET/POSTのみ対応しています。' } }, { status: 405 }));
}
