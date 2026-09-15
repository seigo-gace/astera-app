import {
  FunctionHttpError,
  functionErrorResponse,
  requestCorrelationId,
  requireAsteraActor,
  type AsteraFunctionEnv,
} from '../_account-projection';

type Env = AsteraFunctionEnv;
type PagesContext = { request: Request; env: Env };

export async function onRequestGet(context: PagesContext): Promise<Response> {
  const requestId = requestCorrelationId(context.request);
  try {
    const actor = await requireAsteraActor(context.request, context.env);
    const { user, session, profile, credit } = actor;
    return Response.json({
      account: {
        user_id: user.id,
        tenant_id: profile.tenant_id,
        email: user.email,
        email_verified: user.emailVerified !== false,
        nickname: profile.nickname,
        display_name: profile.nickname,
        account_status: profile.account_status,
        auth_stage: profile.account_status === 'active' ? 'authenticated' : profile.account_status,
        ui_language: profile.ui_language,
        image: user.image ?? null,
        two_factor_enabled: user.twoFactorEnabled === true,
        session_id: session?.id ?? null,
        session_expires_at: session?.expiresAt ?? null,
        credit: {
          available: Number(credit.available_balance),
          reserved: Number(credit.reserved_balance),
          version: Number(credit.version),
          updated_at: credit.updated_at,
        },
      },
    }, { headers: { 'Cache-Control': 'no-store', 'X-Correlation-ID': requestId } });
  } catch (error) {
    if (error instanceof FunctionHttpError) {
      return functionErrorResponse(error, requestId);
    }
    const message = error instanceof Error ? error.message : String(error);
    const migrationMissing = /no such table|D1_ERROR|ASTERA_ACCOUNT_PROJECTION_FAILED/i.test(message);
    return functionErrorResponse(
      new FunctionHttpError(
        migrationMissing ? 503 : 500,
        migrationMissing ? 'ASTERA_ACCOUNT_SCHEMA_NOT_READY' : 'ACCOUNT_SESSION_PROJECTION_FAILED',
        migrationMissing
          ? '認証・Account・Credit用D1 Migrationが適用されていません。'
          : 'Account状態を取得できませんでした。',
        message,
      ),
      requestId,
    );
  }
}

export function onRequest(context: PagesContext): Promise<Response> {
  if (context.request.method !== 'GET') {
    const requestId = requestCorrelationId(context.request);
    return Promise.resolve(functionErrorResponse(
      new FunctionHttpError(405, 'METHOD_NOT_ALLOWED', 'このRouteはGETのみ対応しています。'),
      requestId,
    ));
  }
  return onRequestGet(context);
}
