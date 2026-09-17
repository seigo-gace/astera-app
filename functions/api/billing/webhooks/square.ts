import { requestCorrelationId } from '../../../_account-projection';

// Direct Square ingress is retired; use webhook-gateway → astera-billing ingress.

type PagesContext = { request: Request };

export function onRequest(context: PagesContext): Promise<Response> {
  const requestId = requestCorrelationId(context.request);
  if (context.request.method !== 'POST') {
    return Promise.resolve(
      Response.json(
        { error: { code: 'METHOD_NOT_ALLOWED', message: 'POSTのみ対応しています。' } },
        { status: 405, headers: { 'X-Correlation-ID': requestId } },
      ),
    );
  }
  return Promise.resolve(
    Response.json(
      {
        error: {
          code: 'SQUARE_DIRECT_WEBHOOK_RETIRED',
          message: 'Square WebhookはGateway経由のみ受け付けます。',
        },
      },
      {
        status: 410,
        headers: { 'Cache-Control': 'no-store', 'X-Correlation-ID': requestId },
      },
    ),
  );
}
