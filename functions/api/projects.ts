import {
  FunctionHttpError, functionErrorResponse, requestCorrelationId, requireAsteraActor,
  type AsteraFunctionEnv,
} from '../_account-projection';
import { createProject, WorkspaceStoreError } from '../_workspace-store';
import { listProjectRecords, normalizeProjectStatus, ProjectStoreError } from '../_project-store';

type C = { request: Request; env: AsteraFunctionEnv };
function normalize(error: unknown): unknown {
  if (error instanceof WorkspaceStoreError || error instanceof ProjectStoreError) {
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
    const url = new URL(c.request.url);
    return Response.json(
      await listProjectRecords(
        c.env.ASTERA_DB,
        await actor(c),
        url.searchParams.get('q') || '',
        normalizeProjectStatus(url.searchParams.get('status')),
      ),
      { headers: { 'Cache-Control': 'no-store', 'X-Correlation-ID': id } },
    );
  } catch (error) {
    return functionErrorResponse(normalize(error), id);
  }
}
export async function onRequestPost(c: C) {
  const id = requestCorrelationId(c.request);
  try {
    return Response.json(
      await createProject(c.env.ASTERA_DB, await actor(c), await c.request.json().catch(() => null)),
      { status: 201, headers: { 'Cache-Control': 'no-store', 'X-Correlation-ID': id } },
    );
  } catch (error) {
    return functionErrorResponse(normalize(error), id);
  }
}
export function onRequest(c: C) {
  if (c.request.method === 'GET') return onRequestGet(c);
  if (c.request.method === 'POST') return onRequestPost(c);
  return Promise.resolve(Response.json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'GET/POSTのみ対応しています。' } }, { status: 405 }));
}
