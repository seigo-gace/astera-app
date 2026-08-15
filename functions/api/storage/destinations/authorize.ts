import { FunctionHttpError, functionErrorResponse, requestCorrelationId, requireAsteraActor, type AsteraFunctionEnv } from '../../../_account-projection';
type C = { request: Request; env: AsteraFunctionEnv };
export async function onRequestPost(c: C): Promise<Response> {
  const id = requestCorrelationId(c.request);
  try {
    await requireAsteraActor(c.request, c.env);
    const body = await c.request.json().catch(() => null) as Record<string, unknown> | null;
    const provider = typeof body?.provider === 'string' ? body.provider.trim() : '';
    if (!['google-drive', 'google-sheets'].includes(provider)) throw new FunctionHttpError(422, 'STORAGE_PROVIDER_INVALID', '対応Storage Providerを選択してください。');
    throw new FunctionHttpError(503, 'STORAGE_OAUTH_BROKER_NOT_CONFIGURED', '外部Storage OAuth Brokerが未接続のため、安全停止しました。');
  } catch (e) { return functionErrorResponse(e, id); }
}
export function onRequest(c: C): Promise<Response> {
  return c.request.method === 'POST' ? onRequestPost(c) : Promise.resolve(Response.json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'POSTのみ対応しています。' } }, { status: 405 }));
}
