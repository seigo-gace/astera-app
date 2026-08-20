import { useEffect, useState, type ReactNode } from 'react';
import CheckoutPage from '../features/checkout/CheckoutPage';
import NativeComposerPage from '../features/composer/NativeComposerPage';
import PricingPage from '../features/pricing/PricingPage';
import { AccountSessionProvider, PREVIEW_ACCOUNT_SESSION, previewWithoutAuth, type AccountSessionProjection } from './account-session';
import { ApiError, apiRequest, asRecord, recordText } from './api-client';
import { CanonicalPage } from './CanonicalPages';
import { BusyState, ErrorState } from './ResponsivePageShell';
import { matchCanonicalRoute } from './route-registry';
import './platform.css';
import './platform-canonical-overrides.css';

type GateState =
  | { status: 'loading' }
  | { status: 'ready'; session: AccountSessionProjection }
  | { status: 'error'; error: unknown };

function currentReturnTo(): string {
  return window.location.pathname + window.location.search + window.location.hash;
}

function accountProjection(payload: unknown) {
  const root = asRecord(payload);
  return asRecord(root.account ?? root.data ?? root);
}

function accountContinuation(payload: unknown, returnTo: string): string | null {
  const account = accountProjection(payload);
  const status = recordText(account, ['account_status', 'status']);
  const params = new URLSearchParams({ return_to: returnTo });
  const email = recordText(account, ['email']);
  if (email) params.set('email', email);

  if (status === 'pending_email_verification') return `/verify-email?${params.toString()}`;
  if (status === 'pending_password_setup') return `/account/password/setup?${params.toString()}`;
  return null;
}

function AccountSessionGate({ children }: { children: ReactNode }) {
  if (previewWithoutAuth()) {
    return <AccountSessionProvider value={PREVIEW_ACCOUNT_SESSION}>{children}</AccountSessionProvider>;
  }
  return <AccountSessionGateLive>{children}</AccountSessionGateLive>;
}

function AccountSessionGateLive({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });
    apiRequest('/api/account', { signal: controller.signal })
      .then((payload) => {
        const returnTo = currentReturnTo();
        const continuation = accountContinuation(payload, returnTo);
        if (continuation) {
          window.location.replace(continuation);
          return;
        }

        const account = accountProjection(payload);
        const accountStatus = recordText(account, ['account_status', 'status']);
        if (accountStatus && accountStatus !== 'active') {
          setState({
            status: 'error',
            error: new ApiError('Accountの現在状態ではこのPageを利用できません。', 403, `ACCOUNT_${accountStatus.toUpperCase()}`, payload),
          });
          return;
        }
        setState({
          status: 'ready',
          session: {
            payload,
            accountStatus: accountStatus || 'active',
            displayName: recordText(account, ['nickname', 'display_name', 'name', 'email'], 'Account'),
          },
        });
      })
      .catch((error: unknown) => {
        if (error instanceof ApiError) {
          const authenticationCodes = new Set(['AUTHENTICATION_REQUIRED', 'SESSION_REQUIRED', 'SESSION_EXPIRED', 'UNAUTHORIZED']);
          if (error.status === 401 || (error.status === 403 && authenticationCodes.has(error.code))) {
            const returnTo = encodeURIComponent(currentReturnTo());
            window.location.replace(`/login?return_to=${returnTo}`);
            return;
          }
        }
        if (!controller.signal.aborted) setState({ status: 'error', error });
      });
    return () => controller.abort();
  }, [attempt]);

  if (state.status === 'loading') return <BusyState label="AccountとSessionを確認しています…" />;
  if (state.status === 'error') return <ErrorState error={state.error} onRetry={() => setAttempt((value) => value + 1)} />;
  return <AccountSessionProvider value={state.session}>{children}</AccountSessionProvider>;
}

function RootRedirect() {
  useEffect(() => {
    window.location.replace('/app/new');
  }, []);
  return <BusyState label="Astera Appを開いています…" />;
}

export default function AppRouter() {
  const route = matchCanonicalRoute(window.location.pathname);

  if (route.id === 'root') return <RootRedirect />;
  if (route.id === 'pricing') return <PricingPage />;

  if (route.id === 'account-checkout') return <CheckoutPage />;

  if (route.id === 'app' || route.id === 'new-run') {
    return <AccountSessionGate><NativeComposerPage route={route} /></AccountSessionGate>;
  }

  const page = <CanonicalPage route={route} />;
  return route.access === 'authenticated'
    ? <AccountSessionGate>{page}</AccountSessionGate>
    : page;
}
