import { useEffect, useState } from 'react';
import { useAppText } from '../../app-text';
import { apiRequest, asArray, asRecord, recordText } from '../../platform/api-client';
import type { RouteMatch } from '../../platform/route-registry';
import { ResponsivePageShell } from '../../platform/ResponsivePageShell';
import { PLAN_CREDIT_TEXT } from './plan-credit-text';
import './plan-credit-page.css';

type Language = keyof typeof PLAN_CREDIT_TEXT;
type PageText = (typeof PLAN_CREDIT_TEXT)[Language];

type PlanCard = {
  id: string;
  name: string;
  price: string;
  monthlyCredits: string;
  features: string[];
  recommended: boolean;
  current: boolean;
};

type CreditCard = {
  id: string;
  name: string;
  price: string;
  credits: string;
};

type CatalogState =
  | { status: 'loading' }
  | { status: 'ready'; plans: PlanCard[]; credits: CreditCard[] }
  | { status: 'error' };

function numeric(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function formatYen(value: number | null, language: Language, recurring = false): string {
  if (value === null) return '—';
  const amount = `¥${Math.trunc(value).toLocaleString(language === 'ja' ? 'ja-JP' : 'en-US')}`;
  if (!recurring) return amount;
  return language === 'ja' ? `${amount} / 月` : `${amount} / month`;
}

function formatCredits(value: number | null, language: Language): string {
  if (value === null) return '—';
  return `${Math.trunc(value).toLocaleString(language === 'ja' ? 'ja-JP' : 'en-US')} C`;
}

function normalizeFeatureKey(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function planFallback(pageText: PageText, planId: string): string[] {
  const value = pageText.planFeatureFallbacks[planId as keyof typeof pageText.planFeatureFallbacks];
  return value ? [...value] : [];
}

function planFeatures(pageText: PageText, planId: string, source: unknown): string[] {
  if (!Array.isArray(source)) return planFallback(pageText, planId);
  const mapped = source.flatMap((item) => {
    if (typeof item !== 'string' || !item.trim()) return [];
    const key = normalizeFeatureKey(item);
    const label = pageText.featureLabels[key as keyof typeof pageText.featureLabels];
    return label ? [label] : [];
  });
  return mapped.length > 0 ? [...new Set(mapped)] : planFallback(pageText, planId);
}

function normalizeCatalog(payload: unknown, pageText: PageText, language: Language): Omit<Extract<CatalogState, { status: 'ready' }>, 'status'> {
  const root = asRecord(payload);
  const subscription = asRecord(root.subscription ?? asRecord(root.account).subscription);
  const currentPlanId = recordText(subscription, ['plan_id', 'planId']);

  const plans = asArray(payload, ['plans']).flatMap((item) => {
    const plan = asRecord(item);
    const id = recordText(plan, ['plan_id', 'id']);
    const name = recordText(plan, ['display_name', 'name']);
    if (!id || !name) return [];

    const price = numeric(plan.recurring_amount ?? plan.monthly_price_yen);
    const monthlyCredits = numeric(plan.included_credits ?? plan.monthly_credits);
    const features = plan.features ?? plan.entitlement_ids ?? plan.entitlements;

    return [{
      id,
      name,
      price: formatYen(price, language, true),
      monthlyCredits: formatCredits(monthlyCredits, language),
      features: planFeatures(pageText, id, features),
      recommended: plan.recommended === true,
      current: id === currentPlanId,
    } satisfies PlanCard];
  });

  const credits = asArray(root.creditProducts ?? root.credit_products).slice(0, 5).flatMap((item) => {
    const product = asRecord(item);
    const id = recordText(product, ['product_id', 'id']);
    const name = recordText(product, ['display_name', 'name']);
    if (!id || !name) return [];

    return [{
      id,
      name,
      price: formatYen(numeric(product.amount), language),
      credits: formatCredits(numeric(product.credits), language),
    } satisfies CreditCard];
  });

  return { plans, credits };
}

function PlanGrid({ title, items, text }: { title: string; items: PlanCard[]; text: PageText }) {
  return (
    <section className="plan-credit-section">
      <h2>{title}</h2>
      <div className="plan-credit-grid">
        {items.map((item) => (
          <article className="plan-credit-card is-plan" key={item.id}>
            <div className="plan-credit-card-head">
              <h3>{item.name}</h3>
              <div className="plan-credit-badges">
                {item.current && <span>{text.currentPlan}</span>}
                {item.recommended && <span>{text.recommended}</span>}
              </div>
            </div>
            <div className="plan-credit-price">{item.price}</div>
            <div className="plan-credit-fact">
              <span>{text.monthlyCredit}</span>
              <strong>{item.monthlyCredits}</strong>
            </div>
            <div className="plan-credit-feature-title">{text.includedFeatures}</div>
            <ul className="plan-credit-feature-list">
              {item.features.map((feature) => <li key={feature}>{feature}</li>)}
            </ul>
          </article>
        ))}
      </div>
    </section>
  );
}

function CreditGrid({ title, items, text }: { title: string; items: CreditCard[]; text: PageText }) {
  return (
    <section className="plan-credit-section">
      <h2>{title}</h2>
      <div className="plan-credit-grid">
        {items.map((item) => (
          <article className="plan-credit-card is-credit" key={item.id}>
            <h3>{item.name}</h3>
            <div className="plan-credit-price">{item.price}</div>
            <div className="plan-credit-fact">
              <span>{text.grantedCredit}</span>
              <strong>{item.credits}</strong>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function StorageGrid({ title, items }: { title: string; items: readonly string[] }) {
  return (
    <section className="plan-credit-section">
      <h2>{title}</h2>
      <div className="plan-credit-grid">
        {items.map((name) => (
          <article className="plan-credit-card is-storage" key={name}>
            <h3>{name}</h3>
          </article>
        ))}
      </div>
    </section>
  );
}

export function PlanCreditPage({ route }: { route: RouteMatch }) {
  const { language } = useAppText();
  const pageText = PLAN_CREDIT_TEXT[language];
  const [catalog, setCatalog] = useState<CatalogState>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    setCatalog({ status: 'loading' });
    apiRequest('/api/account/catalog', { signal: controller.signal })
      .then((payload) => {
        if (!controller.signal.aborted) setCatalog({ status: 'ready', ...normalizeCatalog(payload, pageText, language) });
      })
      .catch(() => {
        if (!controller.signal.aborted) setCatalog({ status: 'error' });
      });
    return () => controller.abort();
  }, [language, pageText]);

  return (
    <ResponsivePageShell route={route} fullWidth>
      <div className="plan-credit-page">
        <header className="plan-credit-local-head">
          <h1>{pageText.pageTitle}</h1>
        </header>

        {catalog.status === 'loading' && <div className="plan-credit-status" role="status">{pageText.loadingCatalog}</div>}
        {catalog.status === 'error' && <div className="plan-credit-status is-error" role="alert">{pageText.catalogError}</div>}
        {catalog.status === 'ready' && (
          <>
            <PlanGrid title={pageText.planSectionTitle} items={catalog.plans} text={pageText} />
            <CreditGrid title={pageText.creditSectionTitle} items={catalog.credits} text={pageText} />
          </>
        )}

        <StorageGrid title={pageText.storageSectionTitle} items={pageText.storageTiers} />
      </div>
    </ResponsivePageShell>
  );
}
