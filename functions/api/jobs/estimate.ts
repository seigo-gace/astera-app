import {
  FunctionHttpError,
  functionErrorResponse,
  requestCorrelationId,
  requireAsteraActor,
  type AsteraFunctionEnv,
} from '../../_account-projection';
import {
  calculateRequiredCredits,
  creditState,
  loadActiveCreditPolicy,
  normalizeEstimateInput,
  requestFingerprint,
} from '../../_job-policy';

type UploadRow = {
  id: string;
  size_bytes: number;
  sha256: string;
  private_mode: number;
  status: string;
  expires_at: string | null;
};

type Env = AsteraFunctionEnv & { PRIVATE_UPLOAD_TTL_SECONDS?: string };
type PagesContext = { request: Request; env: Env };

function privateUploadTtl(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 300) return 3600;
  return Math.min(24 * 60 * 60, parsed);
}

async function loadUploads(
  context: PagesContext,
  tenantId: string,
  userId: string,
  fileIds: string[],
  privateMode: boolean,
): Promise<UploadRow[]> {
  if (fileIds.length === 0) return [];
  const placeholders = fileIds.map((_, index) => `?${index + 3}`).join(', ');
  const result = await context.env.ASTERA_DB.prepare(
    `SELECT id, size_bytes, sha256, private_mode, status, expires_at
     FROM upload_objects
     WHERE tenant_id = ?1 AND user_id = ?2 AND id IN (${placeholders})`,
  ).bind(tenantId, userId, ...fileIds).all<UploadRow>();
  const rows = result.results ?? [];
  if (rows.length !== fileIds.length) throw new FunctionHttpError(409, 'UPLOAD_REFERENCE_NOT_FOUND', '指定されたFileの一部を確認できません。');
  const byId = new Map(rows.map((row) => [row.id, row]));
  const ordered = fileIds.map((id) => byId.get(id)).filter((row): row is UploadRow => Boolean(row));
  const now = Date.now();
  for (const row of ordered) {
    if (row.status !== 'ready') throw new FunctionHttpError(409, 'UPLOAD_NOT_READY', 'File UploadがReady状態ではありません。', { upload_id: row.id, status: row.status });
    if (row.expires_at && Date.parse(row.expires_at) <= now) throw new FunctionHttpError(409, 'UPLOAD_EXPIRED', 'Private Fileの有効期限が切れています。', { upload_id: row.id });
    if (privateMode && !Boolean(row.private_mode)) {
      const expiresAt = new Date(now + privateUploadTtl(context.env.PRIVATE_UPLOAD_TTL_SECONDS) * 1000).toISOString();
      const updated = await context.env.ASTERA_DB.prepare(
        `UPDATE upload_objects
         SET private_mode = 1, expires_at = ?1, updated_at = ?2
         WHERE id = ?3 AND tenant_id = ?4 AND user_id = ?5 AND status = 'ready' AND private_mode = 0`,
      ).bind(expiresAt, new Date(now).toISOString(), row.id, tenantId, userId).run();
      if (updated.success === false) throw new FunctionHttpError(409, 'UPLOAD_PRIVATE_PROMOTION_FAILED', 'FileをPrivate Modeへ切り替えられませんでした。', { upload_id: row.id });
      row.private_mode = 1;
      row.expires_at = expiresAt;
    } else if (!privateMode && Boolean(row.private_mode)) {
      throw new FunctionHttpError(409, 'PRIVATE_UPLOAD_NORMAL_JOB_FORBIDDEN', 'Private Fileを通常保存Jobへ戻すことはできません。', { upload_id: row.id });
    }
  }
  return ordered;
}

export async function onRequestPost(context: PagesContext): Promise<Response> {
  const requestId = requestCorrelationId(context.request);
  try {
    const actor = await requireAsteraActor(context.request, context.env);
    const input = normalizeEstimateInput(await context.request.json().catch(() => null));
    const [policy, uploads] = await Promise.all([
      loadActiveCreditPolicy(context.env.ASTERA_DB),
      loadUploads(context, actor.profile.tenant_id, actor.user.id, input.fileIds, input.privateMode),
    ]);
    const totalFileBytes = uploads.reduce((sum, row) => sum + Number(row.size_bytes), 0);
    if (!Number.isSafeInteger(totalFileBytes) || totalFileBytes < 0) {
      throw new FunctionHttpError(422, 'UPLOAD_SIZE_TOTAL_INVALID', 'File Size合計を計算できません。');
    }
    const fingerprint = await requestFingerprint(input, uploads.map((row) => `${row.id}:${row.sha256}:${row.size_bytes}`));
    const requiredCredits = calculateRequiredCredits(policy, input, totalFileBytes);
    const availableCredits = Number(actor.credit.available_balance);
    const reservedCredits = Number(actor.credit.reserved_balance);
    const usableCredits = Math.max(0, availableCredits - reservedCredits);
    const state = creditState(usableCredits, requiredCredits, policy);
    const estimateId = crypto.randomUUID();
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + policy.estimateTtlSeconds * 1000).toISOString();

    await context.env.ASTERA_DB.prepare(
      `INSERT INTO job_estimates
        (id, tenant_id, user_id, request_fingerprint, policy_version, required_credits,
         available_credits_snapshot, reserved_credits_snapshot, credit_account_version,
         credit_state, status, expires_at, created_at, consumed_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'active', ?11, ?12, NULL)`,
    ).bind(
      estimateId,
      actor.profile.tenant_id,
      actor.user.id,
      fingerprint,
      policy.version,
      requiredCredits,
      availableCredits,
      reservedCredits,
      Number(actor.credit.version),
      state,
      expiresAt,
      createdAt.toISOString(),
    ).run();

    return Response.json({
      estimate: {
        estimate_id: estimateId,
        estimateId,
        required_credits: requiredCredits,
        requiredCredits,
        available_credits: availableCredits,
        availableCredits,
        reserved_credits: reservedCredits,
        reservedCredits,
        usable_credits: usableCredits,
        credit_state: state,
        creditState: state,
        estimated_remaining_runs: requiredCredits > 0 ? Math.floor(Math.max(0, usableCredits - requiredCredits) / requiredCredits) : 0,
        policy_version: policy.version,
        policyVersion: policy.version,
        expires_at: expiresAt,
        expiresAt,
        request_fingerprint: fingerprint,
      },
    }, { status: 201, headers: { 'Cache-Control': 'no-store', 'X-Correlation-ID': requestId } });
  } catch (error) {
    return functionErrorResponse(error, requestId);
  }
}

export function onRequest(context: PagesContext): Promise<Response> {
  if (context.request.method !== 'POST') {
    return Promise.resolve(Response.json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'POSTのみ対応しています。' } }, { status: 405 }));
  }
  return onRequestPost(context);
}
