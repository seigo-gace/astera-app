import type { ActorContext, CreditMutation, DeterministicJapaneseMcpConnectionPolicy } from '../../../packages/contracts/src/index';

export const CLOUDFLARE_FUNCTION_ROUTES = [
  '/api/catalog/public',
  '/api/account',
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/email/verify',
  '/api/auth/2fa/verify',
  '/api/billing/checkout-intents',
  '/api/credit/balance',
  '/api/jobs/estimate',
  '/api/jobs',
  '/api/preferences',
  '/api/storage/destinations',
  '/api/developer/keys',
] as const;

export type CloudflareFunctionContext = {
  actor?: ActorContext;
  correlationId: string;
  mcpPolicy?: DeterministicJapaneseMcpConnectionPolicy;
};

export type VerifiedSquareCreditEvent = {
  providerEventId: string;
  signatureVerified: true;
  catalogVersion: string;
  mutation: CreditMutation;
};

export const cloudflareFunctionsReadiness = {
  status: 'contract_source_only',
  deployed: false,
  d1MigrationApplied: false,
  squareWebhookVerified: false,
  authProviderConnected: false,
} as const;

export function notImplementedResponse(feature: string, correlationId: string): Response {
  return Response.json(
    {
      error: {
        code: 'BACKEND_NOT_IMPLEMENTED',
        message: `${feature}はBackend実装・配備前です。`,
        correlationId,
        retryable: false,
      },
    },
    { status: 501 },
  );
}
