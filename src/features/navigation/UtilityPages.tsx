import { useEffect, useState, type ReactNode } from 'react';
import { useAppText } from '../../app-text';
import { previewWithoutAuth, useVerifiedAccountSession } from '../../platform/account-session';
import { apiRequest, asRecord, recordText } from '../../platform/api-client';
import type { RouteMatch } from '../../platform/route-registry';
import { ResponsivePageShell } from '../../platform/ResponsivePageShell';
import { PLAN_CREDIT_TEXT } from './plan-credit-text';
import './plan-credit-page.css';

type BillingCycle = 'monthly' | 'annual';

type FeatureGroup = {
  title?: string;
  items: readonly string[];
};

type PlanCreditCard = {
  id?: string;
  name: string;
  price?: string;
  monthlyPrice?: string;
  annualPrice?: string;
  annualMonthlyEquivalent?: string;
  creditLabel?: string;
  creditValue?: string;
  features?: readonly string[];
  basicFeature?: {
    label: string;
    columns: readonly FeatureGroup[];
  };
};

type SubscriptionProjection = {
  planId: string;
  billingCycle: BillingCycle;
  hasLiveSubscription: boolean;
};

function normalizePlanId(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeBillingCycle(value: string): BillingCycle {
  return value.trim().toLowerCase() === 'annual' ? 'annual' : 'monthly';
}

function subscriptionFromPayload(payload: unknown): SubscriptionProjection {
  const root = asRecord(payload);
  const account = asRecord(root.account ?? root.data ?? root);
  const subscription = asRecord(account.subscription ?? root.subscription);
  const planId = normalizePlanId(recordText(subscription, ['plan_id', 'planId']));
  const providerSubscriptionId = recordText(subscription, ['provider_subscription_id', 'providerSubscriptionId']);
  const status = recordText(subscription, ['status']).toLowerCase();
  const billingCycle = normalizeBillingCycle(recordText(subscription, ['billing_cycle', 'billingCycle']));
  return {
    planId,
    billingCycle,
    hasLiveSubscription: Boolean(providerSubscriptionId) && !['none', 'cancelled', 'failed'].includes(status),
  };
}

function PlanGrid({
  title,
  items,
  creditLabel,
  featureLabel,
  subscription,
  selectedPlanLabel,
  billingCycle,
  onBillingCycleChange,
  monthlyLabel,
  annualLabel,
  annualSaving,
  monthlyEquivalent,
  monthlyGrant,
}: {
  title: string;
  items: readonly PlanCreditCard[];
  creditLabel: string;
  featureLabel: string;
  subscription: SubscriptionProjection;
  selectedPlanLabel: string;
  billingCycle: BillingCycle;
  onBillingCycleChange: (cycle: BillingCycle) => void;
  monthlyLabel: string;
  annualLabel: string;
  annualSaving: string;
  monthlyEquivalent: string;
  monthlyGrant: string;
}) {
  return (
    <section className="plan-credit-section">
      <div className="plan-credit-section-head">
        <h2>{title}</h2>
        <div className="plan-credit-cycle-toggle" role="group" aria-label={`${monthlyLabel} / ${annualLabel}`}>
          <button
            type="button"
            className={billingCycle === 'monthly' ? 'is-active' : ''}
            aria-pressed={billingCycle === 'monthly'}
            onClick={() => onBillingCycleChange('monthly')}
          >
            {monthlyLabel}
          </button>
          <button
            type="button"
            className={billingCycle === 'annual' ? 'is-active' : ''}
            aria-pressed={billingCycle === 'annual'}
            onClick={() => onBillingCycleChange('annual')}
          >
            {annualLabel}
          </button>
        </div>
      </div>
      <div className="plan-credit-grid">
        {items.map((item) => {
          const hasFeatureContent = Boolean(item.basicFeature || (item.features && item.features.length > 0));
          const itemPlanId = normalizePlanId(item.id ?? item.name);
          const isFree = itemPlanId === 'free';
          const isCurrentPlan = Boolean(subscription.planId)
            && itemPlanId === subscription.planId
            && (isFree || subscription.billingCycle === billingCycle);
          const usesSubscriptionManagement = subscription.hasLiveSubscription || isFree;
          const cycleQuery = `billing=${billingCycle}`;
          const actionHref = usesSubscriptionManagement
            ? `/account/subscription?target_plan=${encodeURIComponent(itemPlanId)}&${cycleQuery}&return_to=plan-credit`
            : `/account/checkout?plan=${encodeURIComponent(itemPlanId)}&${cycleQuery}&return_to=plan-credit`;
          const price = billingCycle === 'annual'
            ? (item.annualPrice ?? item.monthlyPrice ?? item.price)
            : (item.monthlyPrice ?? item.price);
          const cycleLabel = billingCycle === 'annual' ? annualLabel : monthlyLabel;

          const cardContent: ReactNode = (
            <>
              <div className="plan-credit-plan-top">
                <div className="plan-credit-plan-heading">
                  <h3>{item.name}</h3>
                  {price && <div className="plan-credit-price">{price}</div>}
                  {billingCycle === 'annual' && !isFree && (
                    <div className="plan-credit-annual-meta">
                      <span className="plan-credit-saving-badge">{annualSaving}</span>
                      {item.annualMonthlyEquivalent && (
                        <span>{monthlyEquivalent}: {item.annualMonthlyEquivalent}</span>
                      )}
                    </div>
                  )}
                </div>
                {isCurrentPlan && (
                  <div className="plan-credit-current-plan" aria-label={selectedPlanLabel}>
                    <span className="plan-credit-current-plan-icon" aria-hidden="true" />
                    <span>{isFree ? selectedPlanLabel : `${selectedPlanLabel}・${cycleLabel}`}</span>
                  </div>
                )}
              </div>
              {item.creditValue && (
                <div className="plan-credit-fact">
                  <span>{item.creditLabel ?? creditLabel}</span>
                  <strong>{item.creditValue}</strong>
                </div>
              )}
              {billingCycle === 'annual' && !isFree && (
                <div className="plan-credit-monthly-grant">{monthlyGrant}</div>
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
            </>
          );

          if (isCurrentPlan) {
            return (
              <article className="plan-credit-card is-plan is-current-plan" key={item.name}>
                {cardContent}
              </article>
            );
          }

          return (
            <a
              className="plan-credit-card is-plan is-actionable"
              href={actionHref}
              key={item.name}
              aria-label={`${item.name}・${cycleLabel}`}
            >
              {cardContent}
            </a>
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
  const sessionSubscription = subscriptionFromPayload(session?.payload);
  const [billingCycle, setBillingCycle] = useState<BillingCycle>('monthly');
  const [subscription, setSubscription] = useState<SubscriptionProjection>(() => previewMode
    ? { planId: 'free', billingCycle: 'monthly', hasLiveSubscription: false }
    : sessionSubscription);

  useEffect(() => {
    if (previewMode) {
      setSubscription({ planId: 'free', billingCycle: 'monthly', hasLiveSubscription: false });
      return;
    }

    const sessionValue = subscriptionFromPayload(session?.payload);
    if (sessionValue.planId || sessionValue.hasLiveSubscription) {
      setSubscription(sessionValue);
      return;
    }

    const controller = new AbortController();
    apiRequest('/api/account/catalog', { signal: controller.signal })
      .then((payload) => {
        if (controller.signal.aborted) return;
        const next = subscriptionFromPayload(payload);
        if (next.planId || next.hasLiveSubscription) setSubscription(next);
      })
      .catch(() => {
        // Current-plan indicator and route selection are additive UI state; keep the page usable if readback fails.
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
          subscription={subscription}
          selectedPlanLabel={pageText.selectedPlanLabel}
          billingCycle={billingCycle}
          onBillingCycleChange={setBillingCycle}
          monthlyLabel={pageText.billingMonthly}
          annualLabel={pageText.billingAnnual}
          annualSaving={pageText.annualSaving}
          monthlyEquivalent={pageText.monthlyEquivalent}
          monthlyGrant={pageText.monthlyGrant}
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
