import { useCallback, useEffect, useRef, useState } from 'react';

type JsonRecord = Record<string, unknown>;

type PublicPlan = {
  id: string;
  name: string;
  description: string;
  price: string;
  credits: string;
  features: string[];
  recommended: boolean;
};

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; plans: PublicPlan[]; version: string }
  | { status: 'error'; message: string };

const API_BASE = (import.meta.env.VITE_ASTERA_API_BASE as string | undefined)?.replace(/\/$/, '') ?? '';
const CATALOG_ENDPOINT = `${API_BASE}/api/catalog/public`;
const CATALOG_TIMEOUT_MS = 12_000;

const copy = {
  ja: {
    eyebrow: 'ASTERA APP / PRICING',
    title: '料金と利用枠',
    lead: '料金・月次Credit・機能差は、Asteraの公開Catalogから取得して表示します。',
    loading: '最新の料金情報を確認しています…',
    errorTitle: '料金情報を取得できませんでした',
    retry: '再読み込み',
    select: 'このPlanを選ぶ',
    credits: '月次Credit',
    features: '利用できる機能',
    recommended: 'おすすめ',
    empty: '公開可能なPlanがCatalogにありません。',
    back: 'Astera Appへ戻る',
    note: 'Plan選択後、Account登録またはLoginを確認してからCheckoutへ進みます。',
    version: 'Catalog Version',
  },
  en: {
    eyebrow: 'ASTERA APP / PRICING',
    title: 'Plans and credits',
    lead: 'Prices, monthly credits, and entitlements are loaded from the public Astera catalog.',
    loading: 'Loading the latest pricing catalog…',
    errorTitle: 'The pricing catalog is unavailable',
    retry: 'Retry',
    select: 'Choose this plan',
    credits: 'Monthly credits',
    features: 'Included features',
    recommended: 'Recommended',
    empty: 'No public plans are available in the catalog.',
    back: 'Back to Astera App',
    note: 'After selecting a plan, account registration or login is confirmed before checkout.',
    version: 'Catalog Version',
  },
} as const;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function firstText(record: JsonRecord, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}

function firstBoolean(record: JsonRecord, keys: string[]): boolean {
  for (const key of keys) {
    if (typeof record[key] === 'boolean') return record[key] as boolean;
  }
  return false;
}

function formatPrice(record: JsonRecord, language: 'ja' | 'en'): string {
  const direct = firstText(record, ['price_label', 'display_price', 'monthly_price_label']);
  if (direct) return direct;

  const raw = record.monthly_price_yen ?? record.price_yen ?? record.monthly_price ?? record.amount;
  const value = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : Number.NaN;
  if (!Number.isFinite(value)) return language === 'ja' ? 'Catalog参照' : 'See catalog';

  return language === 'ja'
    ? `¥${Math.round(value).toLocaleString('ja-JP')} / 月`
    : `¥${Math.round(value).toLocaleString('en-US')} / month`;
}

function normalizeFeatures(record: JsonRecord): string[] {
  const source = record.features ?? record.entitlements ?? record.included_features;
  if (!Array.isArray(source)) return [];

  return source.flatMap((item) => {
    if (typeof item === 'string' && item.trim()) return [item.trim()];
    if (!isRecord(item)) return [];
    const text = firstText(item, ['label', 'name', 'display_name', 'description']);
    return text ? [text] : [];
  });
}

function findPlanArray(payload: unknown): unknown[] {
  if (!isRecord(payload)) return [];
  const data = isRecord(payload.data) ? payload.data : null;
  const result = isRecord(payload.result) ? payload.result : null;
  const candidates = [
    payload.plans,
    payload.plan_catalog,
    payload.items,
    data?.plans,
    data?.plan_catalog,
    result?.plans,
    result?.plan_catalog,
  ];
  return (candidates.find(Array.isArray) as unknown[] | undefined) ?? [];
}

function normalizeCatalog(payload: unknown, language: 'ja' | 'en'): { plans: PublicPlan[]; version: string } {
  const root = isRecord(payload) ? payload : {};
  const data = isRecord(root.data) ? root.data : {};
  const version = firstText(root, ['catalog_version', 'version']) || firstText(data, ['catalog_version', 'version']) || 'unknown';

  const plans = findPlanArray(payload).flatMap((item) => {
    if (!isRecord(item)) return [];
    const id = firstText(item, ['plan_id', 'id', 'key', 'slug']);
    const name = firstText(item, ['display_name', 'name', 'title']);
    if (!id || !name) return [];

    const credits = firstText(item, ['monthly_credits_label', 'monthly_credits', 'credit_amount', 'credits']);
    return [{
      id,
      name,
      description: firstText(item, ['description', 'summary', 'target_user']),
      price: formatPrice(item, language),
      credits: credits || (language === 'ja' ? 'Catalog参照' : 'See catalog'),
      features: normalizeFeatures(item),
      recommended: firstBoolean(item, ['recommended', 'is_recommended']),
    }];
  });

  return { plans, version };
}

