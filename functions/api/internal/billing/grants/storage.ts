import { handleInternalBillingPost, onInternalBillingMethodGuard, type InternalBillingEnv } from '../../../../_internal-billing-projection';

type PagesContext = { request: Request; env: InternalBillingEnv };

export function onRequest(context: PagesContext): Promise<Response> {
  const blocked = onInternalBillingMethodGuard(context);
  if (blocked) return blocked;
  return handleInternalBillingPost(context, 'grants.storage');
}
