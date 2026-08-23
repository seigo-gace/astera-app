import { useAppText } from '../../app-text';
import type { RouteMatch } from '../../platform/route-registry';
import { ResponsivePageShell } from '../../platform/ResponsivePageShell';
import './plan-credit-page.css';

const planCards = ['Free', 'Basic', 'Pro', 'Business', 'Enterprise'];
const creditCards = ['Credit Pack 1', 'Credit Pack 2', 'Credit Pack 3', 'Credit Pack 4', 'Credit Pack 5'];
const storageCards = ['Free', 'Small', 'Standard', 'Pro', 'Enterprise'];

function CardGrid({ title, items }: { title: string; items: string[] }) {
  return (
    <section className="plan-credit-section">
      <h2>{title}</h2>
      <div className="plan-credit-grid">
        {items.map((item) => (
          <article className="plan-credit-card" key={item}>
            <h3>{item}</h3>
            <ul>
              <li>機能詳細</li>
              <li>利用条件</li>
              <li>提供内容</li>
            </ul>
          </article>
        ))}
      </div>
    </section>
  );
}

export function PlanCreditPage({ route }: { route: RouteMatch }) {
  const { text } = useAppText();
  return (
    <ResponsivePageShell route={route} description={text('planCreditDescription')}>
      <div className="plan-credit-page">
        <CardGrid title={text('planLink')} items={planCards} />
        <CardGrid title={text('creditLink')} items={creditCards} />
        <CardGrid title="Astera Storage" items={storageCards} />
      </div>
    </ResponsivePageShell>
  );
}