export default function PricingPage() {
  const language: 'ja' | 'en' = document.documentElement.lang.toLowerCase().startsWith('en') ? 'en' : 'ja';
  const text = copy[language];
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const requestRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    requestRef.current?.abort('superseded');
    const controller = new AbortController();
    requestRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort('timeout'), CATALOG_TIMEOUT_MS);
    setState({ status: 'loading' });

    try {
      const response = await fetch(CATALOG_ENDPOINT, {
        method: 'GET',
        credentials: 'include',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`CATALOG_HTTP_${response.status}`);
      const payload: unknown = await response.json();
      const normalized = normalizeCatalog(payload, language);
      if (!controller.signal.aborted) setState({ status: 'ready', ...normalized });
    } catch (error) {
      if (controller.signal.aborted) {
        if (controller.signal.reason === 'timeout') setState({ status: 'error', message: 'CATALOG_TIMEOUT' });
        return;
      }
      const message = error instanceof Error ? error.message : 'CATALOG_UNKNOWN_ERROR';
      setState({ status: 'error', message });
    } finally {
      window.clearTimeout(timeout);
      if (requestRef.current === controller) requestRef.current = null;
    }
  }, [language]);

  useEffect(() => {
    document.title = language === 'ja' ? '料金と利用枠 | Astera App' : 'Plans and credits | Astera App';
    void load();
    return () => requestRef.current?.abort('unmount');
  }, [language, load]);

  const choosePlan = (planId: string) => {
    const query = new URLSearchParams({ plan: planId, return_to: 'pricing' });
    window.location.assign(`/account/checkout?${query.toString()}`);
  };

  return (
    <main className="pricing-page" aria-busy={state.status === 'loading'}>
      <style>{`
        .pricing-page{min-height:100svh;background:radial-gradient(circle at 50% 0,rgba(176,112,54,.12),transparent 35%),var(--bg-primary,#050505);color:var(--text-primary,#f5f5f2);padding:28px clamp(18px,4vw,64px) 64px;font-family:Inter,system-ui,-apple-system,"Segoe UI","Noto Sans JP",sans-serif}.pricing-page *{box-sizing:border-box}.pricing-top{max-width:1180px;margin:0 auto;display:flex;justify-content:space-between;align-items:center;gap:18px}.pricing-brand{display:flex;align-items:center;gap:12px;color:inherit;text-decoration:none}.pricing-brand img{width:42px;height:42px;filter:var(--logo-filter)}.pricing-brand strong{letter-spacing:.18em}.pricing-back{color:var(--text-secondary,#d8d4ca);text-decoration:none;border:1px solid var(--border-color,rgba(255,255,255,.16));padding:10px 14px;border-radius:999px}.pricing-hero{max-width:920px;margin:72px auto 42px;text-align:center}.pricing-eyebrow{font-size:11px;letter-spacing:.22em;color:var(--platform-accent,#d6ad70)}.pricing-hero h1{font-size:clamp(44px,8vw,82px);letter-spacing:-.065em;line-height:.95;margin:16px 0}.pricing-hero p{max-width:720px;margin:0 auto;color:var(--text-tertiary,#bcb8b0);line-height:1.9}.pricing-status{max-width:720px;margin:32px auto;padding:24px;border:1px solid var(--border-color,rgba(255,255,255,.12));background:color-mix(in srgb,var(--text-primary) 3.5%,transparent);text-align:center}.pricing-grid{max-width:1180px;margin:0 auto;display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:16px}.pricing-card{position:relative;display:flex;flex-direction:column;min-height:410px;padding:24px;border:1px solid var(--border-color,rgba(255,255,255,.13));background:linear-gradient(155deg,color-mix(in srgb,var(--text-primary) 6%,transparent),color-mix(in srgb,var(--text-primary) 1.8%,transparent));box-shadow:0 20px 70px var(--shadow,rgba(0,0,0,.28))}.pricing-card.is-recommended{border-color:rgba(214,173,112,.62);box-shadow:0 24px 85px rgba(118,70,27,.22)}.pricing-badge{position:absolute;right:16px;top:16px;font-size:10px;letter-spacing:.12em;color:var(--platform-accent,#f2d39d)}.pricing-card h2{font-size:28px;margin:14px 0 4px}.pricing-description{min-height:52px;color:var(--text-tertiary,#aaa69e);line-height:1.7}.pricing-price{font-size:25px;font-weight:700;margin:22px 0 8px}.pricing-credits{color:var(--platform-accent,#d9c6a5);font-size:13px}.pricing-feature-title{margin:24px 0 10px;font-size:12px;color:var(--text-tertiary,#c7c2b8)}.pricing-features{margin:0 0 26px;padding:0;list-style:none;display:grid;gap:9px;color:var(--text-secondary,#d2cec6);font-size:13px;line-height:1.6}.pricing-features li:before{content:"✓";color:var(--platform-accent,#d6ad70);margin-right:9px}.pricing-select{margin-top:auto;min-height:46px;border:1px solid rgba(214,173,112,.62);background:linear-gradient(135deg,rgba(154,91,39,.42),rgba(214,173,112,.12));color:var(--text-primary,#fff);cursor:pointer;font:inherit}.pricing-select:hover{background:linear-gradient(135deg,rgba(176,105,45,.58),rgba(214,173,112,.2))}.pricing-meta{max-width:1180px;margin:28px auto 0;display:flex;justify-content:space-between;gap:18px;color:var(--text-tertiary,#8e8a82);font-size:11px;line-height:1.6}.pricing-retry{margin-top:16px;border:1px solid rgba(214,173,112,.55);background:transparent;color:var(--text-primary,#f5f5f2);padding:10px 16px;cursor:pointer}@media(max-width:680px){.pricing-page{padding:18px 14px 42px}.pricing-brand span{display:none}.pricing-hero{margin:48px auto 30px}.pricing-meta{display:grid}.pricing-card{min-height:0}}html[data-theme="light"] .pricing-page{background:var(--bg-primary,#f4f3ef);color:var(--text-primary,#121212)}html[data-theme="light"] .pricing-page .pricing-card{border-color:var(--border-color,rgba(0,0,0,.14));background:color-mix(in srgb,var(--bg-primary) 78%,transparent)}html[data-theme="light"] .pricing-page .pricing-description,html[data-theme="light"] .pricing-page .pricing-hero p,html[data-theme="light"] .pricing-page .pricing-features{color:var(--text-tertiary,#5e5a54)}
      `}</style>

      <header className="pricing-top">
        <a className="pricing-brand" href="/app" aria-label="Astera App">
          <img src="/logo-mark.svg" alt="" />
          <span><strong>ASTERA</strong> APP</span>
        </a>
        <a className="pricing-back" href="/app">{text.back}</a>
      </header>

      <section className="pricing-hero">
        <div className="pricing-eyebrow">{text.eyebrow}</div>
        <h1>{text.title}</h1>
        <p>{text.lead}</p>
      </section>

      {state.status === 'loading' && <div className="pricing-status" role="status">{text.loading}</div>}

      {state.status === 'error' && (
        <div className="pricing-status" role="alert">
          <strong>{text.errorTitle}</strong>
          <div><code>{state.message}</code></div>
          <button className="pricing-retry" type="button" onClick={() => void load()}>{text.retry}</button>
        </div>
      )}

      {state.status === 'ready' && state.plans.length === 0 && (
        <div className="pricing-status">{text.empty}</div>
      )}

      {state.status === 'ready' && state.plans.length > 0 && (
        <section className="pricing-grid" aria-label={text.title}>
          {state.plans.map((plan) => (
            <article className={`pricing-card${plan.recommended ? ' is-recommended' : ''}`} key={plan.id}>
              {plan.recommended && <span className="pricing-badge">{text.recommended}</span>}
              <h2>{plan.name}</h2>
              <p className="pricing-description">{plan.description}</p>
              <div className="pricing-price">{plan.price}</div>
              <div className="pricing-credits">{text.credits}: {plan.credits}</div>
              <div className="pricing-feature-title">{text.features}</div>
              <ul className="pricing-features">
                {plan.features.map((feature) => <li key={feature}>{feature}</li>)}
              </ul>
              <button className="pricing-select" type="button" onClick={() => choosePlan(plan.id)}>
                {text.select}
              </button>
            </article>
          ))}
        </section>
      )}

      <footer className="pricing-meta">
        <span>{text.note}</span>
        {state.status === 'ready' && <span>{text.version}: {state.version}</span>}
      </footer>
    </main>
  );
}
