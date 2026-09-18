import type { RouteMatch } from '../../platform/route-registry';
import CheckoutPage from './CheckoutPage';
import OneTimeCheckoutPage from './OneTimeCheckoutPage';

export default function CheckoutRouterPage({ route }: { route: RouteMatch }) {
  const kind = new URLSearchParams(window.location.search).get('kind');
  if (kind === 'credit' || kind === 'storage') {
    return <OneTimeCheckoutPage route={route} kind={kind} />;
  }
  return <CheckoutPage route={route} />;
}
