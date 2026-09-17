import {
  FunctionHttpError,
  functionErrorResponse,
  requestCorrelationId,
  type AsteraFunctionEnv,
} from '../../../_account-projection';
import { processSquareWebhookEvent, type SquareEvent } from '../../../_square-event-handler';
import { requireGatewayProvider, verifyGatewayStandardWebhook } from '../../../_webhook-gateway';

type Env = AsteraFunctionEnv & { WEBHOOK_GATEWAY_APP_SECRET?: string };
type PagesContext = { request: Request; env: Env };

export async function onRequestPost(context: PagesContext): Promise<Response> {
  const requestId = requestCorrelationId(context.request);
  const rawBody = await context.request.text();
  try {
    requireGatewayProvider(context.request, 'square');
    const verified = await verifyGatewayStandardWebhook(
      context.request,
      rawBody,
      context.env.WEBHOOK_GATEWAY_APP_SECRET,
    );
    if (!verified) {
      throw new FunctionHttpError(401, 'GATEWAY_WEBHOOK_SIGNATURE_INVALID', 'Gateway Webhook署名を確認できません。');
    }

    const event = JSON.parse(rawBody) as SquareEvent;
    const result = await processSquareWebhookEvent(context.env, event);
    return Response.json(
      {
        accepted: true,
        duplicate: result.duplicate,
        event_id: event.event_id,
        processing_status: result.processingStatus,
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 'no-store',
          'X-Correlation-ID': requestId,
          'x-gace-accepted': 'true',
        },
      },
    );
  } catch (error) {
    return functionErrorResponse(error, requestId);
  }
}

export function onRequest(context: PagesContext): Promise<Response> {
  if (context.request.method !== 'POST') {
    return Promise.resolve(
      Response.json(
        { error: { code: 'METHOD_NOT_ALLOWED', message: 'POSTのみ対応しています。' } },
        { status: 405 },
      ),
    );
  }
  return onRequestPost(context);
}
