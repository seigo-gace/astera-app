import {
  FunctionHttpError, functionErrorResponse, requestCorrelationId, requireAsteraActor,
  type AsteraFunctionEnv,
} from '../../_account-projection';
import { deleteResult, editResult, getResult, ResultStoreError } from '../../_result-store';

type PagesContext = { request: Request; env: AsteraFunctionEnv; params: { result?: string } };
function normalize(error: unknown): unknown {
  if (error instanceof ResultStoreError) return new FunctionHttpError(error.status, error.code, error.message, error.details);
  return error;
}
function resultId(context: PagesContext): string {
  const id = context.params.result?.trim();
  if (!id) throw new FunctionHttpError(400, 'RESULT_ID_REQUIRED', 'Result IDが必要です。');
  return id;
}
async function actor(context: PagesContext) {
  const a = await requireAsteraActor(context.request, context.env);
  return { userId: a.user.id, tenantId: a.profile.tenant_id };
}
export async function onRequestGet(context: PagesContext): Promise<Response> {
  const cid = requestCorrelationId(context.request);
  try { return Response.json(await getResult(context.env.ASTERA_DB, await actor(context), resultId(context)), { headers: { 'Cache-Control':'no-store', 'X-Correlation-ID':cid } }); }
  catch (error) { return functionErrorResponse(normalize(error), cid); }
}
export async function onRequestPatch(context: PagesContext): Promise<Response> {
  const cid = requestCorrelationId(context.request);
  try {
    const body = await context.request.json().catch(() => null);
    return Response.json(await editResult(context.env.ASTERA_DB, await actor(context), resultId(context), body), { headers: { 'Cache-Control':'no-store', 'X-Correlation-ID':cid } });
  } catch (error) { return functionErrorResponse(normalize(error), cid); }
}
export async function onRequestDelete(context: PagesContext): Promise<Response> {
  const cid = requestCorrelationId(context.request);
  try { return Response.json(await deleteResult(context.env.ASTERA_DB, await actor(context), resultId(context)), { headers: { 'Cache-Control':'no-store', 'X-Correlation-ID':cid } }); }
  catch (error) { return functionErrorResponse(normalize(error), cid); }
}
export function onRequest(context: PagesContext): Promise<Response> {
  if (context.request.method === 'GET') return onRequestGet(context);
  if (context.request.method === 'PATCH') return onRequestPatch(context);
  if (context.request.method === 'DELETE') return onRequestDelete(context);
  return Promise.resolve(Response.json({ error:{ code:'METHOD_NOT_ALLOWED', message:'GET/PATCH/DELETEのみ対応しています。' } }, { status:405 }));
}
