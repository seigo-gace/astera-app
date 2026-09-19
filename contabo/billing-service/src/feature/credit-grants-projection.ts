import type { AsteraProjectionClient } from './astera-projection.js';
import { monthlyIncludedCreditsForPlan, type BillingCycle } from './catalog.js';

const LIVE_PLAN_STATES = new Set(['active', 'paused', 'grace', 'cancel_pending']);

function grantPeriodUtc(date = new Date()): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

async function postCreditGrantViaProjection(
  projection: AsteraProjectionClient,
  tenantId: string,
  userId: string,
  creditAccountId: string,
  amount: number,
  referenceType: string,
  referenceId: string,
  idempotencyKey: string,
  correlationId: string,
): Promise<void> {
  if (!Number.isSafeInteger(amount) || amount <= 0) return;
  await projection.postCreditGrant({
    tenant_id: tenantId,
    user_id: userId,
    credit_account_id: creditAccountId,
    amount,
    reference_type: referenceType,
    reference_id: referenceId,
    idempotency_key: idempotencyKey,
    correlation_id: correlationId,
    billing_intent_id: null,
  });
}

export async function ensureFreeTenantWelcomeGrantsViaProjection(
  projection: AsteraProjectionClient,
  tenantId: string,
  userId: string,
  creditAccountId: string,
  correlationId: string,
): Promise<void> {
  const catalog = await projection.getCatalog();
  const freePlan = catalog.plans.find((plan) => plan.plan_id === 'free');
  const included = Number(freePlan?.included_credits ?? 10000);
  const bonus = 10000;
  await postCreditGrantViaProjection(
    projection,
    tenantId,
    userId,
    creditAccountId,
    included,
    'tenant_free_first_month',
    tenantId,
    `tenant-free-first-month:${tenantId}`,
    correlationId,
  );
  await postCreditGrantViaProjection(
    projection,
    tenantId,
    userId,
    creditAccountId,
    bonus,
    'tenant_free_signup_bonus',
    tenantId,
    `tenant-free-signup-bonus:${tenantId}`,
    correlationId,
  );
}

export async function ensureMonthlyIncludedGrantForTenant(
  projection: AsteraProjectionClient,
  tenantId: string,
  userId: string,
  creditAccountId: string,
  options: { eventId?: string; now?: Date; correlationId?: string } = {},
): Promise<boolean> {
  const now = options.now ?? new Date();
  const correlationId = options.correlationId ?? crypto.randomUUID();
  const catalog = await projection.getCatalog();
  const subscription = await projection.getSubscription(tenantId);
  let planId = typeof subscription?.plan_id === 'string' ? subscription.plan_id.trim().toLowerCase() : 'free';
  let billingCycle: BillingCycle = subscription?.billing_cycle === 'annual' ? 'annual' : 'monthly';
  let live = typeof subscription?.status === 'string' && LIVE_PLAN_STATES.has(subscription.status);

  if (!live || !subscription?.plan_id) {
    planId = 'free';
    billingCycle = 'monthly';
    live = true;
  }

  const plan = catalog.plans.find((entry) => entry.plan_id === planId);
  const included = plan ? monthlyIncludedCreditsForPlan(plan) : 0;
  if (included <= 0) return false;

  const grantPeriod = grantPeriodUtc(now);
  const referenceType = 'plan_monthly_included';
  const referenceId = `${tenantId}:${catalog.catalog_version}:${grantPeriod}:${billingCycle}`;
  const idempotencyKey = options.eventId
    ? `billing:${options.eventId}:monthly-included`
    : `lazy:${referenceId}`;

  if (planId === 'free') {
    const hasBonus = await projection.hasSignupBonus(creditAccountId, tenantId);
    if (!hasBonus) {
      await ensureFreeTenantWelcomeGrantsViaProjection(projection, tenantId, userId, creditAccountId, correlationId);
    }
    const profileCreated = await projection.getProfileCreatedAt(tenantId);
    if (profileCreated?.startsWith(grantPeriod)) {
      return false;
    }
  }

  await postCreditGrantViaProjection(
    projection,
    tenantId,
    userId,
    creditAccountId,
    included,
    referenceType,
    referenceId,
    idempotencyKey,
    correlationId,
  );
  return true;
}
