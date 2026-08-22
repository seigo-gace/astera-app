import {
  FunctionHttpError, functionErrorResponse, requestCorrelationId, requireAsteraActor,
  type AsteraFunctionEnv,
} from '../../../_account-projection';
import {
  getResultOrganization, patchResultOrganization, ResultOrganizationStoreError,
} from '../../../_result-organization-store';

type PagesContext = { request: Request; env: AsteraFunctionEnv; params: { result?: string } };

function resultId(context: PagesContext): string {
  const id = context.params.result?.trim();
  if (!id) throw new FunctionHttpError(400, 'RESULT_ID_REQUIRED', 'Result IDが必要です。');
  return id;
}

async function actor(context: PagesContext) {
  const value = await requireAsteraActor(context.request, context.env);
  return { userId: value.user.id, tenantId: value.profile.tenant_id };
}

function normalize(error: unknown): unknown {
  if (error instanceof ResultOrganizationStoreError) {
    return new FunctionHttpError(error.status, error.code, error.message, error.details);
  }
  return error;
}

export async function onRequestGet(context: PagesContext): Promise<Response> {
  const cid = requestCorrelationId(context.request);
  try {
    return Response.json(
      await getResultOrganization(context.env.ASTERA_DB, await actor(context), resultId(context)),
      { headers: { 'Cache-Control': 'no-store', 'X-Correlation-ID': cid } },
    );
  } catch (error) {
    return functionErrorResponse(normalize(error), cid);
  }
}

export async function onRequestPatch(context: PagesContext): Promise<Response> {
  const cid = requestCorrelationId(context.request);
  try {
    const body = await context.request.json().catch(() => null);
    return Response.json(
      await patchResultOrganization(context.env.ASTERA_DB, await actor(context), resultId(context), body),
      { headers: { 'Cache-Control': 'no-store', 'X-Correlation-ID': cid } },
    );
  } catch (error) {
    return functionErrorResponse(normalize(error), cid);
  }
}

export function onRequest(context: PagesContext): Promise<Response> {
  if (context.request.method === 'GET') return onRequestGet(context);
  if (context.request.method === 'PATCH') return onRequestPatch(context);
  return Promise.resolve(Response.json(
    { error: { code: 'METHOD_NOT_ALLOWED', message: 'GET/PATCHのみ対応しています。' } },
    { status: 405 },
  ));
}
