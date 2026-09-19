import {
  functionErrorResponse,
  requestCorrelationId,
  type BillingServiceEnv,
  FunctionHttpError,
} from '../part/billing-env.js';
import { createLibralVaultClientFromEnv } from '../feature/libral-vault.js';
import { redactSquareWebhookPayload } from '../feature/square-redactor.js';
import { processSquareWebhookEvent, type SquareEvent } from '../feature/square-event-handler.js';
import { verifySquareWebhookSignature } from '../feature/square-webhook-verify.js';

function parseSquareEventFromBody(rawBody: string): SquareEvent {
  const parsed = JSON.parse(rawBody) as Record<string, unknown>;
  if (parsed && typeof parsed === 'object' && parsed.specversion === '1.0' && parsed.data) {
    return redactSquareWebhookPayload(parsed.data) as SquareEvent;
  }
  return redactSquareWebhookPayload(parsed) as SquareEvent;
}

export async function handleSquareWebhook(request: Request, env: BillingServiceEnv): Promise<Response> {
  const requestId = requestCorrelationId(request.headers);
  const rawBody = await request.text();
  try {
    const vault = env.vault ?? createLibralVaultClientFromEnv(env);
    if (!vault) {
      throw new FunctionHttpError(503, 'VAULT_NOT_CONFIGURED', 'Vault internal clientが設定されていません。');
    }

    const signature = request.headers.get('x-square-hmacsha256-signature');
    const verified = await verifySquareWebhookSignature(env, rawBody, signature, vault);
    if (!verified) {
      throw new FunctionHttpError(401, 'SQUARE_WEBHOOK_SIGNATURE_INVALID', 'Square Webhook署名を確認できません。');
    }

    const event = parseSquareEventFromBody(rawBody);
    if (!event.event_id?.trim() || !event.type?.trim()) {
      throw new FunctionHttpError(400, 'SQUARE_WEBHOOK_EVENT_INVALID', 'Square Event IDまたはTypeがありません。');
    }

    const result = await processSquareWebhookEvent(env, event, requestId);

    const status = result.duplicate || result.processingStatus === 'ignored_event_type' ? 200 : 202;
    return Response.json(
      {
        accepted: true,
        duplicate: result.duplicate,
        event_id: event.event_id,
        processing_status: result.processingStatus,
      },
      {
        status,
        headers: {
          'Cache-Control': 'no-store',
          'X-Correlation-ID': requestId,
        },
      },
    );
  } catch (error) {
    return functionErrorResponse(error, requestId);
  }
}

/** @deprecated Gateway ingress retired */
export async function handleSquareIngress(_request: Request, _env: BillingServiceEnv): Promise<Response> {
  return Response.json(
    {
      error: {
        code: 'GATEWAY_INGRESS_RETIRED',
        message: 'Gateway ingressは廃止されました。POST /webhooks/square を使用してください。',
      },
    },
    { status: 410, headers: { 'Cache-Control': 'no-store' } },
  );
}
