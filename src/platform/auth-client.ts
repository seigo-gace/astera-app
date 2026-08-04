import { passkeyClient } from '@better-auth/passkey/client';
import { createAuthClient } from 'better-auth/react';
import { twoFactorClient } from 'better-auth/client/plugins';

const configuredApiBase = (import.meta.env.VITE_ASTERA_API_BASE as string | undefined)?.replace(/\/$/, '');
const baseURL = configuredApiBase || window.location.origin;

export const authClient = createAuthClient({
  baseURL,
  basePath: '/api/auth',
  fetchOptions: {
    credentials: 'include',
    headers: {
      'X-Astera-Client': 'astera-app',
    },
  },
  plugins: [
    twoFactorClient({
      twoFactorPage: '/auth/2fa',
    }),
    passkeyClient(),
  ],
});

export function authErrorMessage(error: unknown, fallback: string): string {
  if (!error || typeof error !== 'object') return fallback;
  const source = error as Record<string, unknown>;
  const message = source.message;
  return typeof message === 'string' && message.trim() ? message.trim() : fallback;
}
