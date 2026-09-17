import type { AsteraActorProjection } from './_account-projection';
import { proxyBillingRequest, type BillingProxyEnv } from './_billing-service-proxy';

export async function callBillingEnsureGrants(
  env: BillingProxyEnv,
  request: Request,
  actor: AsteraActorProjection,
  requestId: string,
): Promise<void> {
  const response = await proxyBillingRequest(
    env,
    'POST',
    '/api/billing/ensure-grants',
    request,
    actor,
    requestId,
    '{}',
  );
  if (!response.ok && response.status !== 503) {
    // Catalog/bootstrap may be unavailable; grants retry on later reads.
    await response.body?.cancel();
  }
}
