import { createAuth, type AuthEnv } from '../../_auth';

type PagesContext = { request: Request; env: AuthEnv };
type SessionSnapshot = { session?: { createdAt?: Date | string } };

const FRESH_SESSION_MAX_AGE_MS = 15 * 60 * 1000;
const FRESH_MANAGEMENT_PATHS = new Set([
  '/api/auth/change-password',
  '/api/auth/set-password',
  '/api/auth/two-factor/enable',
  '/api/auth/two-factor/disable',
  '/api/auth/two-factor/generate-backup-codes',
  '/api/auth/passkey/add-passkey',
  '/api/auth/passkey/delete-passkey',
  '/api/auth/passkey/update-passkey',
  '/api/auth/link-social',
  '/api/auth/unlink-account',
  '/api/auth/delete-user',
]);

function normalizedPath(request: Request): string {
  return new URL(request.url).pathname.replace(/\/+$/, '') || '/';
}

function freshError(status: number, code: string, message: string, correlationId: string): Response {
  return Response.json({
    error: {
      code,
      message,
      correlation_id: correlationId,
      retryable: false,
      details: { max_age_seconds: FRESH_SESSION_MAX_AGE_MS / 1000 },
    },
  }, { status, headers: { 'Cache-Control': 'no-store', 'X-Correlation-ID': correlationId } });
}

function sessionAgeMs(session: SessionSnapshot['session']): number {
  const raw = session?.createdAt;
  const createdAt = raw instanceof Date ? raw.getTime() : typeof raw === 'string' ? Date.parse(raw) : Number.NaN;
  return Date.now() - createdAt;
}

async function enforceFreshSession(
  request: Request,
  auth: ReturnType<typeof createAuth>,
  correlationId: string,
): Promise<Response | null> {
  const pathname = normalizedPath(request);
  const conditionalEnrollmentVerification = pathname === '/api/auth/two-factor/verify-totp';
  if (!FRESH_MANAGEMENT_PATHS.has(pathname) && !conditionalEnrollmentVerification) return null;

  const session = await auth.api.getSession({ headers: request.headers }) as SessionSnapshot | null;
  if (!session?.session) {
    if (conditionalEnrollmentVerification) return null;
    return freshError(401, 'SESSION_REQUIRED', 'この操作にはLoginが必要です。', correlationId);
  }

  const ageMs = sessionAgeMs(session.session);
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > FRESH_SESSION_MAX_AGE_MS) {
    return freshError(403, 'FRESH_SESSION_REQUIRED', 'この操作には15分以内に開始されたFresh Sessionが必要です。再認証してください。', correlationId);
  }
  return null;
}

export async function onRequest(context: PagesContext): Promise<Response> {
  const correlationId = context.request.headers.get('X-Request-ID') || crypto.randomUUID();
  try {
    const auth = createAuth(context.env);
    const freshnessFailure = await enforceFreshSession(context.request, auth, correlationId);
    if (freshnessFailure) return freshnessFailure;
    return await auth.handler(context.request);
  } catch (error) {
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
