import type { D1Database } from './_account-projection';
import { loadActiveCatalog, loadTenantSubscription, type BillingCycle } from './_catalog';

type CreditAccountRow = { id: string; tenant_id: string };

const LIVE_PLAN_STATES = new Set(['active', 'paused', 'grace', 'cancel_pending']);

function grantPeriodUtc(date = new Date()): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

async function postGrant(
  db: D1Database,
  creditAccountId: string,
  amount: number,
  referenceType: string,
  referenceId: string,
  idempotencyKey: string,
  fingerprint: string,
): Promise<boolean> {
  if (!Number.isSafeInteger(amount) || amount <= 0) return false;
  const now = new Date().toISOString();
  const transactionId = `grant:${referenceType}:${referenceId}`;
  const batchResult = await db.batch([
    db.prepare(
      `UPDATE credit_accounts
       SET available_balance = available_balance + ?1, version = version + 1, updated_at = ?2
       WHERE id = ?3
         AND NOT EXISTS (
           SELECT 1 FROM credit_ledger
           WHERE reference_type = ?4 AND reference_id = ?5 AND kind = 'grant'
         )`,
    ).bind(amount, now, creditAccountId, referenceType, referenceId),
    db.prepare(
      `INSERT OR IGNORE INTO credit_ledger
        (transaction_id, credit_account_id, kind, amount, idempotency_key, reference_type, reference_id, request_fingerprint, created_at)
       VALUES (?1, ?2, 'grant', ?3, ?4, ?5, ?6, ?7, ?8)`,
    ).bind(transactionId, creditAccountId, amount, idempotencyKey, referenceType, referenceId, fingerprint, now),
  ]);
  return batchResult.some((entry) => entry.success !== false);
}

export async function ensureFreeTenantWelcomeGrants(db: D1Database, tenantId: string, creditAccountId: string): Promise<void> {
  const catalog = await loadActiveCatalog(db);
  const freePlan = catalog.plans.find((plan) => plan.plan_id === 'free');
  const included = Number(freePlan?.included_credits ?? 10000);
  const bonus = 10000;
  await postGrant(
    db,
    creditAccountId,
    included,
    'tenant_free_first_month',
    tenantId,
    `tenant-free-first-month:${tenantId}`,
    JSON.stringify({ tenant_id: tenantId, kind: 'first_month_included', catalog_version: catalog.catalog_version }),
  );
  await postGrant(
    db,
    creditAccountId,
    bonus,
    'tenant_free_signup_bonus',
    tenantId,
    `tenant-free-signup-bonus:${tenantId}`,
    JSON.stringify({ tenant_id: tenantId, kind: 'signup_bonus', catalog_version: catalog.catalog_version }),
  );
}

export async function ensureMonthlyIncludedGrantForTenant(
  db: D1Database,
  tenantId: string,
  creditAccountId: string,
  options: { eventId?: string; now?: Date } = {},
): Promise<boolean> {
  const now = options.now ?? new Date();
  const catalog = await loadActiveCatalog(db);
  const subscription = await loadTenantSubscription(db, tenantId);
  let planId = subscription?.plan_id?.trim().toLowerCase() ?? 'free';
  let billingCycle: BillingCycle = subscription?.billing_cycle ?? 'monthly';
  let live = subscription?.status && LIVE_PLAN_STATES.has(subscription.status);

  if (!live || !subscription?.plan_id) {
    planId = 'free';
    billingCycle = 'monthly';
    live = true;
  }

  const plan = catalog.plans.find((entry) => entry.plan_id === planId);
  const included = Number(plan?.included_credits ?? 0);
  if (included <= 0) return false;

  const grantPeriod = grantPeriodUtc(now);
  const referenceType = 'plan_monthly_included';
  const referenceId = `${tenantId}:${catalog.catalog_version}:${grantPeriod}:${billingCycle}`;
  const fingerprint = JSON.stringify({
    tenant_id: tenantId,
    plan_id: planId,
    catalog_version: catalog.catalog_version,
    grant_period: grantPeriod,
    billing_cycle: billingCycle,
    event_id: options.eventId ?? null,
  });
  const idempotencyKey = options.eventId
    ? `square:${options.eventId}:monthly-included`
    : `lazy:${referenceId}`;

  if (planId === 'free') {
    const existingBonus = await db.prepare(
      `SELECT transaction_id FROM credit_ledger
       WHERE credit_account_id = ?1 AND reference_type = 'tenant_free_signup_bonus' AND reference_id = ?2 LIMIT 1`,
    ).bind(creditAccountId, tenantId).first<{ transaction_id: string }>();
    if (!existingBonus?.transaction_id) {
      await ensureFreeTenantWelcomeGrants(db, tenantId, creditAccountId);
    }
    const profileCreated = await db.prepare(
      `SELECT created_at FROM user_profiles WHERE tenant_id = ?1 LIMIT 1`,
    ).bind(tenantId).first<{ created_at: string }>();
    if (profileCreated?.created_at?.startsWith(grantPeriod)) {
      return false;
    }
  }

  return postGrant(db, creditAccountId, included, referenceType, referenceId, idempotencyKey, fingerprint);
}

export async function grantMonthlyIncludedFromSquareEvent(
  db: D1Database,
  tenantId: string,
  eventId: string,
): Promise<boolean> {
  const credit = await db.prepare(
    `SELECT id FROM credit_accounts WHERE tenant_id = ?1 LIMIT 1`,
  ).bind(tenantId).first<CreditAccountRow>();
  if (!credit?.id) return false;
  return ensureMonthlyIncludedGrantForTenant(db, tenantId, credit.id, { eventId });
}
