import { readSecretFromFile } from './secure-compare.js';

export function resolveBillingAppSecret(env: NodeJS.ProcessEnv): string | undefined {
  return readSecretFromFile(env.BILLING_APP_SECRET_FILE) ?? env.BILLING_APP_SECRET?.trim();
}

export function resolveBillingProjectionSecret(env: NodeJS.ProcessEnv): string | undefined {
  return readSecretFromFile(env.BILLING_PROJECTION_SECRET_FILE) ?? env.BILLING_PROJECTION_SECRET?.trim();
}

export function withResolvedBillingSecrets<T extends NodeJS.ProcessEnv>(env: T): T & {
  BILLING_APP_SECRET?: string;
  BILLING_PROJECTION_SECRET?: string;
} {
  return {
    ...env,
    BILLING_APP_SECRET: resolveBillingAppSecret(env),
    BILLING_PROJECTION_SECRET: resolveBillingProjectionSecret(env),
  };
}
