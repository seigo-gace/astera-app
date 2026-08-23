import { createContext, useContext, useEffect, type ReactNode } from 'react';
import i18n from '../i18n';

export type AccountSessionProjection = {
  payload: unknown;
  displayName: string;
  accountStatus: string;
};

export function previewWithoutAuth(): boolean {
  return import.meta.env.VITE_PREVIEW_WITHOUT_AUTH === 'true';
}

export const PREVIEW_ACCOUNT_SESSION: AccountSessionProjection = {
  payload: { account: { account_status: 'active', display_name: 'Preview' } },
  accountStatus: 'active',
  displayName: 'Preview',
};

const AccountSessionContext = createContext<AccountSessionProjection | null>(null);

function accountLanguage(payload: unknown): 'ja' | 'en' | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const root = payload as Record<string, unknown>;
  const accountValue = root.account ?? root.data ?? root;
  if (!accountValue || typeof accountValue !== 'object' || Array.isArray(accountValue)) return null;
  const value = (accountValue as Record<string, unknown>).ui_language;
  if (typeof value !== 'string') return null;
  const normalized = value.toLowerCase();
  if (normalized.startsWith('en')) return 'en';
  if (normalized.startsWith('ja')) return 'ja';
  return null;
}

export function AccountSessionProvider({ value, children }: { value: AccountSessionProjection; children: ReactNode }) {
  useEffect(() => {
    const language = accountLanguage(value.payload);
    if (!language) return;
    localStorage.setItem('astera-language', language);
    document.documentElement.lang = language;
    document.documentElement.dir = 'ltr';
    if (i18n.resolvedLanguage !== language) void i18n.changeLanguage(language);
  }, [value.payload]);
  return <AccountSessionContext.Provider value={value}>{children}</AccountSessionContext.Provider>;
}

export function useVerifiedAccountSession(): AccountSessionProjection | null {
  return useContext(AccountSessionContext);
}
