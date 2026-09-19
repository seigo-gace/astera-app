import { FunctionHttpError } from '../part/billing-env.js';
import type { AsteraProjectionClient, BillingIntentRecord } from './astera-projection.js';
import type { BillingCycle } from './catalog.js';

const LIVE_SUBSCRIPTION_STATUSES = new Set(['active', 'paused', 'grace', 'cancel_pending', 'past_due']);
const PENDING_PLAN_STATUSES = new Set([
  'creating_checkout',
  'checkout_created',
  'payment_pending',
]);

export type PlanCheckoutReuse = {
  reuse: true;
  intent: BillingIntentRecord;
};

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isLiveSubscription(subscription: Record<string, unknown> | null): boolean {
  if (!subscription) return false;
  const providerId = text(subscription.provider_subscription_id);
  const status = text(subscription.status).toLowerCase();
  if (!providerId) return false;
  if (['none', 'cancelled', 'canceled', 'failed'].includes(status)) return false;
  return LIVE_SUBSCRIPTION_STATUSES.has(status) || Boolean(providerId);
}

function isExpired(intent: BillingIntentRecord, nowIso: string): boolean {
  const expiresAt = text(intent['expires_at']);
  return Boolean(expiresAt) && expiresAt <= nowIso;
}

function intentStatus(intent: BillingIntentRecord): string {
  return text(intent['status']);
}

function intentIdOf(intent: BillingIntentRecord): string {
  return text(intent['id']);
}

function intentCheckoutUrl(intent: BillingIntentRecord): string {
  return text(intent['checkout_url']);
}

/**
 * Plan checkout gate (Payment Authority).
 * Order: live subscription first, then genuine pending reuse / terminalize stale.
 */
export async function assertOrReusePlanCheckout(
  projection: AsteraProjectionClient,
  input: {
    tenantId: string;
    userId: string;
    planId: string;
    billingCycle: BillingCycle;
    correlationId: string;
  },
): Promise<PlanCheckoutReuse | null> {
  const nowIso = new Date().toISOString();
  const subscription = await projection.getSubscription(input.tenantId);
  const live = isLiveSubscription(subscription);

  if (live) {
    const currentPlan = text(subscription?.plan_id).toLowerCase();
    const currentCycle = text(subscription?.billing_cycle).toLowerCase() || 'monthly';
    if (currentPlan === input.planId && currentCycle === input.billingCycle) {
      // Stale pending must not mask an already-active subscription.
      await terminalizeSupersededPlanIntents(projection, input, nowIso);
      throw new FunctionHttpError(409, 'SUBSCRIPTION_ALREADY_ACTIVE', '選択したPlanと請求周期は既に契約中です。');
    }
    throw new FunctionHttpError(
      409,
      'SUBSCRIPTION_CHANGE_REQUIRES_SWAP',
      '既存SubscriptionのPlanまたは請求周期変更は新規Checkoutでは行えません。Plan変更APIを使用してください。',
      {
        current_plan_id: currentPlan || null,
        current_billing_cycle: currentCycle,
        requested_plan_id: input.planId,
        requested_billing_cycle: input.billingCycle,
      },
    );
  }

  const pending = await projection.getLatestPendingPlanIntent(input.tenantId, nowIso);
  if (!pending) return null;

  const status = intentStatus(pending);
  const id = intentIdOf(pending);
  const checkoutUrl = intentCheckoutUrl(pending);
  if (status === 'completed') return null;

  if (isExpired(pending, nowIso) || status === 'failed' || status === 'cancelled') {
    if (PENDING_PLAN_STATUSES.has(status)) {
      await markPlanIntentFailed(
        projection,
        input,
        id,
        isExpired(pending, nowIso) ? 'CHECKOUT_EXPIRED' : 'CHECKOUT_TERMINAL',
      );
    }
    return null;
  }

  if (status === 'reconciliation_required') {
    throw new FunctionHttpError(
      409,
      'PLAN_CHECKOUT_RECONCILIATION_REQUIRED',
      '既存の支払い済みPlan請求は再照合中のため、新規Checkoutは作成できません。',
      { intent_id: id, status, failure_code: text(pending['failure_code']) || 'SUBSCRIPTION_ID_RECONCILIATION_REQUIRED' },
    );
  }

  if (checkoutUrl && (status === 'checkout_created' || status === 'payment_pending')) {
    return { reuse: true, intent: pending };
  }

  if (status === 'creating_checkout' && !checkoutUrl) {
    throw new FunctionHttpError(409, 'CHECKOUT_INTENT_IN_PROGRESS', '同じCheckout Intentを作成中です。', {
      intent_id: id,
      status,
    });
  }

  // Genuine active checkout without URL should not soft-lock the user forever.
  throw new FunctionHttpError(
    409,
    'PLAN_CHECKOUT_ALREADY_PENDING',
    '既存のPlan契約処理が完了していません。Billing状態を確認してから再試行してください。',
    { intent_id: id, status },
  );
}

async function terminalizeSupersededPlanIntents(
  projection: AsteraProjectionClient,
  input: { tenantId: string; userId: string; correlationId: string },
  nowIso: string,
): Promise<void> {
  const pending = await projection.listPendingPlanIntents(input.tenantId, nowIso);
  for (const intent of pending) {
    const status = intentStatus(intent);
    const id = intentIdOf(intent);
    if (!PENDING_PLAN_STATUSES.has(status) || !id) continue;
    await markPlanIntentFailed(projection, input, id, 'SUPERSEDED_BY_ACTIVE_SUBSCRIPTION');
  }
}

async function markPlanIntentFailed(
  projection: AsteraProjectionClient,
  input: { tenantId: string; userId: string; correlationId: string },
  intentId: string,
  failureCode: string,
): Promise<void> {
  try {
    await projection.postIntentStatus({
      intent_id: intentId,
      billing_intent_id: intentId,
      tenant_id: input.tenantId,
      user_id: input.userId,
      status: 'failed',
      failure_code: failureCode,
      idempotency_key: `plan-terminal:${intentId}:${failureCode}`,
      correlation_id: input.correlationId,
    });
  } catch {
    // Best-effort heal: do not mask the primary checkout decision.
  }
}
