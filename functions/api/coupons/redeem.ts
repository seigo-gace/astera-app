import {
  FunctionHttpError,
  functionErrorResponse,
  requestCorrelationId,
  requireAsteraActor,
} from '../../_account-projection';
import {
  applyRewardItems,
  loadCouponProjection,
  parseRewardItems,
  requestFingerprint,
  rewardCodeDigest,
  rewardSummary,
  validateCouponForActor,
  type RewardProgramEnv,
} from '../../_reward-programs';

type PagesContext = { request: Request; env: RewardProgramEnv };

type RedemptionRow = {
  id: string;
  state: 'reserved' | 'applying' | 'applied' | 'failed' | 'reconcile_required' | 'revoked';
  reward_package_id: string;
  applied_at: string | null;
  error_code: string | null;
};

async function loadExisting(env: RewardProgramEnv, userId: string, requestId: string): Promise<RedemptionRow | null> {
  return env.ASTERA_DB.prepare(
    `SELECT id, state, reward_package_id, applied_at, error_code
     FROM coupon_redemptions WHERE user_id=?1 AND client_request_id=?2 LIMIT 1`,
  ).bind(userId, requestId).first<RedemptionRow>();
}

function successResponse(row: RedemptionRow, requestId: string): Response {
  return Response.json({
    redemption_id: row.id,
    state: row.state,
    reward_package_id: row.reward_package_id,
    applied_at: row.applied_at,
  }, { headers: { 'Cache-Control': 'no-store', 'X-Correlation-ID': requestId } });
}

async function releaseCapacity(env: RewardProgramEnv, digest: string, campaignId: string, releaseCode: boolean, releaseCampaign: boolean): Promise<void> {
  const now = new Date().toISOString();
  const statements = [];
  if (releaseCode) {
    statements.push(env.ASTERA_DB.prepare(
      `UPDATE coupon_code_projection
       SET redeemed_count=CASE WHEN redeemed_count>0 THEN redeemed_count-1 ELSE 0 END,
           status=CASE WHEN status='exhausted' THEN 'active' ELSE status END,
           updated_at=?1
       WHERE code_digest=?2`,
    ).bind(now, digest));
  }
  if (releaseCampaign) {
    statements.push(env.ASTERA_DB.prepare(
      `UPDATE coupon_campaign_projection
       SET redeemed_count=CASE WHEN redeemed_count>0 THEN redeemed_count-1 ELSE 0 END,
           status=CASE WHEN status='exhausted' THEN 'active' ELSE status END,
           updated_at=?1
       WHERE id=?2`,
    ).bind(now, campaignId));
  }
  if (statements.length) await env.ASTERA_DB.batch(statements);
}

