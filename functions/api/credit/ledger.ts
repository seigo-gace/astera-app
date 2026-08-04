import { functionErrorResponse, requestCorrelationId, requireAsteraActor, type AsteraFunctionEnv } from '../../_account-projection';

type LedgerRow = {
  transaction_id: string;
  kind: string;
  amount: number;
  reference_type: string;
  reference_id: string;
  request_fingerprint: string;
  created_at: string;
};

type PagesContext = { request: Request; env: AsteraFunctionEnv };

function pageLimit(request: Request): number {
  const value = Number(new URL(request.url).searchParams.get('limit') ?? 50);
  if (!Number.isInteger(value)) return 50;
  return Math.min(100, Math.max(1, value));
}

export async function onRequestGet(context: PagesContext): Promise<Response> {
  const requestId = requestCorrelationId(context.request);
  try {
    const actor = await requireAsteraActor(context.request, context.env);
    const limit = pageLimit(context.request);
    const result = await context.env.ASTERA_DB.prepare(
      `SELECT transaction_id, kind, amount, reference_type, reference_id, request_fingerprint, created_at
       FROM credit_ledger
       WHERE credit_account_id = ?1
       ORDER BY created_at DESC, transaction_id DESC
       LIMIT ?2`,
    ).bind(actor.credit.id, limit).all<LedgerRow>();
    const entries = (result.results ?? []).map((row) => ({
      id: row.transaction_id,
      transaction_id: row.transaction_id,
      type: row.kind,
      kind: row.kind,
      amount: Number(row.amount),
      reference_type: row.reference_type,
      reference_id: row.reference_id,
      request_fingerprint: row.request_fingerprint,
      created_at: row.created_at,
      status: 'posted',
    }));
    return Response.json({ ledger: entries, entries, limit }, {
      headers: { 'Cache-Control': 'no-store', 'X-Correlation-ID': requestId },
    });
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
