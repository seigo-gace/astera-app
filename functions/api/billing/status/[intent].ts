import {
  FunctionHttpError,
  functionErrorResponse,
  requestCorrelationId,
  requireAsteraActor,
  type AsteraFunctionEnv,
} from '../../../_account-projection';

type PagesContext = { request: Request; env: AsteraFunctionEnv; params: { intent?: string } };

type BillingIntentRow = {
  id: string;
  tenant_id: string;
  catalog_version: string;
  product_id: string;
  product_kind: string;
  currency: string;
  amount: number;
  credit_amount: number;
  status: string;
  provider_checkout_id: string | null;
  provider_order_id: string | null;
  provider_payment_id: string | null;
  checkout_url: string | null;
  return_context_id: string | null;
  expires_at: string | null;
  completed_at: string | null;
  failure_code: string | null;
  created_at: string;
  updated_at: string;
};

export async function onRequestGet(context: PagesContext): Promise<Response> {
  const requestId = requestCorrelationId(context.request);
  try {
    const actor = await requireAsteraActor(context.request, context.env);
    const intentId = context.params.intent?.trim();
    if (!intentId) throw new FunctionHttpError(400, 'INTENT_ID_REQUIRED', 'Billing Intent IDが必要です。');
    const intent = await context.env.ASTERA_DB.prepare(
      `SELECT id, tenant_id, catalog_version, product_id, product_kind, currency, amount, credit_amount,
              status, provider_checkout_id, provider_order_id, provider_payment_id, checkout_url,
              return_context_id, expires_at, completed_at, failure_code, created_at, updated_at
       FROM billing_intents WHERE id = ?1 AND tenant_id = ?2 LIMIT 1`,
    ).bind(intentId, actor.profile.tenant_id).first<BillingIntentRow>();
    if (!intent) throw new FunctionHttpError(404, 'BILLING_INTENT_NOT_FOUND', 'Billing Intentが見つかりません。');

    const grant = await context.env.ASTERA_DB.prepare(
      `SELECT transaction_id, amount, created_at
       FROM credit_ledger
       WHERE credit_account_id = ?1 AND reference_type = 'billing_intent' AND reference_id = ?2 AND kind = 'grant'
       LIMIT 1`,
    ).bind(actor.credit.id, intentId).first<{ transaction_id: string; amount: number; created_at: string }>();

    return Response.json({
      intent_id: intent.id,
      status: intent.status,
      product_kind: intent.product_kind,
      product_id: intent.product_id,
      catalog_version: intent.catalog_version,
      money: { amount: Number(intent.amount), currency: intent.currency },
      credit_amount: Number(intent.credit_amount),
      provider_checkout_id: intent.provider_checkout_id,
      provider_order_id: intent.provider_order_id,
      provider_payment_id: intent.provider_payment_id,
      return_context_id: intent.return_context_id,
      expires_at: intent.expires_at,
      completed_at: intent.completed_at,
      failure_code: intent.failure_code,
      created_at: intent.created_at,
      updated_at: intent.updated_at,
      credit_posted: Boolean(grant),
      credit_transaction: grant ?? null,
      resume_mode: intent.status === 'completed' ? 'user_confirm' : 'wait_for_webhook',
    }, { headers: { 'Cache-Control': 'no-store', 'X-Correlation-ID': requestId } });
  } catch (error) {
    return functionErrorResponse(error, requestId);
  }
}

export function onRequest(context: PagesContext): Promise<Response> {
  if (context.request.method !== 'GET') {
    return Promise.resolve(Response.json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'GETのみ対応しています。' } }, { status: 405 }));
  }
  return onRequestGet(context);
}
