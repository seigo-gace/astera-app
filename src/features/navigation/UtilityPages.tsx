import { useAppText } from '../../app-text';
import type { RouteMatch } from '../../platform/route-registry';
import { ResponsivePageShell } from '../../platform/ResponsivePageShell';
import { PLAN_CREDIT_TEXT } from './plan-credit-text';
import './plan-credit-page.css';

type PlanCreditCard = {
  name: string;
  features?: readonly string[];
};

function CardGrid({ title, items }: { title: string; items: readonly PlanCreditCard[] }) {
  return (
    <section className="plan-credit-section">
      <h2>{title}</h2>
      <div className="plan-credit-grid">
        {items.map((item) => (
          <article className="plan-credit-card" key={item.name}>
            <h3>{item.name}</h3>
            {item.features && item.features.length > 0 && (
              <ul className="plan-credit-feature-list">
                {item.features.map((feature) => <li key={feature}>{feature}</li>)}
              </ul>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

export function PlanCreditPage({ route }: { route: RouteMatch }) {
  const { language } = useAppText();
  const pageText = PLAN_CREDIT_TEXT[language];

  return (
    <ResponsivePageShell route={route}>
      <div className="plan-credit-page">
        <header className="plan-credit-local-head">
          <h1>{pageText.pageTitle}</h1>
        </header>
        <CardGrid title={pageText.planSectionTitle} items={pageText.plans} />
        <CardGrid title={pageText.creditSectionTitle} items={pageText.credits} />
        <CardGrid title={pageText.storageSectionTitle} items={pageText.storage} />
      </div>
    </ResponsivePageShell>
  );
}
