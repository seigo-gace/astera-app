import { useAppText } from '../../app-text';
import type { RouteMatch } from '../../platform/route-registry';
import { ResponsivePageShell } from '../../platform/ResponsivePageShell';

export function PlanCreditPage({ route }: { route: RouteMatch }) {
  const { text } = useAppText();
  return (
    <ResponsivePageShell route={route} description={text('planCreditDescription')}>
      <div className="platform-card-grid">
        <a className="platform-link-card" href="/account/subscription"><strong>{text('planLink')}</strong><span>{text('planCreditDescription')}</span><b>›</b></a>
        <a className="platform-link-card" href="/account/credit"><strong>{text('creditLink')}</strong><span>{text('planCreditDescription')}</span><b>›</b></a>
      </div>
    </ResponsivePageShell>
  );
}
