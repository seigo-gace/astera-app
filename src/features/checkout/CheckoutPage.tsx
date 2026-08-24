import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { nativeCallback, openExternalUrl } from '../../platform/external-navigation';
import { resolvedApiBase } from '../../platform/api-client';
import type { RouteMatch } from '../../platform/route-registry';
import { BusyState, ResponsivePageShell } from '../../platform/ResponsivePageShell';
import { Panel } from '../../platform/pages/page-kit';

type JsonRecord = Record<string, unknown>;

type CheckoutState =
  | { status: 'loading' }
  | { status: 'login-required' }
  | { status: 'ready'; planName: string; priceLabel: string; currentPlan: string }
  | { status: 'submitting'; planName: string; priceLabel: string; currentPlan: string }
  | { status: 'error'; message: string };

type CheckoutReturnTo = 'pricing' | 'plan-credit' | 'app';

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

function checkoutReturnTo(value: string | null): CheckoutReturnTo {
  if (value === 'pricing' || value === 'plan-credit') return value;
  return 'app';
}

function checkoutReturnPath(value: CheckoutReturnTo): string {
  if (value === 'pricing') return '/pricing';
  if (value === 'plan-credit') return '/app/plan-credit';
  return '/app';
}

function checkoutReturnLabel(value: CheckoutReturnTo): string {
  if (value === 'pricing') return '料金Pageへ戻る';
  if (value === 'plan-credit') return 'プラン / クレジットへ戻る';
  return 'Appへ戻る';
}

export default function CheckoutPage({ route }: { route: RouteMatch }) {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const planId = params.get('plan')?.trim() ?? '';
  const returnTo = checkoutReturnTo(params.get('return_to'));
  const returnPath = checkoutReturnPath(returnTo);
  const returnLabel = checkoutReturnLabel(returnTo);
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
    <ResponsivePageShell route={route}>
      {state.status === 'loading' && (
        <Panel title="Planを確認">
          <BusyState label="Accountと選択可能なPlanを確認しています…" />
        </Panel>
      )}

      {state.status === 'login-required' && (
        <Panel title="Loginが必要です">
          <p>決済へ進む前にAstera AccountへのLoginまたは登録が必要です。選択したPlanは復帰後も維持します。</p>
          <div className="platform-action-row">
            <a className="platform-button is-primary" href={`/login?return_to=${loginReturn}`}>Login</a>
            <a className="platform-button" href={`/register?return_to=${loginReturn}`}>Account登録</a>
            <a className="platform-button" href={returnPath}>{returnLabel}</a>
          </div>
        </Panel>
      )}

      {(state.status === 'ready' || state.status === 'submitting') && (
        <>
          <Panel title="選択内容">
            <dl className="platform-kv-grid">
              <div><dt>選択Plan</dt><dd>{state.planName}</dd></div>
              <div><dt>料金</dt><dd>{state.priceLabel}</dd></div>
              <div><dt>現在のPlan</dt><dd>{state.currentPlan}</dd></div>
            </dl>
          </Panel>

          <Panel title="確認">
            <label className="platform-toggle-row">
              <span><strong>料金、Credit、契約条件を確認しました</strong></span>
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
              <a className="platform-button" href={returnPath}>{returnLabel}</a>
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
            <a className="platform-button" href={returnPath}>{returnLabel}</a>
          </div>
        </Panel>
      )}
    </ResponsivePageShell>
  );
}
