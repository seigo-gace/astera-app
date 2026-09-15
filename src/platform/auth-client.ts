import { passkeyClient } from '@better-auth/passkey/client';
import { createAuthClient } from 'better-auth/react';
import { twoFactorClient } from 'better-auth/client/plugins';
import { isAbsoluteHttpUrl } from './api-client';

function originFromEnv(value: string | undefined): string | null {
  const raw = value?.trim();
  if (!raw || !isAbsoluteHttpUrl(raw)) return null;
  return new URL(raw).origin;
}

function resolvedAuthBaseUrl(): string {
  const betterAuth = originFromEnv(import.meta.env.VITE_BETTER_AUTH_URL as string | undefined);
  if (betterAuth) return betterAuth;
  const appUrl = originFromEnv(import.meta.env.VITE_APP_URL as string | undefined);
  if (appUrl) return appUrl;
  const apiOrigin = originFromEnv(import.meta.env.VITE_ASTERA_API_BASE as string | undefined);
  if (apiOrigin) return apiOrigin;
  return typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
}

const baseURL = resolvedAuthBaseUrl();

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

function asAuthRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function authText(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

export function authErrorMessage(error: unknown, fallback: string): string {
  if (!error || typeof error !== 'object') return fallback;
  const source = error as Record<string, unknown>;
  const nested = asAuthRecord(source.error);
  return authText(source, ['message'])
    || authText(nested, ['message'])
    || authText(asAuthRecord(source.body), ['message'])
    || authText(asAuthRecord(asAuthRecord(source.body).error), ['message'])
    || fallback;
}

export function authErrorCode(error: unknown, fallback: string): string {
  if (!error || typeof error !== 'object') return fallback;
  const source = error as Record<string, unknown>;
  const nested = asAuthRecord(source.error);
  return authText(source, ['code', 'status', 'error_code'])
    || authText(nested, ['code', 'status', 'error_code'])
    || authText(asAuthRecord(source.body), ['code', 'status', 'error_code'])
    || authText(asAuthRecord(asAuthRecord(source.body).error), ['code', 'status', 'error_code'])
    || fallback;
}
