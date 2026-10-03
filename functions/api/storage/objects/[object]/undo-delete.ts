import {
  FunctionHttpError,
  functionErrorResponse,
  requestCorrelationId,
  requireAsteraActor,
  type AsteraFunctionEnv,
} from '../../../../_account-projection';
import { undoDeleteWithinWindow } from '../../../../_storage-deletion-lifecycle';
import { StorageStoreError } from '../../../../_storage-store';

type Context = {
  request: Request;
  env: AsteraFunctionEnv;
  params: { object?: string };
};

export async function onRequestPost(context: Context): Promise<Response> {
  const correlationId = requestCorrelationId(context.request);
  try {
    const actor = await requireAsteraActor(context.request, context.env);
    const objectId = context.params.object?.trim();
    if (!objectId) {
      throw new FunctionHttpError(400, 'STORAGE_OBJECT_ID_REQUIRED', 'Storage Object IDが必要です。');
    }
    return Response.json(
      await undoDeleteWithinWindow(
        context.env.ASTERA_DB,
        { userId: actor.user.id, tenantId: actor.profile.tenant_id },
        objectId,
      ),
      { headers: { 'Cache-Control': 'no-store', 'X-Correlation-ID': correlationId } },
    );
  } catch (error) {
    const normalized = error instanceof StorageStoreError
      ? new FunctionHttpError(error.status, error.code, error.message, error.details)
      : error;
    return functionErrorResponse(normalized, correlationId);
  }
}

export function onRequest(context: Context): Promise<Response> {
  return context.request.method === 'POST'
    ? onRequestPost(context)
    : Promise.resolve(Response.json(
        { error: { code: 'METHOD_NOT_ALLOWED', message: 'POSTのみ対応しています。' } },
        { status: 405, headers: { Allow: 'POST' } },
      ));
}
