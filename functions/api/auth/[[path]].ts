import { createAuth, type AuthEnv } from '../../_auth';

type PagesContext = { request: Request; env: AuthEnv };

export async function onRequest(context: PagesContext): Promise<Response> {
  try {
    return await createAuth(context.env).handler(context.request);
  } catch (error) {
    const correlationId = context.request.headers.get('X-Request-ID') || crypto.randomUUID();
    return Response.json({
      error: {
        code: error instanceof Error ? error.message : 'AUTH_RUNTIME_CONFIGURATION_ERROR',
        message: '認証Runtimeを開始できません。',
        correlation_id: correlationId,
        retryable: false,
      },
    }, { status: 503, headers: { 'Cache-Control': 'no-store', 'X-Correlation-ID': correlationId } });
  }
}
