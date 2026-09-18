import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppText } from '../../app-text';
import { openExternalUrl } from '../../platform/external-navigation';
import { resolvedApiBase } from '../../platform/api-client';
import type { RouteMatch } from '../../platform/route-registry';
import { ResponsivePageShell } from '../../platform/ResponsivePageShell';
import { CHECKOUT_TEXT } from './checkout-text';
import './checkout-page.css';

type JsonRecord = Record<string, unknown>;
type PurchaseKind = 'credit' | 'storage';
type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; productId: string; currentCapacityGb?: number; planMaxCapacityGb?: number }
  | { status: 'error'; message: string };
type SubmitState = 'idle' | 'submitting';

const API_BASE = resolvedApiBase();
const ACCOUNT_CATALOG_ENDPOINT = `${API_BASE}/api/account/catalog`;
const STORAGE_CATALOG_ENDPOINT = `${API_BASE}/api/storage/catalog`;
const CREDIT_CHECKOUT_ENDPOINT = `${API_BASE}/api/billing/checkout-intents`;
const STORAGE_CHECKOUT_ENDPOINT = `${API_BASE}/api/storage/checkout-intents`;
const REQUEST_TIMEOUT_MS = 15_000;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function numberValue(record: JsonRecord, keys: string[]): number {
  for (const key of keys) {
    const value = record[key];
    const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN;
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function textValue(record: JsonRecord, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function checkoutUrl(payload: unknown): string {
  if (!isRecord(payload)) return '';
  const data = isRecord(payload.data) ? payload.data : {};
  return textValue(payload, ['checkout_url', 'url', 'redirect_url']) || textValue(data, ['checkout_url', 'url', 'redirect_url']);
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

function money(value: number): string {
  return `¥${Math.max(0, Math.trunc(value)).toLocaleString('ja-JP')}`;
}

function gb(value: number): string {
  return `${Math.max(0, value)}GB`;
}

export default function OneTimeCheckoutPage({ route, kind }: { route: RouteMatch; kind: PurchaseKind }) {
  const { language } = useAppText();
  const text = CHECKOUT_TEXT[language];
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const amount = Number(params.get('amount') ?? 0);
  const credits = Number(params.get('credits') ?? 0);
  const capacityGb = Number(params.get('capacity') ?? 0);
  const storageProductId = params.get('product')?.trim() ?? '';
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [accepted, setAccepted] = useState(false);
  const [submit, setSubmit] = useState<SubmitState>('idle');
  const [submitError, setSubmitError] = useState('');
  const requestRef = useRef<AbortController | null>(null);
  const checkoutRef = useRef<AbortController | null>(null);

  const copy = language === 'ja'
    ? {
        credit: '追加クレジット', storage: '追加ストレージ', due: '今回のお支払い', granted: '付与Credit',
        paymentType: '支払い方式', oneTime: '1回払い', capacity: '追加容量', current: '現在容量', after: '購入後容量',
        limit: 'プラン上限', agreementLead: '購入内容と', agreementTail: 'に同意します。', invalid: '購入内容を確認できません。',
      }
    : {
        credit: 'Additional Credit', storage: 'Additional Storage', due: 'Due today', granted: 'Granted credit',
        paymentType: 'Payment type', oneTime: 'One-time payment', capacity: 'Added capacity', current: 'Current capacity', after: 'Capacity after purchase',
        limit: 'Plan limit', agreementLead: 'I agree to the purchase details and the', agreementTail: '.', invalid: 'The purchase details could not be confirmed.',
      };

  const loadPurchase = useCallback(async () => {
    requestRef.current?.abort('superseded');
    const controller = new AbortController();
    requestRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort('timeout'), REQUEST_TIMEOUT_MS);
    setLoad({ status: 'loading' });
    try {
      if (kind === 'credit') {
        if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(credits) || credits <= 0) {
          throw new Error('CREDIT_SELECTION_INVALID');
        }
        const response = await fetch(ACCOUNT_CATALOG_ENDPOINT, { credentials: 'include', headers: { Accept: 'application/json' }, signal: controller.signal });
        if (!response.ok) throw new Error(`ACCOUNT_CATALOG_HTTP_${response.status}`);
        const payload: unknown = await response.json();
        if (!isRecord(payload)) throw new Error('ACCOUNT_CATALOG_INVALID');
        const products = Array.isArray(payload.creditProducts)
          ? payload.creditProducts
          : Array.isArray(payload.credit_products) ? payload.credit_products : [];
        const product = products.map((item) => isRecord(item) ? item : {}).find((item) =>
          numberValue(item, ['amount', 'price_jpy']) === amount && numberValue(item, ['credits', 'credit_amount']) === credits && item.active !== false,
        );
        const productId = product ? textValue(product, ['product_id', 'id']) : '';
        if (!productId) throw new Error('CREDIT_PRODUCT_NOT_AVAILABLE');
        setLoad({ status: 'ready', productId });
        return;
      }

      if (!storageProductId || !Number.isFinite(capacityGb) || capacityGb <= 0 || !Number.isFinite(amount) || amount <= 0) {
        throw new Error('STORAGE_SELECTION_INVALID');
      }
      const response = await fetch(STORAGE_CATALOG_ENDPOINT, { credentials: 'include', headers: { Accept: 'application/json' }, signal: controller.signal });
      if (!response.ok) throw new Error(`STORAGE_CATALOG_HTTP_${response.status}`);
      const payload: unknown = await response.json();
      if (!isRecord(payload)) throw new Error('STORAGE_CATALOG_INVALID');
      const packs = Array.isArray(payload.packs) ? payload.packs : [];
      const pack = packs.map((item) => isRecord(item) ? item : {}).find((item) => textValue(item, ['product_id', 'productId']) === storageProductId);
      if (!pack) throw new Error('STORAGE_PRODUCT_NOT_AVAILABLE');
      setLoad({
        status: 'ready',
        productId: storageProductId,
        currentCapacityGb: numberValue(payload, ['current_capacity_gb', 'currentCapacityGb']),
        planMaxCapacityGb: numberValue(payload, ['plan_max_capacity_gb', 'planMaxCapacityGb']),
      });
    } catch (error) {
      if (controller.signal.aborted) {
        if (controller.signal.reason === 'timeout') setLoad({ status: 'error', message: 'CHECKOUT_SELECTION_TIMEOUT' });
        return;
      }
      setLoad({ status: 'error', message: error instanceof Error ? error.message : 'CHECKOUT_SELECTION_FAILED' });
    } finally {
      window.clearTimeout(timeout);
      if (requestRef.current === controller) requestRef.current = null;
    }
  }, [amount, capacityGb, credits, kind, storageProductId]);

  useEffect(() => {
    void loadPurchase();
    return () => {
      requestRef.current?.abort('unmount');
      checkoutRef.current?.abort('unmount');
    };
  }, [loadPurchase]);

  const submitCheckout = async () => {
    if (load.status !== 'ready' || !accepted || checkoutRef.current) return;
    const controller = new AbortController();
    checkoutRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort('timeout'), REQUEST_TIMEOUT_MS);
    const idempotencyKey = crypto.randomUUID();
    setSubmit('submitting');
    setSubmitError('');
    try {
      const endpoint = kind === 'credit' ? CREDIT_CHECKOUT_ENDPOINT : STORAGE_CHECKOUT_ENDPOINT;
      const body = kind === 'credit'
        ? { product_id: load.productId, return_to: 'credit' }
        : { product_id: load.productId };
      const response = await fetch(endpoint, {
        method: 'POST', credentials: 'include', signal: controller.signal,
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey, 'X-Request-ID': idempotencyKey },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(`CHECKOUT_INTENT_HTTP_${response.status}`);
      const payload: unknown = await response.json();
      const destination = checkoutUrl(payload);
      if (!destination || !allowedCheckoutUrl(destination)) throw new Error('CHECKOUT_URL_REJECTED');
      await openExternalUrl(destination);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'CHECKOUT_INTENT_FAILED');
    } finally {
      window.clearTimeout(timeout);
      if (checkoutRef.current === controller) checkoutRef.current = null;
      setSubmit('idle');
    }
  };

  const title = kind === 'credit' ? copy.credit : copy.storage;
  const mainValue = kind === 'credit' ? `${credits.toLocaleString('ja-JP')} ©` : `+${gb(capacityGb)}`;
  const currentCapacity = load.status === 'ready' ? load.currentCapacityGb ?? 0 : 0;
  const planLimit = load.status === 'ready' ? load.planMaxCapacityGb ?? 0 : 0;
  const afterCapacity = currentCapacity + capacityGb;
  const canPay = load.status === 'ready' && accepted && submit !== 'submitting';

  return (
    <ResponsivePageShell route={route} fullWidth>
      <div className="checkout-page">
        <a className="checkout-back" href="/app/plan-credit"><span aria-hidden="true">←</span><span>{text.backPlanCredit}</span></a>
        <header className="checkout-heading"><h1>{text.title}</h1></header>

        <section className="checkout-order" aria-label={text.orderSummary}>
          <div className="checkout-plan-row checkout-plan-row-single">
            <div><span className="checkout-eyebrow">{title}</span><h2>{mainValue}</h2></div>
          </div>
          <div className="checkout-price-block"><strong>{money(amount)}</strong></div>
          <dl className="checkout-order-rows">
            <div><dt>{copy.due}</dt><dd>{money(amount)}</dd></div>
            {kind === 'credit' ? (
              <>
                <div><dt>{copy.granted}</dt><dd>{credits.toLocaleString('ja-JP')} ©</dd></div>
                <div><dt>{copy.paymentType}</dt><dd>{copy.oneTime}</dd></div>
              </>
            ) : (
              <>
                <div><dt>{copy.capacity}</dt><dd>{gb(capacityGb)}</dd></div>
                <div><dt>{copy.current}</dt><dd>{gb(currentCapacity)}</dd></div>
                <div><dt>{copy.after}</dt><dd>{gb(afterCapacity)}</dd></div>
                <div><dt>{copy.limit}</dt><dd>{gb(planLimit)}</dd></div>
              </>
            )}
          </dl>
          <p className="checkout-order-note">{copy.oneTime}</p>
        </section>

        <div className="checkout-agreement">
          <input id="checkout-agreement" type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} disabled={submit === 'submitting'} />
          <div>
            <label htmlFor="checkout-agreement">{copy.agreementLead}</label>
            <span className="checkout-agreement-links">
              <a href="/legal/terms">{text.terms}</a><span>・</span><a href="/legal/privacy">{text.privacy}</a><span>・</span><a href="/legal/commercial">{text.commercial}</a>
            </span>
            <span>{copy.agreementTail}</span>
          </div>
        </div>

        <button className="platform-button is-primary checkout-pay-button" type="button" disabled={!canPay} onClick={() => void submitCheckout()}>
          {submit === 'submitting' ? text.preparing : text.pay}
        </button>
        <p className="checkout-square-note">{text.squareNote}</p>

        {load.status === 'loading' && <div className="checkout-connection" role="status"><span>{text.connectionChecking}</span></div>}
        {load.status === 'error' && (
          <div className="checkout-connection is-error" role="alert"><span>{copy.invalid}</span><code>{load.message}</code><button type="button" onClick={() => void loadPurchase()}>{text.retry}</button></div>
        )}
        {submitError && <div className="checkout-connection is-error" role="alert"><span>{text.connectionBlocked}</span><code>{submitError}</code></div>}
      </div>
    </ResponsivePageShell>
  );
}
