import { useEffect, useState } from 'react';
import App from '../App';
import CheckoutPage from '../features/checkout/CheckoutPage';
import PricingPage from '../features/pricing/PricingPage';
import { ApiError, apiRequest } from './api-client';
import { CanonicalPage } from './CanonicalPages';
import { BusyState, ErrorState } from './ResponsivePageShell';
import { matchCanonicalRoute } from './route-registry';
import './platform.css';

type GateState =
  | { status: 'loading' }
  | { status: 'ready' }
  | { status: 'error'; error: unknown };

function AuthenticatedAppGate() {
  const [state, setState] = useState<GateState>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    apiRequest('/api/account', { signal: controller.signal })
      .then(() => setState({ status: 'ready' }))
      .catch((error: unknown) => {
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
          const returnTo = encodeURIComponent(window.location.pathname + window.location.search + window.location.hash);
          window.location.replace(`/login?return_to=${returnTo}`);
          return;
        }
        if (!controller.signal.aborted) setState({ status: 'error', error });
      });
    return () => controller.abort();
  }, []);

  if (state.status === 'loading') return <BusyState label="AccountとSessionを確認しています…" />;
  if (state.status === 'error') return <ErrorState error={state.error} onRetry={() => window.location.reload()} />;
  return <App />;
}

function RootRedirect() {
  useEffect(() => {
    window.location.replace('/app/new');
  }, []);
  return <BusyState label="Astera Appを開いています…" />;
}

export default function AppRouter() {
  const route = matchCanonicalRoute(window.location.pathname);

  switch (route.id) {
    case 'root':
      return <RootRedirect />;
    case 'app':
    case 'new-run':
      return <AuthenticatedAppGate />;
    case 'pricing':
      return <PricingPage />;
    case 'account-checkout':
      return <CheckoutPage />;
    default:
      return <CanonicalPage route={route} />;
  }
}
