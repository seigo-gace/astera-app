import {
  FunctionHttpError,
  functionErrorResponse,
  requestCorrelationId,
  requireAsteraActor,
  type AsteraFunctionEnv,
} from '../../../../_account-projection';

type Context = { request: Request; env: AsteraFunctionEnv; params: { session?: string } };

type SessionRow = { id: string; userId: string };

export async function onRequestDelete(context: Context): Promise<Response> {
  const requestId = requestCorrelationId(context.request);
  try {
    const actor = await requireAsteraActor(context.request, context.env);
    const sessionId = context.params.session?.trim();
    if (!sessionId) throw new FunctionHttpError(400, 'SESSION_ID_REQUIRED', '切断する端末Sessionを指定してください。');
    const currentSessionId = actor.session?.id?.trim() || '';
    if (currentSessionId && sessionId === currentSessionId) {
      throw new FunctionHttpError(409, 'CURRENT_SESSION_REVOKE_REJECTED', '現在使用中の端末はこの操作では切断できません。');
    }
    const owned = await context.env.ASTERA_DB.prepare(
      'SELECT id,"userId" FROM session WHERE id=?1 AND "userId"=?2 LIMIT 1',
    ).bind(sessionId, actor.user.id).first<SessionRow>();
    if (!owned?.id) throw new FunctionHttpError(404, 'SESSION_NOT_FOUND', '指定したログイン端末は既に切断されています。');

    const result = await context.env.ASTERA_DB.prepare(
      'DELETE FROM session WHERE id=?1 AND "userId"=?2',
    ).bind(sessionId, actor.user.id).run();
    if (Number(result.meta?.changes ?? 0) !== 1) {
      throw new FunctionHttpError(409, 'SESSION_REVOKE_NOT_APPLIED', 'ログイン端末を切断できませんでした。');
    }

    return Response.json(
      { ok: true, revoked: true },
      { headers: { 'Cache-Control': 'no-store', 'X-Correlation-ID': requestId } },
    );
  } catch (error) {
    return functionErrorResponse(error, requestId);
  }
}

export function onRequest(context: Context): Promise<Response> {
  if (context.request.method !== 'DELETE') {
    return Promise.resolve(Response.json(
      { error: { code: 'METHOD_NOT_ALLOWED', message: 'DELETEのみ対応しています。' } },
      { status: 405, headers: { Allow: 'DELETE' } },
    ));
  }
  return onRequestDelete(context);
}
