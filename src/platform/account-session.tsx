import { createContext, useContext, type ReactNode } from 'react';

export type AccountSessionProjection = {
  payload: unknown;
  displayName: string;
  accountStatus: string;
};

const AccountSessionContext = createContext<AccountSessionProjection | null>(null);

export function AccountSessionProvider({ value, children }: { value: AccountSessionProjection; children: ReactNode }) {
  return <AccountSessionContext.Provider value={value}>{children}</AccountSessionContext.Provider>;
}

export function useVerifiedAccountSession(): AccountSessionProjection | null {
  return useContext(AccountSessionContext);
}
