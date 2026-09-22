import { FunctionHttpError, type BillingActorProjection, type BillingServiceEnv } from '../part/billing-env.js';
import { requireProjectionClient } from './astera-projection.js';
import { secretsEqual } from '../part/secure-compare.js';

function headerValue(request: Request, name: string): string {
  return request.headers.get(name)?.trim() ?? '';
}

function extractBearerSecret(request: Request): string {
  const bearer = headerValue(request, 'authorization').replace(/^Bearer\s+/i, '');
  const headerSecret = headerValue(request, 'x-astera-billing-secret');
  return bearer || headerSecret;
}

export function assertBillingApiAuth(request: Request, env: BillingServiceEnv): void {
  const configured = env.BILLING_APP_SECRET?.trim();
  if (!configured) {
    throw new FunctionHttpError(401, 'BILLING_API_UNAUTHORIZED', 'Billing API認証に失敗しました。');
  }
  const provided = extractBearerSecret(request);
  if (!provided || !secretsEqual(provided, configured)) {
    throw new FunctionHttpError(401, 'BILLING_API_UNAUTHORIZED', 'Billing API認証に失敗しました。');
  }
}

export async function requireBillingActor(request: Request, env: BillingServiceEnv): Promise<BillingActorProjection> {
  assertBillingApiAuth(request, env);
  const tenantId = headerValue(request, 'x-astera-tenant-id');
  const userId = headerValue(request, 'x-astera-user-id');
  const userEmail = headerValue(request, 'x-astera-user-email');
  const emailVerified = headerValue(request, 'x-astera-user-email-verified') === 'true';
  if (!tenantId || !userId) {
    throw new FunctionHttpError(400, 'BILLING_ACTOR_HEADERS_REQUIRED', 'x-astera-tenant-id と x-astera-user-id が必要です。');
  }

  const projection = requireProjectionClient(env);
  const { profile, credit } = await projection.getActor(tenantId, userId);

  return {
    user: { id: userId, email: userEmail, emailVerified, name: profile.nickname },
    profile,
    credit,
  };
}
