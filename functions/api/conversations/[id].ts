import {
  FunctionHttpError,
  functionErrorResponse,
  requestCorrelationId,
  requireAsteraActor,
  type AsteraFunctionEnv,
} from '../../_account-projection';
import { ConversationStoreError, getConversation } from '../../_conversation-store';

type C = { request: Request; env: AsteraFunctionEnv; params: { id?: string | string[] } };

export async function onRequestGet(c: C): Promise<Response> {
  const correlationId = requestCorrelationId(c.request);
  try {
    const actor = await requireAsteraActor(c.request, c.env);
    const raw = Array.isArray(c.params.id) ? c.params.id[0] : c.params.id;
    const id = typeof raw === 'string' ? raw.trim() : '';
    if (!id) throw new FunctionHttpError(422, 'CONVERSATION_ID_REQUIRED', 'Conversation IDが必要です。');
    return Response.json(
      await getConversation(c.env.ASTERA_DB, { userId: actor.user.id, tenantId: actor.profile.tenant_id }, id),
      { headers: { 'Cache-Control': 'no-store', 'X-Correlation-ID': correlationId } },
    );
  } catch (error) {
    const normalized = error instanceof ConversationStoreError
      ? new FunctionHttpError(error.status, error.code, error.message, error.details)
      : error;
    return functionErrorResponse(normalized, correlationId);
  }
}

export function onRequest(c: C): Promise<Response> {
  return c.request.method === 'GET'
    ? onRequestGet(c)
    : Promise.resolve(Response.json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'GETのみ対応しています。' } }, { status: 405 }));
}
