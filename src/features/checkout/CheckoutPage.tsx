import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppText } from '../../app-text';
import { nativeCallback, openExternalUrl } from '../../platform/external-navigation';
import { resolvedApiBase } from '../../platform/api-client';
import type { RouteMatch } from '../../platform/route-registry';
import { ResponsivePageShell } from '../../platform/ResponsivePageShell';
import { PLAN_CREDIT_TEXT } from '../navigation/plan-credit-text';
import { CHECKOUT_TEXT } from './checkout-text';
import './checkout-page.css';

type JsonRecord = Record<string, unknown>;
type Language = keyof typeof CHECKOUT_TEXT;
type CheckoutReturnTo = 'pricing' | 'plan-credit' | 'app';

type ConnectionState =
  | { status: 'checking' }
  | { status: 'ready'; currentPlan: string }
  | { status: 'login-required' }
  | { status: 'error'; message: string };

type SubmitState =
  | { status: 'idle' }
  | { status: 'submitting' }
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

function validateServerPlan(payload: unknown, planId: string): { currentPlan: string } | null {
  if (!isRecord(payload)) return null;
  const data = isRecord(payload.data) ? payload.data : {};
  const account = isRecord(payload.account) ? payload.account : {};
  const selected = planArray(payload).find((item) => {
    if (!isRecord(item)) return false;
    return firstText(item, ['plan_id', 'id', 'key', 'slug']) === planId;
  });
  if (!isRecord(selected)) return null;
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

function checkoutReturnLabel(value: CheckoutReturnTo, language: Language): string {
  const text = CHECKOUT_TEXT[language];
  if (value === 'pricing') return text.backPricing;
  if (value === 'plan-credit') return text.backPlanCredit;
  return text.backApp;
}

export default function CheckoutPage({ route }: { route: RouteMatch }) {
  const { language } = useAppText();
  const text = CHECKOUT_TEXT[language];
  const planText = PLAN_CREDIT_TEXT[language];
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const planId = params.get('plan')?.trim() ?? '';
  const selectedPlan = planText.plans.find((plan) => plan.id === planId) ?? null;
  const returnTo = checkoutReturnTo(params.get('return_to'));
  const returnPath = checkoutReturnPath(returnTo);
  const returnLabel = checkoutReturnLabel(returnTo, language);
  const [connection, setConnection] = useState<ConnectionState>({ status: 'checking' });
  const [submit, setSubmit] = useState<SubmitState>({ status: 'idle' });
  const [accepted, setAccepted] = useState(false);
  const requestRef = useRef<AbortController | null>(null);
  const checkoutRef = useRef<AbortController | null>(null);

  const loadAccountCatalog = useCallback(async () => {
    if (!planId || !selectedPlan) {
      setConnection({ status: 'error', message: 'PLAN_ID_REQUIRED' });
      return;
    }

    requestRef.current?.abort('superseded');
    const controller = new AbortController();
    requestRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort('timeout'), REQUEST_TIMEOUT_MS);
    setConnection({ status: 'checking' });

    try {
      const response = await fetch(ACCOUNT_CATALOG_ENDPOINT, {
        method: 'GET',
        credentials: 'include',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      if (response.status === 401 || response.status === 403) {
        setConnection({ status: 'login-required' });
        return;
      }
      if (!response.ok) throw new Error(`ACCOUNT_CATALOG_HTTP_${response.status}`);
      const payload: unknown = await response.json();
      const serverPlan = validateServerPlan(payload, planId);
      if (!serverPlan) throw new Error('PLAN_NOT_AVAILABLE_FOR_ACCOUNT');
      setConnection({ status: 'ready', currentPlan: serverPlan.currentPlan });
    } catch (error) {
      if (controller.signal.aborted) {
        if (controller.signal.reason === 'timeout') setConnection({ status: 'error', message: 'ACCOUNT_CATALOG_TIMEOUT' });
        return;
      }
      setConnection({ status: 'error', message: error instanceof Error ? error.message : 'ACCOUNT_CATALOG_UNKNOWN_ERROR' });
    } finally {
      window.clearTimeout(timeout);
      if (requestRef.current === controller) requestRef.current = null;
    }
  }, [planId, selectedPlan]);

  useEffect(() => {
    void loadAccountCatalog();
    return () => {
      requestRef.current?.abort('unmount');
      checkoutRef.current?.abort('unmount');
    };
  }, [loadAccountCatalog]);

  const createCheckoutIntent = async () => {
    if (!selectedPlan || connection.status !== 'ready' || !accepted || checkoutRef.current) return;
    const controller = new AbortController();
    checkoutRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort('timeout'), REQUEST_TIMEOUT_MS);
    const idempotencyKey = crypto.randomUUID();
    setSubmit({ status: 'submitting' });

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
        setConnection({ status: 'login-required' });
        setSubmit({ status: 'idle' });
        return;
      }
      if (!response.ok) throw new Error(`CHECKOUT_INTENT_HTTP_${response.status}`);
      const payload: unknown = await response.json();
      const destination = checkoutUrl(payload);
      if (!destination || !isAllowedCheckoutUrl(destination)) throw new Error('CHECKOUT_URL_REJECTED');
      await openExternalUrl(destination);
      setSubmit({ status: 'idle' });
    } catch (error) {
      if (controller.signal.aborted) {
        if (controller.signal.reason === 'timeout') setSubmit({ status: 'error', message: 'CHECKOUT_INTENT_TIMEOUT' });
        return;
      }
      setSubmit({ status: 'error', message: error instanceof Error ? error.message : 'CHECKOUT_INTENT_UNKNOWN_ERROR' });
    } finally {
      window.clearTimeout(timeout);
      if (checkoutRef.current === controller) checkoutRef.current = null;
    }
  };

  const loginReturn = encodeURIComponent(window.location.pathname + window.location.search);
  const canPay = Boolean(selectedPlan) && connection.status === 'ready' && accepted && submit.status !== 'submitting';

  return (
    <ResponsivePageShell route={route} fullWidth>
      <div className="checkout-page">
        {!selectedPlan ? (
          <div className="checkout-connection is-error" role="alert">
            <strong>{text.invalidPlan}</strong>
            <code>PLAN_ID_REQUIRED</code>
            <a className="platform-button" href={returnPath}>{returnLabel}</a>
          </div>
        ) : (
          <>
            <section className="checkout-summary" aria-label={text.title}>
              <div className="checkout-summary-top">
                <div>
                  <span>{text.selectedPlan}</span>
                  <h2>{selectedPlan.name}</h2>
                </div>
                <strong className="checkout-summary-price">{selectedPlan.price}</strong>
              </div>
              <dl className="checkout-facts">
                <div><dt>{text.monthlyCredit}</dt><dd>{selectedPlan.creditValue}</dd></div>
                <div><dt>{text.renewalCycle}</dt><dd>{text.renewalValue}</dd></div>
                <div><dt>{text.paymentProvider}</dt><dd>{text.paymentProviderValue}</dd></div>
              </dl>
            </section>

            <section className="checkout-terms">
              <h2>{text.contractTitle}</h2>
              <div className="checkout-term-row">
                <strong>{text.cancellationRefund}</strong>
                <p>{text.cancellationRefundValue}</p>
              </div>
              <div className="checkout-term-row">
                <strong>{text.paymentData}</strong>
                <p>{text.paymentDataValue}</p>
              </div>
              <nav className="checkout-legal-links" aria-label={text.contractTitle}>
                <a href="/legal/terms">{text.terms}</a>
                <a href="/legal/privacy">{text.privacy}</a>
                <a href="/legal/commercial">{text.commercial}</a>
              </nav>
            </section>

            <label className="checkout-agreement">
              <input
                type="checkbox"
                checked={accepted}
                onChange={(event) => setAccepted(event.target.checked)}
                disabled={submit.status === 'submitting'}
              />
              <span>{text.agreement}</span>
            </label>

            <div className="checkout-actions">
              <button
                className="platform-button is-primary"
                type="button"
                disabled={!canPay}
                onClick={() => void createCheckoutIntent()}
              >
                {submit.status === 'submitting' ? text.preparing : text.pay}
              </button>
              <a className="platform-button" href={returnPath}>{returnLabel}</a>
            </div>

            <div className={`checkout-connection is-${connection.status}`} role={connection.status === 'error' ? 'alert' : 'status'}>
              {connection.status === 'checking' && <span>{text.connectionChecking}</span>}
              {connection.status === 'ready' && <span>{text.connectionReady}</span>}
              {connection.status === 'login-required' && (
                <>
                  <span>{text.loginRequired}</span>
                  <div className="checkout-connection-actions">
                    <a href={`/login?return_to=${loginReturn}`}>{text.login}</a>
                    <a href={`/register?return_to=${loginReturn}`}>{text.register}</a>
                  </div>
                </>
              )}
              {connection.status === 'error' && (
                <>
                  <span>{text.connectionBlocked}</span>
                  <code>{connection.message}</code>
                  <button type="button" onClick={() => void loadAccountCatalog()}>{text.retry}</button>
                </>
              )}
              {submit.status === 'error' && <code>{submit.message}</code>}
            </div>
          </>
        )}
      </div>
    </ResponsivePageShell>
  );
}
