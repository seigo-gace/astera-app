export type AccountStatus =
  | 'pending_email_verification'
  | 'pending_password_setup'
  | 'active'
  | 'security_hold'
  | 'suspended'
  | 'deletion_scheduled'
  | 'deleted';

export type AuthenticationStage =
  | 'primary_required'
  | 'pending_2fa'
  | 'authenticated'
  | 'fresh_auth_required';

export type ActorContext = {
  userId: string;
  tenantId: string;
  accountStatus: AccountStatus;
  sessionId: string;
  authStage: AuthenticationStage;
  freshUntil?: string;
  correlationId: string;
};

export function canUseAuthenticatedApp(context: ActorContext): boolean {
  return context.accountStatus === 'active' && context.authStage === 'authenticated';
}

export function requiresFreshSession(context: ActorContext, now = Date.now()): boolean {
  if (!context.freshUntil) return true;
  const expiresAt = Date.parse(context.freshUntil);
  return !Number.isFinite(expiresAt) || expiresAt <= now;
}
