import {
  FunctionHttpError, functionErrorResponse, requestCorrelationId, requireAsteraActor,
  type AsteraFunctionEnv,
} from '../../_account-projection';
import { deleteProjectRecord, getProjectRecord, ProjectStoreError, updateProjectRecord } from '../../_project-store';

type C = { request: Request; env: AsteraFunctionEnv; params: { project?: string } };
function projectId(c: C): string {
  const id = c.params.project?.trim();
  if (!id) throw new FunctionHttpError(400, 'PROJECT_ID_REQUIRED', 'Project IDが必要です。');
  return id;
}
function normalize(error: unknown): unknown {
  return error instanceof ProjectStoreError
    ? new FunctionHttpError(error.status, error.code, error.message, error.details)
    : error;
}
async function actor(c: C) {
  const a = await requireAsteraActor(c.request, c.env);
  return { userId: a.user.id, tenantId: a.profile.tenant_id };
}
export async function onRequestGet(c: C): Promise<Response> {
  const id = requestCorrelationId(c.request);
  try {
    return Response.json(await getProjectRecord(c.env.ASTERA_DB, await actor(c), projectId(c)), {
      headers: { 'Cache-Control': 'no-store', 'X-Correlation-ID': id },
    });
  } catch (error) {
    return functionErrorResponse(normalize(error), id);
  }
}
export async function onRequestPatch(c: C): Promise<Response> {
  const id = requestCorrelationId(c.request);
  try {
    return Response.json(
      await updateProjectRecord(c.env.ASTERA_DB, await actor(c), projectId(c), await c.request.json().catch(() => null)),
      { headers: { 'Cache-Control': 'no-store', 'X-Correlation-ID': id } },
    );
  } catch (error) {
    return functionErrorResponse(normalize(error), id);
  }
}
export async function onRequestDelete(c: C): Promise<Response> {
  const id = requestCorrelationId(c.request);
  try {
    return Response.json(await deleteProjectRecord(c.env.ASTERA_DB, await actor(c), projectId(c)), {
      headers: { 'Cache-Control': 'no-store', 'X-Correlation-ID': id },
    });
  } catch (error) {
    return functionErrorResponse(normalize(error), id);
  }
}
export function onRequest(c: C): Promise<Response> {
  if (c.request.method === 'GET') return onRequestGet(c);
  if (c.request.method === 'PATCH') return onRequestPatch(c);
  if (c.request.method === 'DELETE') return onRequestDelete(c);
  return Promise.resolve(Response.json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'GET/PATCH/DELETEのみ対応しています。' } }, { status: 405 }));
}
