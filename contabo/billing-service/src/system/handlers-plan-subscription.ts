import { FunctionHttpError, functionErrorResponse, requestCorrelationId, type BillingServiceEnv } from '../part/billing-env.js';
import { requireBillingActor } from '../feature/billing-auth.js';
import { requireProjectionClient } from '../feature/astera-projection.js';
import { createDirectPlanSubscription } from '../feature/square-plan-direct.js';

type Body = { billing_intent_id?: unknown; source_id?: unknown };
const ALLOWED_INTENT_STATUSES = new Set(['creating_checkout', 'checkout_created', 'payment_pending']);
const TERMINAL_SUBSCRIPTION_STATUSES = new Set(['none', 'cancelled', 'canceled', 'failed']);

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
function validEmail(value: string): boolean {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function existingProviderSubscription(subscription: Record<string, unknown> | null): boolean {
  if (!subscription) return false;
  const providerId = text(subscription.provider_subscription_id);
  const status = text(subscription.status).toLowerCase();
  return Boolean(providerId) && !TERMINAL_SUBSCRIPTION_STATUSES.has(status);
}

export async function handlePlanSubscription(request: Request, env: BillingServiceEnv): Promise<Response> {
  const requestId = requestCorrelationId(request.headers);
  try {
    const actor = await requireBillingActor(request, env);
    const projection = requireProjectionClient(env);
    const body = await request.json().catch(() => null) as Body | null;
    if (!body) throw new FunctionHttpError(400, 'PLAN_SUBSCRIPTION_BODY_INVALID', 'Request JSON is invalid.');
    const intentId = text(body.billing_intent_id);
    const sourceId = text(body.source_id);
    if (!intentId || !sourceId) throw new FunctionHttpError(422, 'PLAN_SUBSCRIPTION_FIELDS_REQUIRED', 'billing_intent_id and source_id are required.');
    if (sourceId.length > 512) throw new FunctionHttpError(422, 'SOURCE_ID_INVALID', 'source_id is invalid.');
    const email = actor.user.email.trim().toLowerCase();
    if (actor.user.emailVerified !== true || !validEmail(email)) {
      throw new FunctionHttpError(403, 'VERIFIED_EMAIL_REQUIRED', 'A verified account email is required.');
    }

    const current = await projection.getSubscription(actor.profile.tenant_id);
    if (existingProviderSubscription(current)) {
      throw new FunctionHttpError(409, 'SUBSCRIPTION_ALREADY_EXISTS', 'An active subscription already exists.');
    }

    const intent = await projection.getBillingIntentLookup({
      intent_id: intentId,
      tenant_id: actor.profile.tenant_id,
    });
    if (!intent) throw new FunctionHttpError(404, 'BILLING_INTENT_NOT_FOUND', 'Billing Intent was not found.');
    if (text(intent.tenant_id) !== actor.profile.tenant_id || text(intent.user_id) !== actor.user.id) {
      throw new FunctionHttpError(403, 'BILLING_INTENT_OWNERSHIP_MISMATCH', 'Billing Intent ownership did not match.');
    }
    if (text(intent.product_kind) !== 'plan') throw new FunctionHttpError(422, 'BILLING_INTENT_NOT_PLAN', 'Billing Intent is not a plan.');
    const intentStatus = text(intent.status);
    if (intentStatus === 'reconciliation_required' || !ALLOWED_INTENT_STATUSES.has(intentStatus)) {
      throw new FunctionHttpError(409, 'BILLING_INTENT_NOT_ACTIVE', 'Billing Intent is not eligible for direct subscription creation.');
    }
    const expiresAt = text(intent.expires_at);
    if (expiresAt && expiresAt <= new Date().toISOString()) throw new FunctionHttpError(409, 'BILLING_INTENT_EXPIRED', 'Billing Intent has expired.');

    const catalog = await projection.getCatalog();
    const catalogVersion = text(intent.catalog_version);
    const planId = text(intent.product_id);
    const billingCycle = text(intent.billing_cycle);
    const amount = Number(intent.amount);
    const currency = text(intent.currency);
    if (catalog.catalog_version !== catalogVersion) throw new FunctionHttpError(409, 'BILLING_CATALOG_VERSION_MISMATCH', 'Billing catalog version changed.');
    const plan = catalog.plans.find((entry) => entry.active && entry.plan_id === planId);
    const variant = plan?.billing_variants.find((entry) => entry.active && entry.billing_cycle === billingCycle);
    if (!plan || !variant || !variant.square_plan_variation_id) throw new FunctionHttpError(409, 'PLAN_CATALOG_MISMATCH', 'Plan catalog mapping did not match.');
    if (variant.recurring_amount !== amount) throw new FunctionHttpError(409, 'PLAN_AMOUNT_MISMATCH', 'Plan amount did not match the catalog.');
    if (plan.currency !== currency || currency !== 'JPY') throw new FunctionHttpError(409, 'PLAN_CURRENCY_MISMATCH', 'Plan currency did not match the catalog.');

    const square = await createDirectPlanSubscription(env, {
      intentId,
      tenantId: actor.profile.tenant_id,
      verifiedEmail: email,
      sourceId,
      planVariationId: variant.square_plan_variation_id,
    });
    await projection.postSubscription({
      tenant_id: actor.profile.tenant_id,
      user_id: actor.user.id,
      catalog_version: catalogVersion,
      plan_id: planId,
      billing_cycle: billingCycle,
      provider_subscription_id: square.subscriptionId,
      status: square.status,
      current_period_start: square.startDate,
      current_period_end: square.chargedThroughDate,
      cancel_at_period_end: false,
      idempotency_key: `plan-direct:${intentId}:subscription`,
      correlation_id: requestId,
    });
    await projection.postIntentStatus({
      intent_id: intentId,
      billing_intent_id: intentId,
      tenant_id: actor.profile.tenant_id,
      user_id: actor.user.id,
      status: 'checkout_created',
      failure_code: null,
      idempotency_key: `plan-direct:${intentId}:await-payment`,
      correlation_id: requestId,
    });
    return Response.json({
      intent_id: intentId,
      status: 'payment_pending',
      provider_subscription_id: square.subscriptionId,
    }, { status: 201, headers: { 'Cache-Control': 'no-store', 'X-Correlation-ID': requestId } });
  } catch (error) {
    return functionErrorResponse(error, requestId);
  }
}

export async function handlePublicBillingConfig(request: Request, env: BillingServiceEnv): Promise<Response> {
  const requestId = requestCorrelationId(request.headers);
  try {
    await requireBillingActor(request, env);
    const applicationId = env.SQUARE_APPLICATION_ID?.trim();
    const locationId = env.SQUARE_LOCATION_ID?.trim();
    if (!applicationId || !locationId) throw new FunctionHttpError(503, 'SQUARE_PUBLIC_CONFIG_NOT_CONFIGURED', 'Square public configuration is missing.');
    const production = env.SQUARE_ENVIRONMENT?.trim().toLowerCase() === 'production';
    return Response.json({
      application_id: applicationId,
      location_id: locationId,
      script_url: production ? 'https://web.squarecdn.com/v1/square.js' : 'https://sandbox.web.squarecdn.com/v1/square.js',
    }, { headers: { 'Cache-Control': 'no-store', 'X-Correlation-ID': requestId } });
  } catch (error) {
    return functionErrorResponse(error, requestId);
  }
}
