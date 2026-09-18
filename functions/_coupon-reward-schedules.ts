import type { AsteraActorProjection } from './_account-projection';
import { grantCredit, requestFingerprint, type CouponProgramEnv } from './_coupon-program';

type ScheduleRow = {
  id: string;
  amount: number;
  remaining_grants: number;
  grants_applied: number;
  cadence_months: number;
  next_grant_at: string;
  reference_type: string;
  reference_id: string;
};

function addMonths(iso: string, months: number): string {
  const date = new Date(iso);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString();
}

export async function applyDueCouponSchedules(env: CouponProgramEnv, actor: AsteraActorProjection): Promise<number> {
  let applied = 0;
  const now = new Date().toISOString();
  for (let safety = 0; safety < 24; safety += 1) {
    const row = await env.ASTERA_DB.prepare(
      `SELECT id,amount,remaining_grants,grants_applied,cadence_months,next_grant_at,reference_type,reference_id
       FROM reward_credit_schedules
       WHERE tenant_id=?1 AND user_id=?2 AND status='active' AND reference_type='coupon_redemption'
         AND next_grant_at IS NOT NULL AND next_grant_at<=?3
       ORDER BY next_grant_at ASC LIMIT 1`,
    ).bind(actor.profile.tenant_id, actor.user.id, now).first<ScheduleRow>();
    if (!row) break;
    const grantNumber = Number(row.grants_applied) + 1;
    const fingerprint = await requestFingerprint([row.id, grantNumber, row.amount, row.next_grant_at]);
    await grantCredit(env.ASTERA_DB, actor, Number(row.amount), {
      idempotencyKey: `${row.id}:grant:${grantNumber}`,
      referenceType: 'coupon_redemption',
      referenceId: `${row.reference_id}:grant:${grantNumber}`,
      fingerprint,
    });
    const remaining = Math.max(0, Number(row.remaining_grants) - 1);
    const nextGrantAt = remaining === 0 ? null : addMonths(row.next_grant_at, Number(row.cadence_months));
    const result = await env.ASTERA_DB.prepare(
      `UPDATE reward_credit_schedules
       SET remaining_grants=?1,grants_applied=?2,next_grant_at=?3,status=?4,updated_at=?5
       WHERE id=?6 AND grants_applied=?7`,
    ).bind(remaining, grantNumber, nextGrantAt, remaining === 0 ? 'completed' : 'active', new Date().toISOString(), row.id, row.grants_applied).run();
    if (result.success === false) break;
    applied += 1;
  }
  return applied;
}
