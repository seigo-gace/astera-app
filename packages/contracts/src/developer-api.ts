export type DeveloperApiTargetId =
  | 'astera.decision-materials'
  | 'astera.evidence-search'
  | 'astera.quality-gate'
  | 'astera.integrated'
  | 'webhook-gateway'
  | 'vault'
  | 'skill-runtime';

export type DeveloperApiKeyControlStatus = 'active' | 'paused_user' | 'revoked' | 'expired';

export type DeveloperApiRuntimeHoldReason =
  | 'credit_insufficient'
  | 'plan_entitlement'
  | 'account_suspended'
  | 'security_hold'
  | 'target_suspended';

export type DeveloperApiKeyBinding = {
  keyId: string;
  userId: string;
  tenantId: string;
  targetId: DeveloperApiTargetId;
  environment: 'sandbox' | 'production';
  scopes: readonly string[];
  keyPrefix: string;
  controlStatus: DeveloperApiKeyControlStatus;
  holdReasons: readonly DeveloperApiRuntimeHoldReason[];
  autoResumeAfterCredit: boolean;
};

export function effectiveDeveloperApiState(binding: DeveloperApiKeyBinding): string {
  if (binding.controlStatus !== 'active') return binding.controlStatus;
  const priority: DeveloperApiRuntimeHoldReason[] = [
    'security_hold',
    'account_suspended',
    'plan_entitlement',
    'target_suspended',
    'credit_insufficient',
  ];
  return priority.find((reason) => binding.holdReasons.includes(reason)) ?? 'active';
}
