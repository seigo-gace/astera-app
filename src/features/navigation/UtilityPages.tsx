import { useAppText } from '../../app-text';
import type { RouteMatch } from '../../platform/route-registry';
import { ResponsivePageShell } from '../../platform/ResponsivePageShell';
import { PLAN_CREDIT_TEXT } from './plan-credit-text';
import './plan-credit-page.css';

function CardGrid({ title, items, feature }: { title: string; items: readonly string[]; feature: string[] }) {
  return (
    <section className="plan-credit-section">
      <h2>{title}</h2>
      <div className="plan-credit-grid">
        {items.map((item) => (
          <article className="plan-credit-card" key={item}>
            <h3>{item}</h3>
            <ul>{feature.map((value) => <li key={value}>{value}</li>)}</ul>
          </article>
        ))}
      </div>
    </section>
  );
}

export function PlanCreditPage({ route }: { route: RouteMatch }) {
  const { language, text } = useAppText();
  const pageText = PLAN_CREDIT_TEXT[language];
  const feature = [pageText.featureDetail, pageText.usageCondition, pageText.offering];

  return (
    <ResponsivePageShell route={route} description={text('planCreditDescription')}>
      <div className="plan-credit-page">
        <CardGrid title={text('planLink')} items={pageText.plans} feature={feature} />
        <CardGrid title={text('creditLink')} items={pageText.credits} feature={feature} />
        <CardGrid title={pageText.storageTitle} items={pageText.storage} feature={feature} />
      </div>
    </ResponsivePageShell>
  );
}
