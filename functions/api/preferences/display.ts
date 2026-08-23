import {
  functionErrorResponse,
  requestCorrelationId,
  requireAsteraActor,
  type AsteraFunctionEnv,
} from '../../_account-projection';

type PagesContext = { request: Request; env: AsteraFunctionEnv };

type SupportedLanguage = 'ja-JP' | 'en-US';

function normalizeLanguage(value: unknown): SupportedLanguage | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'ja' || normalized === 'ja-jp') return 'ja-JP';
  if (normalized === 'en' || normalized === 'en-us') return 'en-US';
  return null;
}

function response(uiLanguage: SupportedLanguage, requestId: string): Response {
  return Response.json(
    { display: { ui_language: uiLanguage } },
    { headers: { 'Cache-Control': 'no-store', 'X-Correlation-ID': requestId } },
  );
}

export async function onRequest(context: PagesContext): Promise<Response> {
  const requestId = requestCorrelationId(context.request);
  try {
    const actor = await requireAsteraActor(context.request, context.env);
    if (context.request.method === 'GET') {
      return response(normalizeLanguage(actor.profile.ui_language) ?? 'ja-JP', requestId);
    }
    if (context.request.method !== 'PUT') {
      return Response.json(
        { error: { code: 'METHOD_NOT_ALLOWED', message: 'GETまたはPUTを使用してください。', correlation_id: requestId } },
        { status: 405, headers: { 'Cache-Control': 'no-store', 'X-Correlation-ID': requestId } },
      );
    }

    const body = await context.request.json().catch(() => null) as { ui_language?: unknown } | null;
    const uiLanguage = normalizeLanguage(body?.ui_language);
    if (!uiLanguage) {
      return Response.json(
        { error: { code: 'UI_LANGUAGE_UNSUPPORTED', message: '表示言語はja-JPまたはen-USを指定してください。', correlation_id: requestId } },
        { status: 400, headers: { 'Cache-Control': 'no-store', 'X-Correlation-ID': requestId } },
      );
    }

    const now = new Date().toISOString();
    await context.env.ASTERA_DB.prepare(
      'UPDATE user_profiles SET ui_language = ?1, updated_at = ?2 WHERE user_id = ?3 AND tenant_id = ?4',
    ).bind(uiLanguage, now, actor.user.id, actor.profile.tenant_id).run();
    return response(uiLanguage, requestId);
  } catch (error) {
    return functionErrorResponse(error, requestId);
  }
}
