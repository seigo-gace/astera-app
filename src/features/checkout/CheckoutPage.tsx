import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { nativeCallback, openExternalUrl } from '../../platform/external-navigation';
import { resolvedApiBase } from '../../platform/api-client';

type JsonRecord = Record<string, unknown>;

type CheckoutState =
  | { status: 'loading' }
  | { status: 'login-required' }
  | { status: 'ready'; planName: string; priceLabel: string; currentPlan: string }
  | { status: 'submitting'; planName: string; priceLabel: string; currentPlan: string }
  | { status: 'error'; message: string };

const API_BASE = resolvedApiBase();
const ACCOUNT_CATALOG_ENDPOINT = `${API_BASE}/api/account/catalog`;
const CHECKOUT_INTENT_ENDPOINT = `${API_BASE}/api/billing/checkout-intents`;
const REQUEST_TIMEOUT_MS = 15_000;

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

function planArray(payload: unknown): unknown[] {
  if (!isRecord(payload)) return [];
  const data = isRecord(payload.data) ? payload.data : null;
  const account = isRecord(payload.account) ? payload.account : null;
  const candidates = [payload.plans, payload.available_plans, data?.plans, data?.available_plans, account?.plans];
  return (candidates.find(Array.isArray) as unknown[] | undefined) ?? [];
}

function normalizePlan(payload: unknown, planId: string): { planName: string; priceLabel: string; currentPlan: string } | null {
  if (!isRecord(payload)) return null;
  const data = isRecord(payload.data) ? payload.data : {};
  const account = isRecord(payload.account) ? payload.account : {};
  const selected = planArray(payload).find((item) => {
    if (!isRecord(item)) return false;
    return firstText(item, ['plan_id', 'id', 'key', 'slug']) === planId;
  });
  if (!isRecord(selected)) return null;

  return {
    planName: firstText(selected, ['display_name', 'name', 'title']) || planId,
    priceLabel: firstText(selected, ['price_label', 'display_price', 'monthly_price_label']) || 'Catalogで確認',
    currentPlan:
      firstText(account, ['current_plan_name', 'current_plan_id']) ||
      firstText(data, ['current_plan_name', 'current_plan_id']) ||
      firstText(payload, ['current_plan_name', 'current_plan_id']) ||
      '未契約',
  };
}

function checkoutUrl(payload: unknown): string {
  if (!isRecord(payload)) return '';
  const data = isRecord(payload.data) ? payload.data : {};
  return firstText(payload, ['checkout_url', 'url', 'redirect_url']) || firstText(data, ['checkout_url', 'url', 'redirect_url']);
}

