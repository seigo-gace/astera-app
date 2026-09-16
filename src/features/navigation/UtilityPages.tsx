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

type StoragePack = {
  productId: string;
  displayName: string;
  capacityGb: number;
  priceJpy: number;
  canPurchase: boolean;
};

type StorageProjection = {
  planId: string;
  planMaxCapacityGb: number;
  currentCapacityGb: number;
  remainingPurchaseCapacityGb: number;
  usedBytes: number;
  remainingBytes: number;
  state: string;
  writeAllowed: boolean;
  overPlanLimit: boolean;
  packs: StoragePack[];
};

type StorageLoadState =
  | { status: 'loading' }
  | { status: 'ready'; data: StorageProjection }
  | { status: 'error'; message: string };

type StoragePurchaseState =
  | { status: 'idle' }
  | { status: 'working'; productId: string }
  | { status: 'error'; message: string };

function storagePackFallbacks(language: 'ja' | 'en'): StoragePack[] {
  const fullWidthPlus = language === 'ja' ? '＋' : '+';
  return [
    { productId: 'storage_1gb', displayName: `${fullWidthPlus}1GB`, capacityGb: 1, priceJpy: 480, canPurchase: false },
    { productId: 'storage_10gb', displayName: `${fullWidthPlus}10GB`, capacityGb: 10, priceJpy: 1980, canPurchase: false },
    { productId: 'storage_50gb', displayName: `${fullWidthPlus}50GB`, capacityGb: 50, priceJpy: 5980, canPurchase: false },
  ];
}

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

