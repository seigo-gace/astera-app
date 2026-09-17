import {
  FunctionHttpError,
  functionErrorResponse,
  requestCorrelationId,
  requireAsteraActor,
} from '../../_account-projection';
import { adminiSignedRequest } from '../../_admini-signature';
import { betaParticipant, type BetaEnv } from '../../_beta-program';

type PagesContext = { request: Request; env: BetaEnv };

const CATEGORIES = new Set(['LAYOUT','USABILITY','UNDERSTANDING','BUG','PERFORMANCE','OTHER']);

export async function onRequest(context: PagesContext): Promise<Response> {
  const requestId = requestCorrelationId(context.request);
  try {
    if (context.request.method !== 'POST') {
      return Response.json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'POSTを使用してください。', correlation_id: requestId } }, { status: 405 });
    }
    const actor = await requireAsteraActor(context.request, context.env);
    const participant = await betaParticipant(context.env, actor.user.id);
    if (!participant || !['active','commitment_active'].includes(participant.state)) throw new FunctionHttpError(409, 'BETA_NOT_ACTIVE', 'βテスト参加中のみ報告できます。');
    const body = await context.request.json().catch(() => null) as {
      feature_id?: unknown;
      category?: unknown;
      feedback_text?: unknown;
      screenshot_ref?: unknown;
      technical_context?: unknown;
    } | null;
    const category = typeof body?.category === 'string' ? body.category.trim().toUpperCase() : '';
    if (!CATEGORIES.has(category)) throw new FunctionHttpError(400, 'REPORT_CATEGORY_INVALID', '報告Categoryを確認してください。');
    const feedbackText = typeof body?.feedback_text === 'string' ? body.feedback_text.trim() : '';
    if (feedbackText.length > 8000) throw new FunctionHttpError(400, 'REPORT_TEXT_TOO_LONG', '報告内容が長すぎます。');
    const clientContext = body?.technical_context && typeof body.technical_context === 'object' && !Array.isArray(body.technical_context)
      ? body.technical_context as Record<string, unknown>
      : {};
    const technicalContext = {
      route: typeof clientContext.route === 'string' ? clientContext.route.slice(0, 300) : null,
      app_version: typeof clientContext.app_version === 'string' ? clientContext.app_version.slice(0, 80) : null,
      os: typeof clientContext.os === 'string' ? clientContext.os.slice(0, 120) : null,
      device_class: typeof clientContext.device_class === 'string' ? clientContext.device_class.slice(0, 80) : null,
      viewport_width: Number.isFinite(Number(clientContext.viewport_width)) ? Number(clientContext.viewport_width) : null,
      viewport_height: Number.isFinite(Number(clientContext.viewport_height)) ? Number(clientContext.viewport_height) : null,
      orientation: typeof clientContext.orientation === 'string' ? clientContext.orientation.slice(0, 40) : null,
      trace_id: typeof clientContext.trace_id === 'string' ? clientContext.trace_id.slice(0, 160) : null,
      user_agent: context.request.headers.get('User-Agent')?.slice(0, 500) ?? null,
    };
    const submissionId = crypto.randomUUID();
    const submittedAt = new Date().toISOString();
    const result = await adminiSignedRequest<{ submissionId?: string; acceptedAt?: string }>(context.env, '/internal/v1/rewards/beta/report', {
      submission_id: submissionId,
      user_id: actor.user.id,
      tenant_id: actor.profile.tenant_id,
      feature_id: typeof body?.feature_id === 'string' && body.feature_id.trim() ? body.feature_id.trim() : null,
      category,
      feedback_text: feedbackText || null,
      screenshot_ref: typeof body?.screenshot_ref === 'string' && body.screenshot_ref.trim() ? body.screenshot_ref.trim() : null,
      technical_context: technicalContext,
      submitted_at: submittedAt,
    });
    return Response.json({ submitted: true, submission_id: result.submissionId ?? submissionId, accepted_at: result.acceptedAt ?? submittedAt }, {
      status: 201,
      headers: { 'Cache-Control': 'no-store', 'X-Correlation-ID': requestId },
    });
  } catch (error) {
    return functionErrorResponse(error, requestId);
  }
}
