import {
  FunctionHttpError,
  functionErrorResponse,
  requestCorrelationId,
  requireAsteraActor,
} from '../../_account-projection';
import { ensureReadableReferralCode } from '../../_referral-code';
import {
  loadReferralPolicy,
  parseReferralMilestones,
  rewardCodeDigest,
  type RewardProgramEnv,
} from '../../_reward-programs';

type PagesContext = { request: Request; env: RewardProgramEnv };

type ReferralRow = {
  id: string;
  referrer_user_id: string;
  referred_user_id: string;
  state: string;
  risk_level: string;
  created_at: string;
};

async function status(context: PagesContext): Promise<Response> {
  const actor = await requireAsteraActor(context.request, context.env);
  const ownCode = await ensureReadableReferralCode(context.env, actor);
  const policy = await loadReferralPolicy(context.env.ASTERA_DB);
  const milestones = parseReferralMilestones(policy.milestones_json);
  const qualified = await context.env.ASTERA_DB.prepare(
    `SELECT COUNT(*) AS count FROM referrals
     WHERE referrer_user_id=?1 AND state IN ('qualified','rewarded')`,
  ).bind(actor.user.id).first<{ count: number }>();
  const rewarded = await context.env.ASTERA_DB.prepare(
    `SELECT threshold, cumulative_credit, delta_credit, state
     FROM referral_milestone_grants WHERE referrer_user_id=?1 ORDER BY threshold`,
  ).bind(actor.user.id).all<{ threshold: number; cumulative_credit: number; delta_credit: number; state: string }>();
  const referredBy = await context.env.ASTERA_DB.prepare(
    `SELECT id, referrer_user_id, referred_user_id, state, risk_level, created_at
     FROM referrals WHERE referred_user_id=?1 LIMIT 1`,
  ).bind(actor.user.id).first<ReferralRow>();

  const count = Number(qualified?.count ?? 0);
  const achieved = milestones.filter((milestone) => count >= milestone.threshold);
  const currentCumulative = achieved.length ? achieved[achieved.length - 1].cumulative_credit : 0;
  const next = milestones.find((milestone) => count < milestone.threshold) ?? null;
  return Response.json({
    referral: {
      code: ownCode.code,
      qualified_count: count,
      current_cumulative_credit: currentCumulative,
      next_milestone: next,
      milestones,
      grants: rewarded.results ?? [],
      referred_by_state: referredBy?.state ?? null,
      referred_reward_credit: policy.referred_reward_credit,
      policy_status: policy.status,
    },
  }, { headers: { 'Cache-Control': 'no-store' } });
}

async function apply(context: PagesContext): Promise<Response> {
  const actor = await requireAsteraActor(context.request, context.env);
  const policy = await loadReferralPolicy(context.env.ASTERA_DB);
  if (policy.status !== 'active') throw new FunctionHttpError(409, 'REFERRAL_PAUSED', '友達紹介は現在一時停止中です。');
  const body = await context.request.json().catch(() => null) as { code?: unknown } | null;
  const digest = await rewardCodeDigest(context.env, body?.code);
  const owner = await context.env.ASTERA_DB.prepare(
    `SELECT user_id FROM referral_codes WHERE code_digest=?1 AND status='active' LIMIT 1`,
  ).bind(digest).first<{ user_id: string }>();
  if (!owner) throw new FunctionHttpError(404, 'REFERRAL_CODE_INVALID', '紹介コードを確認してください。');
  if (owner.user_id === actor.user.id) throw new FunctionHttpError(409, 'SELF_REFERRAL_REJECTED', '自分の紹介コードは利用できません。');

  const existing = await context.env.ASTERA_DB.prepare(
    `SELECT id, referrer_user_id, state FROM referrals WHERE referred_user_id=?1 LIMIT 1`,
  ).bind(actor.user.id).first<{ id: string; referrer_user_id: string; state: string }>();
  if (existing) {
    if (existing.referrer_user_id === owner.user_id) {
      return Response.json({ referral_id: existing.id, state: existing.state }, { headers: { 'Cache-Control': 'no-store' } });
    }
    throw new FunctionHttpError(409, 'REFERRAL_ALREADY_BOUND', '紹介元はすでに確定しています。');
  }

  const circular = await context.env.ASTERA_DB.prepare(
    `SELECT id FROM referrals WHERE referrer_user_id=?1 AND referred_user_id=?2 LIMIT 1`,
  ).bind(actor.user.id, owner.user_id).first<{ id: string }>();
  if (circular) throw new FunctionHttpError(409, 'CIRCULAR_REFERRAL_REJECTED', '相互紹介はReward対象外です。');

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const result = await context.env.ASTERA_DB.prepare(
    `INSERT INTO referrals
     (id, referrer_user_id, referred_user_id, referral_code_digest, state, risk_level, created_at, updated_at)
     VALUES (?1,?2,?3,?4,'pending','low',?5,?5)`,
  ).bind(id, owner.user_id, actor.user.id, digest, now).run();
  if (result.success === false) throw new FunctionHttpError(503, 'REFERRAL_CREATE_FAILED', '紹介登録を完了できませんでした。');
  return Response.json({ referral_id: id, state: 'pending' }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
}

export async function onRequest(context: PagesContext): Promise<Response> {
  const requestId = requestCorrelationId(context.request);
  try {
    if (context.request.method === 'GET') return await status(context);
    if (context.request.method === 'POST') return await apply(context);
    return Response.json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'GETまたはPOSTを使用してください。', correlation_id: requestId } }, { status: 405 });
  } catch (error) {
    return functionErrorResponse(error, requestId);
  }
}
