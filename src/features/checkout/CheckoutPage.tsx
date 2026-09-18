import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppText } from '../../app-text';
import { nativeCallback, openExternalUrl } from '../../platform/external-navigation';
import { resolvedApiBase } from '../../platform/api-client';
import type { RouteMatch } from '../../platform/route-registry';
import { ResponsivePageShell } from '../../platform/ResponsivePageShell';
import { CHECKOUT_TEXT } from './checkout-text';
import './checkout-page.css';

type JsonRecord = Record<string, unknown>;
type CheckoutReturnTo = 'pricing' | 'plan-credit' | 'app';
type BillingCycle = 'monthly' | 'annual';
type ForwardState =
  | { status: 'starting' }
  | { status: 'login-required' }
  | { status: 'error'; message: string };

const API_BASE = resolvedApiBase();
const CHECKOUT_INTENT_ENDPOINT = `${API_BASE}/api/billing/checkout-intents`;
const REQUEST_TIMEOUT_MS = 15_000;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function firstText(record: JsonRecord, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
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

function parseBillingCycle(value: string | null): BillingCycle {
  return value === 'annual' ? 'annual' : 'monthly';
}

export default function CheckoutPage({ route }: { route: RouteMatch }) {
  const { language } = useAppText();
  const text = CHECKOUT_TEXT[language];
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const planId = params.get('plan')?.trim() ?? '';
  const billingCycle = parseBillingCycle(params.get('billing'));
  const returnTo = checkoutReturnTo(params.get('return_to'));
  const [state, setState] = useState<ForwardState>({ status: 'starting' });
  const startedRef = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);
  const idempotencyKeyRef = useRef(crypto.randomUUID());

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    if (!planId || planId === 'free') {
      setState({ status: 'error', message: 'PLAN_CHECKOUT_NOT_REQUIRED' });
      return;
    }

    const controller = new AbortController();
    controllerRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort('timeout'), REQUEST_TIMEOUT_MS);

    const start = async () => {
      try {
        const response = await fetch(CHECKOUT_INTENT_ENDPOINT, {
          method: 'POST',
          credentials: 'include',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'Idempotency-Key': idempotencyKeyRef.current,
            'X-Request-ID': idempotencyKeyRef.current,
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

        if (!response.ok) {
          let message = `CHECKOUT_INTENT_HTTP_${response.status}`;
          try {
            const payload = await response.json();
            if (isRecord(payload)) {
              message = firstText(payload, ['error', 'code', 'message']) || message;
              const error = isRecord(payload.error) ? payload.error : null;
              if (error) message = firstText(error, ['code', 'message']) || message;
            }
          } catch {
            // Keep HTTP fallback.
          }
          setState({ status: 'error', message });
          return;
        }

        const payload: unknown = await response.json();
        const destination = checkoutUrl(payload);
        if (!destination || !isAllowedCheckoutUrl(destination)) {
          setState({ status: 'error', message: 'CHECKOUT_URL_REJECTED' });
          return;
        }

        await openExternalUrl(destination);
      } catch (error) {
        if (controller.signal.aborted) {
          if (controller.signal.reason === 'timeout') {
            setState({ status: 'error', message: 'CHECKOUT_INTENT_TIMEOUT' });
          }
          return;
        }
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : 'CHECKOUT_INTENT_UNKNOWN_ERROR',
        });
      } finally {
        window.clearTimeout(timeout);
        if (controllerRef.current === controller) controllerRef.current = null;
      }
    };

    void start();
    return () => {
      window.clearTimeout(timeout);
      controller.abort('unmount');
    };
  }, [billingCycle, planId, returnTo]);

  const loginReturn = encodeURIComponent(window.location.pathname + window.location.search);

  return (
    <ResponsivePageShell route={route} fullWidth>
      <div className="checkout-page checkout-forward-page">
        {state.status === 'starting' && (
          <div className="checkout-forward-status" role="status">{text.preparing}</div>
        )}
        {state.status === 'login-required' && (
          <div className="checkout-forward-status is-error" role="alert">
            <span>{text.loginRequired}</span>
            <div className="checkout-connection-actions">
              <a href={`/login?return_to=${loginReturn}`}>{text.login}</a>
              <a href={`/register?return_to=${loginReturn}`}>{text.register}</a>
            </div>
          </div>
        )}
        {state.status === 'error' && (
          <div className="checkout-forward-status is-error" role="alert">
            <span>{text.connectionBlocked}</span>
            <code>{state.message}</code>
          </div>
        )}
      </div>
    </ResponsivePageShell>
  );
}
