import { createContext, useContext, type ReactNode } from 'react';

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

export function AccountSessionProvider({ value, children }: { value: AccountSessionProjection; children: ReactNode }) {
  return <AccountSessionContext.Provider value={value}>{children}</AccountSessionContext.Provider>;
}

export function useVerifiedAccountSession(): AccountSessionProjection | null {
  return useContext(AccountSessionContext);
}
