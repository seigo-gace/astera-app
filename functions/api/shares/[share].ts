import { FunctionHttpError, functionErrorResponse, requestCorrelationId, requireAsteraActor, type AsteraFunctionEnv } from '../../_account-projection';
import { ShareManagementError, updateManagedShare } from '../../_share-management-store';
import { getPrivateShare, revokeShare, ShareStoreError } from '../../_share-store';

type C = { request: Request; env: AsteraFunctionEnv; params: { share?: string } };
function norm(error: unknown): unknown {
  if (error instanceof ShareStoreError || error instanceof ShareManagementError) {
    return new FunctionHttpError(error.status, error.code, error.message, error.details);
  }
  return error;
}
async function ctx(c: C) {
  const a = await requireAsteraActor(c.request, c.env);
  const id = c.params.share?.trim();
  if (!id) throw new FunctionHttpError(400, 'SHARE_ID_REQUIRED', 'Share IDが必要です。');
  return { actor: { userId: a.user.id, tenantId: a.profile.tenant_id }, id };
}
export async function onRequestGet(c: C) {
  const cid = requestCorrelationId(c.request);
  try {
    const { actor, id } = await ctx(c);
    return Response.json(await getPrivateShare(c.env.ASTERA_DB, actor, id), {
      headers: { 'Cache-Control': 'no-store', 'X-Correlation-ID': cid },
    });
  } catch (error) {
    return functionErrorResponse(norm(error), cid);
  }
}
export async function onRequestPatch(c: C) {
  const cid = requestCorrelationId(c.request);
  try {
    const { actor, id } = await ctx(c);
    return Response.json(await updateManagedShare(c.env.ASTERA_DB, actor, id, await c.request.json().catch(() => null)), {
      headers: { 'Cache-Control': 'no-store', 'X-Correlation-ID': cid },
    });
  } catch (error) {
    return functionErrorResponse(norm(error), cid);
  }
}
export async function onRequestDelete(c: C) {
  const cid = requestCorrelationId(c.request);
  try {
    const { actor, id } = await ctx(c);
    return Response.json(await revokeShare(c.env.ASTERA_DB, actor, id), {
      headers: { 'Cache-Control': 'no-store', 'X-Correlation-ID': cid },
    });
  } catch (error) {
    return functionErrorResponse(norm(error), cid);
  }
}
export function onRequest(c: C) {
  if (c.request.method === 'GET') return onRequestGet(c);
  if (c.request.method === 'PATCH') return onRequestPatch(c);
  if (c.request.method === 'DELETE') return onRequestDelete(c);
  return Promise.resolve(Response.json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'GET/PATCH/DELETEのみ対応しています。' } }, { status: 405 }));
}
