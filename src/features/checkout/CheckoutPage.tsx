import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppText } from '../../app-text';
import { nativeCallback, openExternalUrl } from '../../platform/external-navigation';
import { resolvedApiBase } from '../../platform/api-client';
import type { RouteMatch } from '../../platform/route-registry';
import { BusyState, ResponsivePageShell } from '../../platform/ResponsivePageShell';
import { Panel } from '../../platform/pages/page-kit';
import { PLAN_CREDIT_TEXT } from '../navigation/plan-credit-text';

type JsonRecord = Record<string, unknown>;
type CheckoutReturnTo = 'pricing' | 'plan-credit' | 'app';
type BillingCycle = 'monthly' | 'annual';
type ConnectionState =
  | { status: 'loading' }
  | { status: 'login-required' }
  | { status: 'ready'; currentPlan: string }
  | { status: 'submitting'; currentPlan: string }
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

function planSupportsCycle(plan: JsonRecord, cycle: BillingCycle): boolean {
  if (!Array.isArray(plan.billing_variants)) return cycle === 'monthly';
  return plan.billing_variants.some((variant) => {
    if (!isRecord(variant)) return false;
    return firstText(variant, ['billing_cycle']) === cycle && variant.active !== false;
  });
}

function validateServerPlan(payload: unknown, planId: string, cycle: BillingCycle): { currentPlan: string } | null {
  if (!isRecord(payload)) return null;
  const data = isRecord(payload.data) ? payload.data : {};
  const account = isRecord(payload.account) ? payload.account : {};
  const selected = planArray(payload).find((item) =>
    isRecord(item) && firstText(item, ['plan_id', 'id', 'key', 'slug']) === planId,
  );
  if (!isRecord(selected) || !planSupportsCycle(selected, cycle)) return null;
  return {
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
    if (url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase();
    return host === 'square.link' || host.endsWith('.square.site') || host.endsWith('.squareup.com');
  } catch {
    return false;
  }
}

function checkoutReturnTo(value: string | null): CheckoutReturnTo {
  if (value === 'pricing' || value === 'plan-credit') return value;
  return 'app';
}

function checkoutReturnPath(value: CheckoutReturnTo): string {
  if (value === 'pricing') return '/pricing';
  if (value === 'plan-credit') return '/app/plan-credit';
  return '/app';
}

function parseBillingCycle(value: string | null): BillingCycle {
  return value === 'annual' ? 'annual' : 'monthly';
}

export default function CheckoutPage({ route }: { route: RouteMatch }) {
  const { language } = useAppText();
  const pageText = PLAN_CREDIT_TEXT[language];
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const planId = params.get('plan')?.trim().toLowerCase() ?? '';
  const billingCycle = parseBillingCycle(params.get('billing'));
  const returnTo = checkoutReturnTo(params.get('return_to'));
  const returnPath = checkoutReturnPath(returnTo);
  const selectedPlan = pageText.plans.find((plan) => plan.id === planId) ?? null;
  const [state, setState] = useState<ConnectionState>({ status: 'loading' });
  const [accepted, setAccepted] = useState(false);
  const requestRef = useRef<AbortController | null>(null);
  const checkoutRef = useRef<AbortController | null>(null);

  const price = selectedPlan
    ? billingCycle === 'annual' ? selectedPlan.annualPrice : selectedPlan.monthlyPrice
    : '';
  const cycleLabel = billingCycle === 'annual' ? pageText.billingAnnual : pageText.billingMonthly;

  const loadAccountCatalog = useCallback(async () => {
    if (!planId || planId === 'free' || !selectedPlan) {
      setState({ status: 'error', message: 'PLAN_CHECKOUT_NOT_REQUIRED' });
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
      if (response.status === 401) {
        setState({ status: 'login-required' });
        return;
      }
      if (!response.ok) throw new Error(`ACCOUNT_CATALOG_HTTP_${response.status}`);
      const payload: unknown = await response.json();
      const validated = validateServerPlan(payload, planId, billingCycle);
      if (!validated) throw new Error('PLAN_BILLING_VARIANT_NOT_AVAILABLE');
      setState({ status: 'ready', currentPlan: validated.currentPlan });
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
  }, [billingCycle, planId, selectedPlan]);

  useEffect(() => {
    void loadAccountCatalog();
    return () => {
      requestRef.current?.abort('unmount');
      checkoutRef.current?.abort('unmount');
    };
  }, [loadAccountCatalog]);

  const createCheckoutIntent = async () => {
    if (state.status !== 'ready' || !accepted || checkoutRef.current) return;
    const currentPlan = state.currentPlan;
    const controller = new AbortController();
    checkoutRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort('timeout'), REQUEST_TIMEOUT_MS);
    const idempotencyKey = crypto.randomUUID();
    setState({ status: 'submitting', currentPlan });

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
          billing_cycle: billingCycle,
          return_to: returnTo,
          native_callback: nativeCallback('/account/billing/status'),
        }),
        signal: controller.signal,
      });
      if (response.status === 401) {
        setState({ status: 'login-required' });
        return;
      }
      if (!response.ok) throw new Error(`CHECKOUT_INTENT_HTTP_${response.status}`);
      const payload: unknown = await response.json();
      const destination = checkoutUrl(payload);
      if (!destination || !isAllowedCheckoutUrl(destination)) throw new Error('CHECKOUT_URL_REJECTED');
      await openExternalUrl(destination);
      setState({ status: 'ready', currentPlan });
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
    <ResponsivePageShell route={route}>
      {state.status === 'loading' && (
        <Panel title="選択内容を確認">
          <BusyState label="Accountと選択内容を確認しています…" />
        </Panel>
      )}

      {state.status === 'login-required' && (
        <Panel title="Loginが必要です">
          <p>決済へ進むにはLoginが必要です。</p>
          <div className="platform-action-row">
            <a className="platform-button is-primary" href={`/login?return_to=${loginReturn}`}>Login</a>
            <a className="platform-button" href={`/register?return_to=${loginReturn}`}>Account登録</a>
            <a className="platform-button" href={returnPath}>戻る</a>
          </div>
        </Panel>
      )}

      {(state.status === 'ready' || state.status === 'submitting') && selectedPlan && (
        <>
          <Panel title="選択内容">
            <dl className="platform-kv-grid">
              <div><dt>プラン</dt><dd>{selectedPlan.name}</dd></div>
              <div><dt>請求周期</dt><dd>{cycleLabel}</dd></div>
              <div><dt>料金</dt><dd>{price}</dd></div>
              <div><dt>現在のプラン</dt><dd>{state.currentPlan}</dd></div>
            </dl>
          </Panel>

          <Panel title="確認">
            <label className="platform-toggle-row">
              <span><strong>選択内容を確認しました</strong></span>
              <input
                type="checkbox"
                checked={accepted}
                onChange={(event) => setAccepted(event.target.checked)}
                disabled={state.status === 'submitting'}
              />
            </label>
            <div className="platform-action-row">
              <button
                className="platform-button is-primary"
                type="button"
                disabled={!accepted || state.status === 'submitting'}
                onClick={() => void createCheckoutIntent()}
              >
                {state.status === 'submitting' ? 'Checkoutを準備中…' : 'Square Checkoutへ進む'}
              </button>
              <a className="platform-button" href={returnPath}>戻る</a>
            </div>
          </Panel>
        </>
      )}

      {state.status === 'error' && (
        <Panel title="Checkoutを開始できません">
          <div className="platform-form-result is-error" role="alert">
            <strong>Accountと決済状態を確認できませんでした。</strong>
            <code>{state.message}</code>
          </div>
          <div className="platform-action-row">
            <button className="platform-button is-primary" type="button" onClick={() => void loadAccountCatalog()}>再確認</button>
            <a className="platform-button" href={returnPath}>戻る</a>
          </div>
        </Panel>
      )}
    </ResponsivePageShell>
  );
}
