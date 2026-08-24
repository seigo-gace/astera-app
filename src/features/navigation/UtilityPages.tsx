import { useAppText } from '../../app-text';
import type { RouteMatch } from '../../platform/route-registry';
import { ResponsivePageShell } from '../../platform/ResponsivePageShell';
import { PLAN_CREDIT_TEXT } from './plan-credit-text';
import './plan-credit-page.css';

type PlanCreditCard = {
  name: string;
  price?: string;
  creditLabel?: string;
  creditValue?: string;
  features?: readonly string[];
};

function PlanGrid({ title, items, creditLabel, featureLabel }: {
  title: string;
  items: readonly PlanCreditCard[];
  creditLabel: string;
  featureLabel: string;
}) {
  return (
    <section className="plan-credit-section">
      <h2>{title}</h2>
      <div className="plan-credit-grid">
        {items.map((item) => (
          <article className="plan-credit-card is-plan" key={item.name}>
            <h3>{item.name}</h3>
            {item.price && <div className="plan-credit-price">{item.price}</div>}
            {item.creditValue && (
              <div className="plan-credit-fact">
                <span>{item.creditLabel ?? creditLabel}</span>
                <strong>{item.creditValue}</strong>
              </div>
            )}
            {item.features && item.features.length > 0 && (
              <>
                <div className="plan-credit-feature-title">{featureLabel}</div>
                <ul className="plan-credit-feature-list">
                  {item.features.map((feature) => <li key={feature}>{feature}</li>)}
                </ul>
              </>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

function SimpleGrid({ title, items, defaultCreditLabel }: {
  title: string;
  items: readonly PlanCreditCard[];
  defaultCreditLabel?: string;
}) {
  return (
    <section className="plan-credit-section">
      <h2>{title}</h2>
      <div className="plan-credit-grid">
        {items.map((item) => (
          <article className={`plan-credit-card${item.price ? ' is-credit' : ' is-storage'}`} key={item.name}>
            <h3>{item.name}</h3>
            {item.price && <div className="plan-credit-price">{item.price}</div>}
            {item.creditValue && (
              <div className="plan-credit-fact">
                <span>{item.creditLabel ?? defaultCreditLabel}</span>
                <strong>{item.creditValue}</strong>
              </div>
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
    <ResponsivePageShell route={route} fullWidth>
      <div className="plan-credit-page">
        <header className="plan-credit-local-head">
          <h1>{pageText.pageTitle}</h1>
        </header>

        <PlanGrid
          title={pageText.planSectionTitle}
          items={pageText.plans}
          creditLabel={pageText.monthlyCredit}
          featureLabel={pageText.includedFeatures}
        />
        <SimpleGrid
          title={pageText.creditSectionTitle}
          items={pageText.credits}
          defaultCreditLabel={pageText.grantedCredit}
        />
        <SimpleGrid title={pageText.storageSectionTitle} items={pageText.storage} />
      </div>
    </ResponsivePageShell>
  );
}