export async function onRequest(context: PagesContext): Promise<Response> {
  const correlationId = requestCorrelationId(context.request);
  let redemptionId = '';
  let digest = '';
  let campaignId = '';
  let codeCapacityClaimed = false;
  let campaignCapacityClaimed = false;
  let rewardStarted = false;
  try {
    if (context.request.method !== 'POST') {
      return Response.json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'POSTを使用してください。', correlation_id: correlationId } }, { status: 405 });
    }
    const actor = await requireAsteraActor(context.request, context.env);
    const body = await context.request.json().catch(() => null) as { code?: unknown; client_request_id?: unknown } | null;
    const clientRequestId = typeof body?.client_request_id === 'string' && body.client_request_id.trim()
      ? body.client_request_id.trim()
      : context.request.headers.get('Idempotency-Key')?.trim() || correlationId;
    if (clientRequestId.length > 128) throw new FunctionHttpError(400, 'CLIENT_REQUEST_ID_INVALID', 'Request IDが不正です。');

    const prior = await loadExisting(context.env, actor.user.id, clientRequestId);
    if (prior?.state === 'applied') return successResponse(prior, correlationId);
    if (prior && prior.state !== 'failed') {
      throw new FunctionHttpError(409, 'REDEMPTION_IN_PROGRESS', 'このコードの適用処理を確認しています。再度お試しください。', { redemption_id: prior.id, state: prior.state });
    }

    digest = await rewardCodeDigest(context.env, body?.code);
    const coupon = await validateCouponForActor(
      context.env.ASTERA_DB,
      actor,
      await loadCouponProjection(context.env.ASTERA_DB, digest),
    );
    campaignId = coupon.campaign_id;
    const items = parseRewardItems(coupon.items_json);

    const countRow = await context.env.ASTERA_DB.prepare(
      `SELECT COUNT(*) AS count FROM coupon_redemptions
       WHERE campaign_id=?1 AND user_id=?2`,
    ).bind(coupon.campaign_id, actor.user.id).first<{ count: number }>();
    const redemptionSeq = Number(countRow?.count ?? 0) + 1;
    redemptionId = crypto.randomUUID();
    const fingerprint = await requestFingerprint([
      actor.user.id,
      actor.profile.tenant_id,
      coupon.campaign_id,
      coupon.reward_package_id,
      coupon.reward_version,
      clientRequestId,
      rewardSummary(items),
    ]);
    const now = new Date().toISOString();

    await context.env.ASTERA_DB.prepare(
      `INSERT OR IGNORE INTO coupon_redemptions
       (id, code_digest, campaign_id, reward_package_id, user_id, tenant_id, redemption_seq, state,
        client_request_id, request_fingerprint, created_at, updated_at)
       VALUES (?1,?2,?3,?4,?5,?6,?7,'reserved',?8,?9,?10,?10)`,
    ).bind(redemptionId, digest, coupon.campaign_id, coupon.reward_package_id, actor.user.id, actor.profile.tenant_id, redemptionSeq, clientRequestId, fingerprint, now).run();

    const reserved = await loadExisting(context.env, actor.user.id, clientRequestId);
    if (!reserved) throw new FunctionHttpError(409, 'USED', 'すでに使用されています。');
    redemptionId = reserved.id;
    if (reserved.state === 'applied') return successResponse(reserved, correlationId);

    const codeClaim = await context.env.ASTERA_DB.prepare(
      `UPDATE coupon_code_projection
       SET redeemed_count=redeemed_count+1,
           status=CASE WHEN redeemed_count+1 >= redemption_limit THEN 'exhausted' ELSE status END,
           updated_at=?1
       WHERE code_digest=?2 AND status='active' AND redeemed_count < redemption_limit
       RETURNING code_digest`,
    ).bind(now, digest).first<{ code_digest: string }>();
    if (!codeClaim) throw new FunctionHttpError(409, 'USED', 'すでに使用されています。');
    codeCapacityClaimed = true;

    const campaignClaim = await context.env.ASTERA_DB.prepare(
      `UPDATE coupon_campaign_projection
       SET redeemed_count=redeemed_count+1,
           status=CASE WHEN total_limit IS NOT NULL AND redeemed_count+1 >= total_limit THEN 'exhausted' ELSE status END,
           updated_at=?1
       WHERE id=?2 AND status='active' AND (total_limit IS NULL OR redeemed_count < total_limit)
       RETURNING id`,
    ).bind(now, coupon.campaign_id).first<{ id: string }>();
    if (!campaignClaim) {
      await releaseCapacity(context.env, digest, coupon.campaign_id, true, false);
      codeCapacityClaimed = false;
      throw new FunctionHttpError(409, 'LIMIT_REACHED', '利用上限に達しています。');
    }
    campaignCapacityClaimed = true;

    const applying = await context.env.ASTERA_DB.prepare(
      `UPDATE coupon_redemptions SET state='applying', updated_at=?1 WHERE id=?2 AND state IN ('reserved','failed') RETURNING id`,
    ).bind(new Date().toISOString(), redemptionId).first<{ id: string }>();
    if (!applying) throw new FunctionHttpError(409, 'REDEMPTION_IN_PROGRESS', 'このコードの適用処理を確認しています。再度お試しください。');

    rewardStarted = true;
    const application = await applyRewardItems(context.env.ASTERA_DB, actor, items, {
      referenceType: 'coupon_redemption',
      referenceId: redemptionId,
      fingerprint,
    });

    const appliedAt = new Date().toISOString();
    const finalized = await context.env.ASTERA_DB.prepare(
      `UPDATE coupon_redemptions SET state='applied', error_code=NULL, applied_at=?1, updated_at=?1
       WHERE id=?2 AND state='applying' RETURNING id`,
    ).bind(appliedAt, redemptionId).first<{ id: string }>();
    if (!finalized) {
      await context.env.ASTERA_DB.prepare(
        `UPDATE coupon_redemptions SET state='reconcile_required', error_code='FINALIZE_FAILED', updated_at=?1 WHERE id=?2`,
      ).bind(new Date().toISOString(), redemptionId).run();
      throw new FunctionHttpError(503, 'RECONCILE_REQUIRED', 'Rewardは適用済みの可能性があります。二重付与せず状態を確認します。', { redemption_id: redemptionId });
    }

    return Response.json({
      redemption_id: redemptionId,
      state: 'applied',
      reward_package_id: coupon.reward_package_id,
      reward_summary: rewardSummary(items),
      credit_transactions: application.creditTransactions,
      entitlement_ids: application.entitlementIds,
      schedule_ids: application.scheduleIds,
      applied_at: appliedAt,
    }, { headers: { 'Cache-Control': 'no-store', 'X-Correlation-ID': correlationId } });
  } catch (error) {
    if (redemptionId && !rewardStarted && (codeCapacityClaimed || campaignCapacityClaimed)) {
      try {
        await releaseCapacity(context.env, digest, campaignId, codeCapacityClaimed, campaignCapacityClaimed);
        codeCapacityClaimed = false;
        campaignCapacityClaimed = false;
      } catch {
        // Capacity release failure is surfaced through redemption reconcile state below.
      }
    }
    if (redemptionId && error instanceof Error && !(error instanceof FunctionHttpError && error.code === 'RECONCILE_REQUIRED')) {
      try {
        await context.env.ASTERA_DB.prepare(
          `UPDATE coupon_redemptions
           SET state=CASE WHEN ?1=1 THEN 'reconcile_required' ELSE 'failed' END,
               error_code=?2, updated_at=?3
           WHERE id=?4 AND state<>'applied'`,
        ).bind(rewardStarted ? 1 : 0, error instanceof FunctionHttpError ? error.code : 'REWARD_APPLICATION_FAILED', new Date().toISOString(), redemptionId).run();
      } catch {
        // Original error is preserved. Recovery is handled by reconcile_required/audit flow.
      }
    }
    return functionErrorResponse(error, correlationId);
  }
}
