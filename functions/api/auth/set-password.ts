import { createAuth } from '../../_auth';
import type { AsteraFunctionEnv } from '../../_account-projection';

type Context = { request: Request; env: AsteraFunctionEnv };
type SessionPayload = {
  user?: { id?: string };
  session?: { createdAt?: Date | string };
};

const FRESH_SESSION_MAX_AGE_MS = 15 * 60 * 1000;

function json(status: number, code: string, message: string): Response {
  return Response.json(
    { error: { code, message } },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

function sessionAgeMs(createdAt: Date | string | undefined): number {
  const createdAtMs = createdAt instanceof Date
    ? createdAt.getTime()
    : typeof createdAt === 'string'
      ? Date.parse(createdAt)
      : Number.NaN;
  return Date.now() - createdAtMs;
}

export async function onRequestPost(context: Context): Promise<Response> {
  let body: { newPassword?: unknown };
  try {
    body = await context.request.json() as { newPassword?: unknown };
  } catch {
    return json(400, 'INVALID_REQUEST_BODY', 'Password設定Requestが不正です。');
  }

  const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
  if (newPassword.length < 6 || newPassword.length > 128) {
    return json(400, 'PASSWORD_LENGTH_INVALID', 'Passwordは6〜128文字で設定してください。');
  }

  try {
    const auth = createAuth(context.env);
    const session = await auth.api.getSession({ headers: context.request.headers }) as SessionPayload | null;
    const userId = session?.user?.id?.trim();
    if (!userId || !session?.session) {
      return json(401, 'SESSION_REQUIRED', 'Password設定にはLoginが必要です。');
    }

    const ageMs = sessionAgeMs(session.session.createdAt);
    if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > FRESH_SESSION_MAX_AGE_MS) {
      return json(403, 'FRESH_SESSION_REQUIRED', 'Password設定には15分以内に開始したLoginが必要です。再Loginしてください。');
    }

    await auth.api.setPassword({
      body: { newPassword },
      headers: context.request.headers,
    });

    const credential = await context.env.ASTERA_DB.prepare(
      'SELECT id,password FROM "account" WHERE "userId"=?1 AND "providerId"=?2 AND password IS NOT NULL AND length(password) > 0 LIMIT 1',
    ).bind(userId, 'credential').first<{ id: string; password: string }>();

    if (!credential?.id || !credential.password) {
      return json(502, 'PASSWORD_CREDENTIAL_NOT_CREATED', 'Password設定を確認できませんでした。もう一度お試しください。');
    }

    const now = new Date().toISOString();
    await context.env.ASTERA_DB.prepare(
      `UPDATE user_profiles
       SET account_status = 'active', updated_at = ?2
       WHERE user_id = ?1 AND account_status = 'pending_password_setup'`,
    ).bind(userId, now).run();

    return Response.json(
      { ok: true, password_configured: true, account_status: 'active' },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    const source = error && typeof error === 'object' ? error as Record<string, unknown> : {};
    const status = typeof source.status === 'number' ? source.status : typeof source.statusCode === 'number' ? source.statusCode : 500;
    const message = typeof source.message === 'string' && source.message.trim()
      ? source.message
      : 'Password設定を完了できませんでした。';
    return json(status >= 400 && status < 600 ? status : 500, 'PASSWORD_SETUP_FAILED', message);
  }
}

export function onRequest(context: Context): Promise<Response> {
  if (context.request.method !== 'POST') {
    return Promise.resolve(Response.json(
      { error: { code: 'METHOD_NOT_ALLOWED', message: 'POSTのみ対応しています。' } },
      { status: 405, headers: { Allow: 'POST', 'Cache-Control': 'no-store' } },
    ));
  }
  return onRequestPost(context);
}
