import { useEffect, useState } from 'react';
import { useAppText } from '../../app-text';
import { previewWithoutAuth, useVerifiedAccountSession } from '../../platform/account-session';
import { apiRequest, asRecord, recordText } from '../../platform/api-client';
import type { RouteMatch } from '../../platform/route-registry';
import { ResponsivePageShell } from '../../platform/ResponsivePageShell';
import { PLAN_CREDIT_TEXT } from './plan-credit-text';
import './plan-credit-page.css';

type FeatureGroup = {
  title?: string;
  items: readonly string[];
};

type PlanCreditCard = {
  id?: string;
  name: string;
  price?: string;
  creditLabel?: string;
  creditValue?: string;
  features?: readonly string[];
  basicFeature?: {
    label: string;
    columns: readonly FeatureGroup[];
  };
};

function normalizePlanId(value: string): string {
  return value.trim().toLowerCase();
}

function currentPlanIdFromPayload(payload: unknown): string {
  const root = asRecord(payload);
  const account = asRecord(root.account ?? root.data ?? root);
  const subscription = asRecord(account.subscription ?? root.subscription);
  return normalizePlanId(recordText(subscription, ['plan_id', 'planId']));
}

function PlanGrid({ title, items, creditLabel, featureLabel, currentPlanId, selectedPlanLabel }: {
  title: string;
  items: readonly PlanCreditCard[];
  creditLabel: string;
  featureLabel: string;
  currentPlanId: string;
  selectedPlanLabel: string;
}) {
  return (
    <section className="plan-credit-section">
      <h2>{title}</h2>
      <div className="plan-credit-grid">
        {items.map((item) => {
          const hasFeatureContent = Boolean(item.basicFeature || (item.features && item.features.length > 0));
          const itemPlanId = normalizePlanId(item.id ?? item.name);
          const isCurrentPlan = Boolean(currentPlanId) && itemPlanId === currentPlanId;

          return (
            <article className={`plan-credit-card is-plan${isCurrentPlan ? ' is-current-plan' : ''}`} key={item.name}>
              <div className="plan-credit-plan-top">
                <div className="plan-credit-plan-heading">
                  <h3>{item.name}</h3>
                  {item.price && <div className="plan-credit-price">{item.price}</div>}
                </div>
                {isCurrentPlan && (
                  <div className="plan-credit-current-plan" aria-label={selectedPlanLabel}>
                    <span className="plan-credit-current-plan-icon" aria-hidden="true" />
                    <span>{selectedPlanLabel}</span>
                  </div>
                )}
              </div>
              {item.creditValue && (
                <div className="plan-credit-fact">
                  <span>{item.creditLabel ?? creditLabel}</span>
                  <strong>{item.creditValue}</strong>
                </div>
              )}
              {hasFeatureContent && (
                <>
                  <div className="plan-credit-feature-title">{featureLabel}</div>
                  {item.basicFeature && (
                    <div className="plan-credit-basic-feature">
                      <div className="plan-credit-basic-label">{item.basicFeature.label}</div>
                      <div className="plan-credit-basic-columns">
                        {item.basicFeature.columns.map((column, columnIndex) => (
                          <div className="plan-credit-basic-column" key={`${item.name}-basic-${columnIndex}`}>
                            {column.title && <div className="plan-credit-basic-column-title">{column.title}</div>}
                            <ul className="plan-credit-basic-list">
                              {column.items.map((value) => <li key={value}>{value}</li>)}
                            </ul>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {item.features && item.features.length > 0 && (
                    <ul className="plan-credit-feature-list">
                      {item.features.map((feature) => <li key={feature}>{feature}</li>)}
                    </ul>
                  )}
                </>
              )}
            </article>
          );
        })}
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
  const session = useVerifiedAccountSession();
  const pageText = PLAN_CREDIT_TEXT[language];
  const previewMode = previewWithoutAuth();
  const sessionPlanId = currentPlanIdFromPayload(session?.payload);
  const [currentPlanId, setCurrentPlanId] = useState(() => previewMode ? 'free' : sessionPlanId);

  useEffect(() => {
    if (previewMode) {
      setCurrentPlanId('free');
      return;
    }

    const sessionValue = currentPlanIdFromPayload(session?.payload);
    if (sessionValue) {
      setCurrentPlanId(sessionValue);
      return;
    }

    const controller = new AbortController();
    apiRequest('/api/account/catalog', { signal: controller.signal })
      .then((payload) => {
        if (controller.signal.aborted) return;
        const planId = currentPlanIdFromPayload(payload);
        if (planId) setCurrentPlanId(planId);
      })
      .catch(() => {
        // Current-plan indicator is optional display state; keep the page usable if readback fails.
      });

    return () => controller.abort();
  }, [previewMode, session?.payload]);

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
          currentPlanId={currentPlanId}
          selectedPlanLabel={pageText.selectedPlanLabel}
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
