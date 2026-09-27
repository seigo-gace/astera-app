import {
  FunctionHttpError,
  functionErrorResponse,
  requestCorrelationId,
  requireAsteraActor,
  type AsteraFunctionEnv,
} from '../../_account-projection';
import {
  appendConversationTurn,
  ConversationStoreError,
  listConversations,
} from '../../_conversation-store';

type C = { request: Request; env: AsteraFunctionEnv };

function normalize(error: unknown): unknown {
  return error instanceof ConversationStoreError
    ? new FunctionHttpError(error.status, error.code, error.message, error.details)
    : error;
}

export async function onRequestGet(c: C): Promise<Response> {
  const id = requestCorrelationId(c.request);
  try {
    const actor = await requireAsteraActor(c.request, c.env);
    const limit = Number(new URL(c.request.url).searchParams.get('limit') || 25);
    return Response.json(
      await listConversations(c.env.ASTERA_DB, { userId: actor.user.id, tenantId: actor.profile.tenant_id }, limit),
      { headers: { 'Cache-Control': 'no-store', 'X-Correlation-ID': id } },
    );
  } catch (error) {
    return functionErrorResponse(normalize(error), id);
  }
}

export async function onRequestPost(c: C): Promise<Response> {
  const id = requestCorrelationId(c.request);
  try {
    const actor = await requireAsteraActor(c.request, c.env);
    const payload = await appendConversationTurn(
      c.env.ASTERA_DB,
      { userId: actor.user.id, tenantId: actor.profile.tenant_id },
      await c.request.json().catch(() => null),
    );
    return Response.json(payload, { status: 201, headers: { 'Cache-Control': 'no-store', 'X-Correlation-ID': id } });
  } catch (error) {
    return functionErrorResponse(normalize(error), id);
  }
}

export function onRequest(c: C): Promise<Response> {
  if (c.request.method === 'GET') return onRequestGet(c);
  if (c.request.method === 'POST') return onRequestPost(c);
  return Promise.resolve(Response.json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'GET/POSTのみ対応しています。' } }, { status: 405 }));
}