function numeric(record: Record<string, unknown>, keys: string[], fallback = 0): number {
  for (const key of keys) {
    const value = record[key];
    const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN;
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function storageFromPayload(payload: unknown): StorageProjection {
  const root = asRecord(payload);
  const usage = asRecord(root.usage);
  const packsRaw = Array.isArray(root.packs) ? root.packs : [];
  const packs = packsRaw.map(asRecord).map((pack) => ({
    productId: recordText(pack, ['product_id', 'productId']),
    displayName: recordText(pack, ['display_name', 'displayName'], 'Storage'),
    capacityGb: numeric(pack, ['capacity_gb', 'capacityGb']),
    priceJpy: numeric(pack, ['price_jpy', 'priceJpy']),
    canPurchase: pack.can_purchase === true || pack.canPurchase === true,
  })).filter((pack) => pack.productId && pack.capacityGb > 0 && pack.priceJpy > 0);
  return {
    planId: normalizePlanId(recordText(root, ['plan_id', 'planId'], 'free')),
    planMaxCapacityGb: numeric(root, ['plan_max_capacity_gb', 'planMaxCapacityGb']),
    currentCapacityGb: numeric(root, ['current_capacity_gb', 'currentCapacityGb']),
    remainingPurchaseCapacityGb: numeric(root, ['remaining_purchase_capacity_gb', 'remainingPurchaseCapacityGb']),
    usedBytes: numeric(usage, ['used_bytes', 'usedBytes']),
    remainingBytes: numeric(usage, ['remaining_bytes', 'remainingBytes']),
    state: recordText(root, ['state'], 'inactive'),
    writeAllowed: root.write_allowed === true || root.writeAllowed === true,
    overPlanLimit: root.over_plan_limit === true || root.overPlanLimit === true,
    packs,
  };
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const gib = bytes / (1024 ** 3);
  if (gib >= 1) return `${gib >= 100 ? gib.toFixed(0) : gib.toFixed(2).replace(/\.00$/, '')} GB`;
  const mib = bytes / (1024 ** 2);
  if (mib >= 1) return `${mib.toFixed(mib >= 100 ? 0 : 1).replace(/\.0$/, '')} MB`;
  const kib = bytes / 1024;
  return `${kib.toFixed(kib >= 100 ? 0 : 1).replace(/\.0$/, '')} KB`;
}

function storageCapacityLabel(capacityGb: number): string {
  if (capacityGb >= 1000) return `${capacityGb / 1000} TB`;
  return `${capacityGb} GB`;
}

function allowedCheckoutUrl(value: string): boolean {
  try {
    const url = new URL(value, window.location.origin);
    if (url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase();
    return host === 'square.link' || host.endsWith('.square.site') || host.endsWith('.squareup.com');
  } catch {
    return false;
  }
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

function SimpleGrid({ title, items, defaultCreditLabel, description }: {
  title: string;
  items: readonly PlanCreditCard[];
  defaultCreditLabel?: string;
  description?: string;
}) {
  return (
    <section className="plan-credit-section">
      <h2>{title}</h2>
      {description && <p className="plan-credit-section-description">{description}</p>}
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

function StorageSection({ language, previewMode }: { language: 'ja' | 'en'; previewMode: boolean }) {
  const copy = language === 'ja' ? {
    title: '追加ストレージ',
    description: '何度でも購入でき合算されます。',
    loading: 'Storage容量を確認しています…',
    usage: '使用量',
    currentMax: '現在のMaxストレージ',
    planLimit: 'プラン上限',
    remaining: '空き',
    add: '追加する',
    unavailable: '現在のプランではAstera Storageを追加できません。',
    planExceeded: '現在の契約容量がプラン上限を超えているため、新規保存と追加購入を停止しています。',
    purchaseError: 'Storage Checkoutを開始できませんでした。',
  } : {
    title: 'Additional Storage',
    description: 'Purchase as many times as needed; capacities are combined.',
    loading: 'Loading storage capacity…',
    usage: 'Used',
    currentMax: 'Current max storage',
    planLimit: 'Plan limit',
    remaining: 'Available',
    add: 'Add',
    unavailable: 'Astera Storage is not available on the current plan.',
    planExceeded: 'Current capacity exceeds the plan limit. New writes and purchases are suspended.',
    purchaseError: 'Could not start Storage Checkout.',
  };
  const fallbackPacks = storagePackFallbacks(language);
  const [load, setLoad] = useState<StorageLoadState>({ status: 'loading' });
  const [purchase, setPurchase] = useState<StoragePurchaseState>({ status: 'idle' });

  const reload = () => {
    if (previewMode) {
      setLoad({
        status: 'ready',
        data: {
          planId: 'free', planMaxCapacityGb: 0, currentCapacityGb: 0, remainingPurchaseCapacityGb: 0,
          usedBytes: 0, remainingBytes: 0, state: 'inactive', writeAllowed: false, overPlanLimit: false,
          packs: fallbackPacks,
        },
      });
      return;
    }
    setLoad({ status: 'loading' });
    apiRequest('/api/storage/catalog')
      .then((payload) => setLoad({ status: 'ready', data: storageFromPayload(payload) }))
      .catch((error: unknown) => setLoad({ status: 'error', message: error instanceof Error ? error.message : copy.purchaseError }));
  };

  useEffect(() => {
    reload();
    // language changes only alter labels; the server projection is language-neutral.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewMode, language]);

  const startPurchase = async (productId: string) => {
    if (previewMode || load.status !== 'ready' || purchase.status === 'working') return;
    const pack = load.data.packs.find((item) => item.productId === productId);
    if (!pack?.canPurchase) return;
    setPurchase({ status: 'working', productId });
    try {
      const payload = await apiRequest('/api/storage/checkout-intents', {
        method: 'POST',
        body: { product_id: productId },
        idempotent: true,
      });
      const url = recordText(asRecord(payload), ['checkout_url', 'url', 'redirect_url']);
      if (!url || !allowedCheckoutUrl(url)) throw new Error('許可されたSquare Checkout URLを確認できません。');
      window.location.assign(url);
    } catch (error) {
      setPurchase({ status: 'error', message: error instanceof Error ? error.message : copy.purchaseError });
    }
  };

  const displayPacks = load.status === 'ready' && load.data.packs.length > 0 ? load.data.packs : fallbackPacks;

  return (
    <section className="plan-credit-section plan-credit-storage-section">
      <h2>{copy.title}</h2>
      <p className="plan-credit-section-description">{copy.description}</p>

      {load.status === 'loading' && (
        <div className="plan-credit-storage-status">{copy.loading}</div>
      )}
      {load.status === 'error' && (
        <div className="plan-credit-storage-status is-error">
          <span>{load.message}</span>
          <button type="button" onClick={reload}>再試行</button>
        </div>
      )}
      {load.status === 'ready' && (
        <>
          <div className="plan-credit-storage-overview">
            <div className="plan-credit-storage-metrics">
              <div><span>{copy.usage}</span><strong>{formatBytes(load.data.usedBytes)}</strong></div>
              <div><span>{copy.currentMax}</span><strong>{storageCapacityLabel(load.data.currentCapacityGb)}</strong></div>
              <div><span>{copy.planLimit}</span><strong>{storageCapacityLabel(load.data.planMaxCapacityGb)}</strong></div>
            </div>
            <div
              className="plan-credit-storage-gauge"
              role="progressbar"
              aria-label={`${copy.usage} ${formatBytes(load.data.usedBytes)}`}
              aria-valuemin={0}
              aria-valuemax={Math.max(1, load.data.currentCapacityGb * 1024 ** 3)}
              aria-valuenow={Math.min(load.data.usedBytes, Math.max(1, load.data.currentCapacityGb * 1024 ** 3))}
            >
              <span style={{ width: `${load.data.currentCapacityGb > 0 ? Math.min(100, (load.data.usedBytes / (load.data.currentCapacityGb * 1024 ** 3)) * 100) : 0}%` }} />
            </div>
            <div className="plan-credit-storage-remaining">{copy.remaining}: {formatBytes(load.data.remainingBytes)}</div>
          </div>

          {load.data.planMaxCapacityGb <= 0 && <div className="plan-credit-storage-status">{copy.unavailable}</div>}
          {load.data.overPlanLimit && <div className="plan-credit-storage-status is-error">{copy.planExceeded}</div>}
        </>
      )}

      <div className="plan-credit-storage-pack-grid" aria-label={copy.title}>
        {displayPacks.map((pack) => {
          const working = purchase.status === 'working' && purchase.productId === pack.productId;
          const disabled = load.status !== 'ready' || !pack.canPurchase || purchase.status === 'working';
          return (
            <button
              type="button"
              className="plan-credit-card is-credit plan-credit-storage-pack"
              key={pack.productId}
              disabled={disabled}
              aria-label={`${pack.displayName} ¥${pack.priceJpy.toLocaleString('ja-JP')}${pack.canPurchase ? ` ${copy.add}` : ''}`}
              onClick={() => startPurchase(pack.productId)}
            >
              <h3>{pack.displayName}</h3>
              <div className="plan-credit-price">{working ? 'Checkout…' : `¥${pack.priceJpy.toLocaleString('ja-JP')}`}</div>
            </button>
          );
        })}
      </div>
      {purchase.status === 'error' && <div className="plan-credit-storage-status is-error">{purchase.message}</div>}
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
        <StorageSection language={language} previewMode={previewMode} />
      </div>
    </ResponsivePageShell>
  );
}