function isAllowedCheckoutUrl(value: string): boolean {
  try {
    const url = new URL(value, window.location.origin);
    if (url.origin === window.location.origin) return true;
    if (url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase();
    return host === 'square.link' || host.endsWith('.square.site') || host.endsWith('.squareup.com');
  } catch {
    return false;
  }
}

export default function CheckoutPage() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const planId = params.get('plan')?.trim() ?? '';
  const returnTo = params.get('return_to') === 'pricing' ? 'pricing' : 'app';
  const returnPath = returnTo === 'pricing' ? '/pricing' : '/app';
  const [state, setState] = useState<CheckoutState>({ status: 'loading' });
  const [accepted, setAccepted] = useState(false);
  const requestRef = useRef<AbortController | null>(null);
  const checkoutRef = useRef<AbortController | null>(null);

  const loadAccountCatalog = useCallback(async () => {
    if (!planId) {
      setState({ status: 'error', message: 'PLAN_ID_REQUIRED' });
      return;
    }

    requestRef.current?.abort('superseded');
    const controller = new AbortController();
    requestRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort('timeout'), REQUEST_TIMEOUT_MS);
    setState({ status: 'loading' });

    try {
      const response = await fetch(ACCOUNT_CATALOG_ENDPOINT, {
        method: 'GET',
        credentials: 'include',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      if (response.status === 401 || response.status === 403) {
        setState({ status: 'login-required' });
        return;
      }
      if (!response.ok) throw new Error(`ACCOUNT_CATALOG_HTTP_${response.status}`);
      const payload: unknown = await response.json();
      const plan = normalizePlan(payload, planId);
      if (!plan) throw new Error('PLAN_NOT_AVAILABLE_FOR_ACCOUNT');
      setState({ status: 'ready', ...plan });
    } catch (error) {
      if (controller.signal.aborted) {
        if (controller.signal.reason === 'timeout') setState({ status: 'error', message: 'ACCOUNT_CATALOG_TIMEOUT' });
        return;
      }
      setState({ status: 'error', message: error instanceof Error ? error.message : 'ACCOUNT_CATALOG_UNKNOWN_ERROR' });
    } finally {
      window.clearTimeout(timeout);
      if (requestRef.current === controller) requestRef.current = null;
    }
  }, [planId]);

  useEffect(() => {
    document.title = 'Checkout確認 | Astera App';
    void loadAccountCatalog();
    return () => {
      requestRef.current?.abort('unmount');
      checkoutRef.current?.abort('unmount');
    };
  }, [loadAccountCatalog]);

  const createCheckoutIntent = async () => {
    if (state.status !== 'ready' || !accepted || checkoutRef.current) return;
    const snapshot = state;
    const controller = new AbortController();
    checkoutRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort('timeout'), REQUEST_TIMEOUT_MS);
    const idempotencyKey = crypto.randomUUID();
    setState({ ...snapshot, status: 'submitting' });

    try {
      const response = await fetch(CHECKOUT_INTENT_ENDPOINT, {
        method: 'POST',
        credentials: 'include',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
          'X-Request-ID': idempotencyKey,
        },
        body: JSON.stringify({
          plan_id: planId,
          return_to: returnTo,
          native_callback: nativeCallback('/account/billing/status'),
        }),
        signal: controller.signal,
      });
      if (response.status === 401 || response.status === 403) {
        setState({ status: 'login-required' });
        return;
      }
      if (!response.ok) throw new Error(`CHECKOUT_INTENT_HTTP_${response.status}`);
      const payload: unknown = await response.json();
      const destination = checkoutUrl(payload);
      if (!destination || !isAllowedCheckoutUrl(destination)) throw new Error('CHECKOUT_URL_REJECTED');
      await openExternalUrl(destination);
      setState({ ...snapshot, status: 'ready' });
    } catch (error) {
      if (controller.signal.aborted) {
        if (controller.signal.reason === 'timeout') setState({ status: 'error', message: 'CHECKOUT_INTENT_TIMEOUT' });
        return;
      }
      setState({ status: 'error', message: error instanceof Error ? error.message : 'CHECKOUT_INTENT_UNKNOWN_ERROR' });
    } finally {
      window.clearTimeout(timeout);
      if (checkoutRef.current === controller) checkoutRef.current = null;
    }
  };

  const loginReturn = encodeURIComponent(window.location.pathname + window.location.search);

  return (
    <main className="checkout-page" aria-busy={state.status === 'loading' || state.status === 'submitting'}>
      <style>{`
        .checkout-page{min-height:100dvh;display:grid;place-items:center;padding:calc(24px + env(safe-area-inset-top,0px)) calc(24px + env(safe-area-inset-right,0px)) calc(24px + env(safe-area-inset-bottom,0px)) calc(24px + env(safe-area-inset-left,0px));background:radial-gradient(circle at 50% 10%,rgba(178,109,48,.14),transparent 34%),var(--bg-primary,#050505);color:var(--text-primary,#f6f4ef);font-family:Inter,system-ui,-apple-system,"Segoe UI","Noto Sans JP",sans-serif}.checkout-page *{box-sizing:border-box}.checkout-card{width:min(620px,100%);border:1px solid var(--border-color,rgba(255,255,255,.14));background:linear-gradient(150deg,color-mix(in srgb,var(--text-primary) 7%,transparent),color-mix(in srgb,var(--text-primary) 2%,transparent));padding:clamp(24px,5vw,44px);box-shadow:0 30px 100px var(--shadow,rgba(0,0,0,.45))}.checkout-brand{display:flex;align-items:center;gap:12px;margin-bottom:34px;color:inherit;text-decoration:none}.checkout-brand img{width:42px;height:42px;filter:var(--logo-filter)}.checkout-brand strong{letter-spacing:.18em}.checkout-kicker{font-size:11px;letter-spacing:.2em;color:var(--platform-accent,#d6ad70)}.checkout-card h1{font-size:clamp(34px,7vw,56px);letter-spacing:-.05em;margin:12px 0 22px}.checkout-status{padding:18px;border:1px solid var(--border-color,rgba(255,255,255,.1));background:color-mix(in srgb,var(--text-primary) 3.5%,transparent);line-height:1.8}.checkout-plan{display:grid;gap:9px;margin:24px 0;padding:20px;border:1px solid rgba(214,173,112,.36)}.checkout-plan strong{font-size:24px}.checkout-plan span{color:var(--text-tertiary,#b9b4ab)}.checkout-current{font-size:12px;color:var(--text-tertiary,#918c84)}.checkout-consent{display:flex;align-items:flex-start;gap:10px;color:var(--text-secondary,#cbc6bd);line-height:1.65;margin:22px 0}.checkout-consent input{margin-top:.35em}.checkout-actions{display:flex;gap:10px;flex-wrap:wrap}.checkout-primary,.checkout-secondary{min-height:48px;padding:0 18px;font:inherit;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;justify-content:center}.checkout-primary{border:1px solid rgba(214,173,112,.62);background:linear-gradient(135deg,rgba(161,94,39,.48),rgba(214,173,112,.14));color:var(--text-primary,#fff)}.checkout-primary:disabled{opacity:.46;cursor:not-allowed}.checkout-secondary{border:1px solid var(--border-color,rgba(255,255,255,.16));background:transparent;color:var(--text-secondary,#dedad2)}.checkout-error{margin-top:14px;color:var(--platform-danger,#f0b8aa);font-family:ui-monospace,monospace;font-size:12px;overflow-wrap:anywhere}html[data-theme="light"] .checkout-page{background:var(--bg-primary,#f4f3ef);color:var(--text-primary,#121212)}html[data-theme="light"] .checkout-card{background:var(--bg-primary,#fff);border-color:var(--border-color,rgba(0,0,0,.14))}@media(max-width:600px){.checkout-page{padding-inline:14px}.checkout-card{padding:22px 17px}.checkout-actions{display:grid}.checkout-primary,.checkout-secondary{width:100%}}
      `}</style>

      <section className="checkout-card">
        <a className="checkout-brand" href={returnPath}>
          <img src="/logo-mark.svg" alt="" />
          <span><strong>ASTERA</strong> APP</span>
        </a>
        <div className="checkout-kicker">ACCOUNT / CHECKOUT GATE</div>
        <h1>Plan選択の確認</h1>

        {state.status === 'loading' && <div className="checkout-status" role="status">Accountと選択可能なPlanを確認しています…</div>}

        {state.status === 'login-required' && (
          <div className="checkout-status">
            <p>決済へ進む前に、Astera AccountへのLoginまたは登録が必要です。選択したPlanは復帰後も維持します。</p>
            <div className="checkout-actions">
              <a className="checkout-primary" href={`/login?return_to=${loginReturn}`}>Login</a>
              <a className="checkout-secondary" href={`/register?return_to=${loginReturn}`}>Account登録</a>
              <a className="checkout-secondary" href={returnPath}>料金Pageへ戻る</a>
            </div>
          </div>
        )}

        {(state.status === 'ready' || state.status === 'submitting') && (
          <>
            <div className="checkout-plan">
              <strong>{state.planName}</strong>
              <span>{state.priceLabel}</span>
              <span className="checkout-current">現在のPlan: {state.currentPlan}</span>
            </div>
            <label className="checkout-consent">
              <input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} disabled={state.status === 'submitting'} />
              <span>料金、Credit、契約条件を確認し、Serverが再確認したPlan内容でSquare Checkoutへ進むことに同意します。</span>
            </label>
            <div className="checkout-actions">
              <button className="checkout-primary" type="button" disabled={!accepted || state.status === 'submitting'} onClick={() => void createCheckoutIntent()}>
                {state.status === 'submitting' ? 'Checkoutを準備中…' : 'Square Checkoutへ進む'}
              </button>
              <a className="checkout-secondary" href={returnPath}>戻る</a>
            </div>
          </>
        )}

        {state.status === 'error' && (
          <div className="checkout-status" role="alert">
            <p>Checkoutを開始できません。入力値ではなくAccount CatalogとServer状態を確認して安全停止しました。</p>
            <div className="checkout-error">{state.message}</div>
            <div className="checkout-actions">
              <button className="checkout-primary" type="button" onClick={() => void loadAccountCatalog()}>再確認</button>
              <a className="checkout-secondary" href={returnPath}>戻る</a>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
