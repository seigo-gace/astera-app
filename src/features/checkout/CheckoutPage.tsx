import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppText } from "../../app-text";
import { nativeCallback, openExternalUrl } from "../../platform/external-navigation";
import { resolvedApiBase } from "../../platform/api-client";
import type { RouteMatch } from "../../platform/route-registry";
import { ResponsivePageShell } from "../../platform/ResponsivePageShell";
import { PLAN_CREDIT_TEXT } from "../navigation/plan-credit-text";
import { isAllowedCheckoutUrl, readCheckoutResponseError } from "./checkout-security";
import { CHECKOUT_TEXT } from "./checkout-text";
import "./checkout-page.css";

type JsonRecord = Record<string, unknown>;
type Language = keyof typeof CHECKOUT_TEXT;
type CheckoutReturnTo = "pricing" | "plan-credit" | "app";
type BillingCycle = "monthly" | "annual";
type CheckoutKind = "plan" | "credit" | "storage";
type StorageContext = {
  currentCapacityGb: number;
  planMaxCapacityGb: number;
  capacityGb: number;
};
type ConnectionState =
  | { status: "checking" }
  | { status: "ready"; currentPlan?: string; productId?: string; storage?: StorageContext; planAmount?: number; currency?: string }
  | { status: "login-required" }
  | { status: "reauth-required" }
  | { status: "error"; message: string };
type SubmitState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "error"; message: string };
type SquareCard = {
  attach(selector: string): Promise<void>;
  tokenize(details: Record<string, unknown>): Promise<{ status: string; token?: string; errors?: Array<{ code?: string; message?: string }> }>;
  destroy?: () => Promise<void>;
};
type SquareGlobal = {
  payments(applicationId: string, locationId: string): Promise<{ card(): Promise<SquareCard> }>;
};
type SquareState =
  | { status: "idle" | "loading" }
  | { status: "ready"; email: string }
  | { status: "error"; message: string };

declare global {
  interface Window { Square?: SquareGlobal }
}

const API_BASE = resolvedApiBase();
const ACCOUNT_CATALOG_ENDPOINT = `${API_BASE}/api/account/catalog`;
const STORAGE_CATALOG_ENDPOINT = `${API_BASE}/api/storage/catalog`;
const CHECKOUT_INTENT_ENDPOINT = `${API_BASE}/api/billing/checkout-intents`;
const STORAGE_CHECKOUT_INTENT_ENDPOINT = `${API_BASE}/api/storage/checkout-intents`;
const PLAN_SUBSCRIPTION_ENDPOINT = `${API_BASE}/api/billing/plan-subscriptions`;
const BILLING_PUBLIC_CONFIG_ENDPOINT = `${API_BASE}/api/billing/public-config`;
const ACCOUNT_ENDPOINT = `${API_BASE}/api/account`;
const REQUEST_TIMEOUT_MS = 15_000;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function firstText(record: JsonRecord, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function firstNumber(record: JsonRecord, keys: string[], fallback = 0): number {
  for (const key of keys) {
    const value = record[key];
    const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function queryNumber(value: string | null): number {
  if (!value) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function planArray(payload: unknown): unknown[] {
  if (!isRecord(payload)) return [];
  const data = isRecord(payload.data) ? payload.data : null;
  const account = isRecord(payload.account) ? payload.account : null;
  const candidates = [payload.plans, payload.available_plans, data?.plans, data?.available_plans, account?.plans];
  return (candidates.find(Array.isArray) as unknown[] | undefined) ?? [];
}

function creditProductArray(payload: unknown): unknown[] {
  if (!isRecord(payload)) return [];
  const data = isRecord(payload.data) ? payload.data : null;
  const candidates = [payload.creditProducts, payload.credit_products, data?.creditProducts, data?.credit_products];
  return (candidates.find(Array.isArray) as unknown[] | undefined) ?? [];
}

function storagePackArray(payload: unknown): unknown[] {
  if (!isRecord(payload)) return [];
  const data = isRecord(payload.data) ? payload.data : null;
  const candidates = [payload.packs, payload.storage_packs, data?.packs, data?.storage_packs];
  return (candidates.find(Array.isArray) as unknown[] | undefined) ?? [];
}

function planSupportsCycle(plan: JsonRecord, cycle: BillingCycle): boolean {
  if (!Array.isArray(plan.billing_variants)) return cycle === "monthly";
  return plan.billing_variants.some((variant) => {
    if (!isRecord(variant)) return false;
    return firstText(variant, ["billing_cycle"]) === cycle && variant.active !== false;
  });
}

function validateServerPlan(payload: unknown, planId: string, cycle: BillingCycle): { currentPlan: string; amount: number; currency: string } | null {
  if (!isRecord(payload)) return null;
  const data = isRecord(payload.data) ? payload.data : {};
  const account = isRecord(payload.account) ? payload.account : {};
  const selected = planArray(payload).find(
    (item) => isRecord(item) && firstText(item, ["plan_id", "id", "key", "slug"]) === planId,
  );
  if (!isRecord(selected) || !planSupportsCycle(selected, cycle)) return null;
  const variant = Array.isArray(selected.billing_variants)
    ? selected.billing_variants.find((item) => isRecord(item) && firstText(item, ["billing_cycle"]) === cycle && item.active !== false)
    : selected;
  if (!isRecord(variant)) return null;
  return {
    currentPlan:
      firstText(account, ["current_plan_name", "current_plan_id"]) ||
      firstText(data, ["current_plan_name", "current_plan_id"]) ||
      firstText(payload, ["current_plan_name", "current_plan_id"]) ||
      "未契約",
    amount: firstNumber(variant, ["recurring_amount", "amount"]),
    currency: firstText(selected, ["currency"]) || "JPY",
  };
}

function checkoutUrl(payload: unknown): string {
  if (!isRecord(payload)) return "";
  const data = isRecord(payload.data) ? payload.data : {};
  return firstText(payload, ["checkout_url", "url", "redirect_url"]) || firstText(data, ["checkout_url", "url", "redirect_url"]);
}

function checkoutReturnTo(value: string | null): CheckoutReturnTo {
  if (value === "pricing" || value === "plan-credit") return value;
  return "app";
}

function checkoutReturnPath(value: CheckoutReturnTo): string {
  if (value === "pricing") return "/pricing";
  if (value === "plan-credit") return "/app/plan-credit";
  return "/app";
}

function checkoutReturnLabel(value: CheckoutReturnTo, language: Language): string {
  const text = CHECKOUT_TEXT[language];
  if (value === "pricing") return text.backPricing;
  if (value === "plan-credit") return text.backPlanCredit;
  return text.backApp;
}

function parseBillingCycle(value: string | null): BillingCycle {
  return value === "annual" ? "annual" : "monthly";
}

function parseCheckoutKind(value: string | null): CheckoutKind {
  if (value === "credit" || value === "storage") return value;
  return "plan";
}

function yen(value: number): string {
  return `¥${Math.max(0, value).toLocaleString("ja-JP")}`;
}

function gb(value: number): string {
  return `${Math.max(0, value).toLocaleString("ja-JP")} GB`;
}

export default function CheckoutPage({ route }: { route: RouteMatch }) {
  const { language } = useAppText();
  const text = CHECKOUT_TEXT[language];
  const planText = PLAN_CREDIT_TEXT[language];
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const kind = parseCheckoutKind(params.get("kind"));
  const planId = params.get("plan")?.trim() ?? "";
  const creditAmount = queryNumber(params.get("amount"));
  const creditValue = queryNumber(params.get("credits"));
  const storageProductId = params.get("product")?.trim() ?? "";
  const storageCapacity = queryNumber(params.get("capacity"));
  const storageAmount = queryNumber(params.get("amount"));
  const returnTo = checkoutReturnTo(params.get("return_to"));
  const returnPath = checkoutReturnPath(returnTo);
  const returnLabel = checkoutReturnLabel(returnTo, language);
  const selectedPlan = planText.plans.find((plan) => plan.id === planId) ?? null;
  const [cycle, setCycle] = useState<BillingCycle>(() => parseBillingCycle(params.get("billing")));
  const [connection, setConnection] = useState<ConnectionState>({ status: "checking" });
  const [submit, setSubmit] = useState<SubmitState>({ status: "idle" });
  const [squareState, setSquareState] = useState<SquareState>({ status: "idle" });
  const [accepted, setAccepted] = useState(false);
  const requestRef = useRef<AbortController | null>(null);
  const checkoutRef = useRef<AbortController | null>(null);
  const squareCardRef = useRef<SquareCard | null>(null);

  const selectedPrice = selectedPlan
    ? cycle === "annual"
      ? selectedPlan.annualPrice
      : selectedPlan.monthlyPrice
    : "";
  const annualMonthlyEquivalent = selectedPlan && "annualMonthlyEquivalent" in selectedPlan
    ? selectedPlan.annualMonthlyEquivalent
    : "";

  const switchCycle = useCallback((next: BillingCycle) => {
    if (next === cycle || submit.status === "submitting" || kind !== "plan") return;
    setCycle(next);
    setAccepted(false);
    setSubmit({ status: "idle" });
    setConnection({ status: "checking" });
    const url = new URL(window.location.href);
    url.searchParams.set("billing", next);
    window.history.replaceState(window.history.state, "", url.toString());
  }, [cycle, kind, submit.status]);

  const loadCheckoutContext = useCallback(async () => {
    if (kind === "plan" && (!planId || !selectedPlan)) {
      setConnection({ status: "error", message: "PLAN_ID_REQUIRED" });
      return;
    }
    if (kind === "credit" && (!creditAmount || !creditValue)) {
      setConnection({ status: "error", message: "CREDIT_PRODUCT_REQUIRED" });
      return;
    }
    if (kind === "storage" && (!storageProductId || !storageCapacity || !storageAmount)) {
      setConnection({ status: "error", message: "STORAGE_PRODUCT_REQUIRED" });
      return;
    }

    requestRef.current?.abort("superseded");
    const controller = new AbortController();
    requestRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort("timeout"), REQUEST_TIMEOUT_MS);
    setConnection({ status: "checking" });

    try {
      const endpoint = kind === "storage" ? STORAGE_CATALOG_ENDPOINT : ACCOUNT_CATALOG_ENDPOINT;
      const response = await fetch(endpoint, {
        method: "GET",
        credentials: "include",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) {
        const failure = await readCheckoutResponseError(response, `${kind.toUpperCase()}_CATALOG_HTTP_${response.status}`);
        if (failure.authentication) {
          setConnection({ status: failure.authentication });
          return;
        }
        throw new Error(failure.code);
      }
      const payload: unknown = await response.json();

      if (kind === "plan") {
        const serverPlan = validateServerPlan(payload, planId, cycle);
        if (!serverPlan) throw new Error("PLAN_BILLING_VARIANT_NOT_AVAILABLE");
        setConnection({ status: "ready", currentPlan: serverPlan.currentPlan, planAmount: serverPlan.amount, currency: serverPlan.currency });
        return;
      }

      if (kind === "credit") {
        const selected = creditProductArray(payload).find((item) => {
          if (!isRecord(item) || item.active === false) return false;
          return firstNumber(item, ["amount", "price_jpy", "priceJpy"]) === creditAmount
            && firstNumber(item, ["credits", "credit_value", "creditValue"]) === creditValue;
        });
        if (!isRecord(selected)) throw new Error("CREDIT_PRODUCT_NOT_AVAILABLE");
        const productId = firstText(selected, ["product_id", "productId", "id"]);
        if (!productId) throw new Error("CREDIT_PRODUCT_ID_MISSING");
        setConnection({ status: "ready", productId });
        return;
      }

      if (!isRecord(payload)) throw new Error("STORAGE_CATALOG_INVALID");
      const selected = storagePackArray(payload).find((item) => {
        if (!isRecord(item)) return false;
        const productId = firstText(item, ["product_id", "productId", "id"]);
        return productId === storageProductId
          || (firstNumber(item, ["capacity_gb", "capacityGb"]) === storageCapacity
            && firstNumber(item, ["price_jpy", "priceJpy", "amount"]) === storageAmount);
      });
      if (!isRecord(selected)) throw new Error("STORAGE_PRODUCT_NOT_AVAILABLE");
      const productId = firstText(selected, ["product_id", "productId", "id"]);
      if (!productId) throw new Error("STORAGE_PRODUCT_ID_MISSING");
      const currentCapacityGb = firstNumber(payload, ["current_capacity_gb", "currentCapacityGb"]);
      const planMaxCapacityGb = firstNumber(payload, ["plan_max_capacity_gb", "planMaxCapacityGb"]);
      const capacityGb = firstNumber(selected, ["capacity_gb", "capacityGb"], storageCapacity);
      setConnection({
        status: "ready",
        productId,
        storage: { currentCapacityGb, planMaxCapacityGb, capacityGb },
      });
    } catch (error) {
      if (controller.signal.aborted) {
        if (controller.signal.reason === "timeout") setConnection({ status: "error", message: "CHECKOUT_CONTEXT_TIMEOUT" });
        return;
      }
      setConnection({
        status: "error",
        message: error instanceof Error ? error.message : "CHECKOUT_CONTEXT_UNKNOWN_ERROR",
      });
    } finally {
      window.clearTimeout(timeout);
      if (requestRef.current === controller) requestRef.current = null;
    }
  }, [creditAmount, creditValue, cycle, kind, planId, selectedPlan, storageAmount, storageCapacity, storageProductId]);

  useEffect(() => {
    void loadCheckoutContext();
    return () => {
      requestRef.current?.abort("unmount");
      checkoutRef.current?.abort("unmount");
    };
  }, [loadCheckoutContext]);

  useEffect(() => {
    if (kind !== "plan" || connection.status !== "ready") return;
    let cancelled = false;
    setSquareState({ status: "loading" });
    void (async () => {
      try {
        const [configResponse, accountResponse] = await Promise.all([
          fetch(BILLING_PUBLIC_CONFIG_ENDPOINT, { credentials: "include", headers: { Accept: "application/json" } }),
          fetch(ACCOUNT_ENDPOINT, { credentials: "include", headers: { Accept: "application/json" } }),
        ]);
        if (!configResponse.ok) throw new Error(`SQUARE_CONFIG_HTTP_${configResponse.status}`);
        if (!accountResponse.ok) throw new Error(`ACCOUNT_HTTP_${accountResponse.status}`);
        const config = await configResponse.json() as unknown;
        const accountPayload = await accountResponse.json() as unknown;
        if (!isRecord(config) || !isRecord(accountPayload) || !isRecord(accountPayload.account)) throw new Error("SQUARE_CONFIG_INVALID");
        const applicationId = firstText(config, ["application_id"]);
        const locationId = firstText(config, ["location_id"]);
        const scriptUrl = firstText(config, ["script_url"]);
        const email = firstText(accountPayload.account, ["email"]);
        if (!applicationId || !locationId || !scriptUrl || !email || accountPayload.account.email_verified !== true) {
          throw new Error("VERIFIED_EMAIL_REQUIRED");
        }
        if (!window.Square) {
          await new Promise<void>((resolve, reject) => {
            const existing = document.querySelector<HTMLScriptElement>(`script[src="${scriptUrl}"]`);
            const script = existing ?? document.createElement("script");
            const loaded = () => resolve();
            const failed = () => reject(new Error("SQUARE_SDK_LOAD_FAILED"));
            script.addEventListener("load", loaded, { once: true });
            script.addEventListener("error", failed, { once: true });
            if (!existing) {
              script.src = scriptUrl;
              script.async = true;
              document.head.appendChild(script);
            } else if (window.Square) resolve();
          });
        }
        if (cancelled || !window.Square) return;
        const payments = await window.Square.payments(applicationId, locationId);
        const card = await payments.card();
        await card.attach("#square-card-container");
        if (cancelled) {
          await card.destroy?.();
          return;
        }
        squareCardRef.current = card;
        setSquareState({ status: "ready", email });
      } catch (error) {
        if (!cancelled) setSquareState({ status: "error", message: error instanceof Error ? error.message : "SQUARE_CARD_INITIALIZATION_FAILED" });
      }
    })();
    return () => {
      cancelled = true;
      const card = squareCardRef.current;
      squareCardRef.current = null;
      if (card?.destroy) void card.destroy();
    };
  }, [connection.status, cycle, kind, planId]);

  const createCheckoutIntent = async () => {
    if (connection.status !== "ready" || !accepted || checkoutRef.current) return;
    if (kind === "plan" && !selectedPlan) return;
    if ((kind === "credit" || kind === "storage") && !connection.productId) return;

    const controller = new AbortController();
    checkoutRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort("timeout"), REQUEST_TIMEOUT_MS);
    const idempotencyKey = crypto.randomUUID();
    setSubmit({ status: "submitting" });

    try {
      const endpoint = kind === "storage" ? STORAGE_CHECKOUT_INTENT_ENDPOINT : CHECKOUT_INTENT_ENDPOINT;
      const body = kind === "plan"
        ? {
            plan_id: planId,
            billing_cycle: cycle,
            return_to: returnTo,
            native_callback: nativeCallback("/account/billing/status"),
          }
        : kind === "credit"
          ? {
              product_id: connection.productId,
              return_to: returnTo,
              native_callback: nativeCallback("/account/billing/status"),
            }
          : { product_id: connection.productId };

      const response = await fetch(endpoint, {
        method: "POST",
        credentials: "include",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
          "X-Request-ID": idempotencyKey,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        const failure = await readCheckoutResponseError(response, `CHECKOUT_INTENT_HTTP_${response.status}`);
        if (failure.authentication) {
          setConnection({ status: failure.authentication });
          setSubmit({ status: "idle" });
          return;
        }
        throw new Error(failure.code);
      }
      const payload: unknown = await response.json();
      if (kind === "plan") {
        const intentId = isRecord(payload) ? firstText(payload, ["intent_id"]) : "";
        const card = squareCardRef.current;
        if (!intentId || !card || squareState.status !== "ready") throw new Error("SQUARE_CARD_NOT_READY");
        const tokenized = await card.tokenize({
          intent: "STORE",
          customerInitiated: true,
          sellerKeyedIn: false,
          billingContact: { email: squareState.email },
          amount: String(connection.planAmount ?? 0),
          currencyCode: connection.currency ?? "JPY",
        });
        if (tokenized.status !== "OK" || !tokenized.token) {
          throw new Error(tokenized.errors?.[0]?.code || tokenized.errors?.[0]?.message || "SQUARE_TOKENIZATION_FAILED");
        }
        const subscribeResponse = await fetch(PLAN_SUBSCRIPTION_ENDPOINT, {
          method: "POST",
          credentials: "include",
          headers: { Accept: "application/json", "Content-Type": "application/json", "X-Request-ID": idempotencyKey },
          body: JSON.stringify({ billing_intent_id: intentId, source_id: tokenized.token }),
          signal: controller.signal,
        });
        if (!subscribeResponse.ok) {
          const failure = await readCheckoutResponseError(subscribeResponse, `PLAN_SUBSCRIPTION_HTTP_${subscribeResponse.status}`);
          throw new Error(failure.code);
        }
        window.location.assign(`/account/billing/status?intent=${encodeURIComponent(intentId)}`);
        return;
      }
      const destination = checkoutUrl(payload);
      if (!destination || !isAllowedCheckoutUrl(destination)) throw new Error("CHECKOUT_URL_REJECTED");
      await openExternalUrl(destination);
      setSubmit({ status: "idle" });
    } catch (error) {
      if (controller.signal.aborted) {
        if (controller.signal.reason === "timeout") setSubmit({ status: "error", message: "CHECKOUT_INTENT_TIMEOUT" });
        return;
      }
      setSubmit({ status: "error", message: error instanceof Error ? error.message : "CHECKOUT_INTENT_UNKNOWN_ERROR" });
    } finally {
      window.clearTimeout(timeout);
      if (checkoutRef.current === controller) checkoutRef.current = null;
    }
  };

  const loginReturn = encodeURIComponent(window.location.pathname + window.location.search);
  const hasSelection = kind === "plan"
    ? Boolean(selectedPlan)
    : kind === "credit"
      ? Boolean(creditAmount && creditValue)
      : Boolean(storageProductId && storageCapacity && storageAmount);
  const canPay = hasSelection && connection.status === "ready" && accepted && submit.status !== "submitting"
    && (kind !== "plan" || squareState.status === "ready");
  const cycleLabel = cycle === "annual" ? text.annualValue : text.monthlyValue;
  const renewalLabel = cycle === "annual" ? text.annualRenewal : text.monthlyRenewal;
  const showConnection = connection.status !== "ready" || submit.status === "error";
  const invalidLabel = kind === "credit" ? text.invalidCredit : kind === "storage" ? text.invalidStorage : text.invalidPlan;
  const invalidCode = kind === "credit" ? "CREDIT_PRODUCT_REQUIRED" : kind === "storage" ? "STORAGE_PRODUCT_REQUIRED" : "PLAN_ID_REQUIRED";
  const oneTimeAgreement = kind !== "plan";
  const storageContext = connection.status === "ready" ? connection.storage : undefined;

  return (
    <ResponsivePageShell route={route} fullWidth>
      <div className="checkout-page">
        {!hasSelection ? (
          <div className="checkout-connection is-error" role="alert">
            <strong>{invalidLabel}</strong>
            <code>{invalidCode}</code>
            <a className="platform-button" href={returnPath}>{returnLabel}</a>
          </div>
        ) : (
          <>
            <a className="checkout-back" href={returnPath}>
              <span aria-hidden="true">←</span>
              <span>{returnLabel}</span>
            </a>

            <header className="checkout-heading"><h1>{text.title}</h1></header>

            {kind === "plan" && selectedPlan && (
              <section className="checkout-order" aria-label={text.orderSummary}>
                <div className="checkout-plan-row">
                  <div>
                    <span className="checkout-eyebrow">{text.selectedPlan}</span>
                    <h2>{selectedPlan.name}</h2>
                  </div>
                  <div className="checkout-cycle-toggle" role="group" aria-label={`${planText.billingMonthly} / ${planText.billingAnnual}`}>
                    <button type="button" className={cycle === "monthly" ? "is-active" : ""} aria-pressed={cycle === "monthly"} disabled={submit.status === "submitting"} onClick={() => switchCycle("monthly")}>{planText.billingMonthly}</button>
                    <button type="button" className={cycle === "annual" ? "is-active" : ""} aria-pressed={cycle === "annual"} disabled={submit.status === "submitting"} onClick={() => switchCycle("annual")}>{planText.billingAnnual}</button>
                  </div>
                </div>

                <div className="checkout-price-block">
                  <strong>{selectedPrice}</strong>
                  {cycle === "annual" && planId !== "free" && (
                    <div className="checkout-annual-meta">
                      <span className="checkout-saving-badge">{planText.annualSaving}</span>
                      {annualMonthlyEquivalent && <span>{planText.monthlyEquivalent}: {annualMonthlyEquivalent}</span>}
                    </div>
                  )}
                </div>

                <dl className="checkout-order-rows">
                  <div><dt>{text.dueToday}</dt><dd>{selectedPrice}</dd></div>
                  <div><dt>{text.monthlyCredit}</dt><dd>{selectedPlan.creditValue}</dd></div>
                  <div><dt>{text.renewalCycle}</dt><dd>{renewalLabel}</dd></div>
                  <div><dt>{text.nextCharge}</dt><dd>{selectedPrice}</dd></div>
                </dl>
                <p className="checkout-order-note">{text.creditGrantValue} · {cycleLabel}</p>
              </section>
            )}

            {kind === "credit" && (
              <section className="checkout-order" aria-label={text.orderSummary}>
                <div className="checkout-plan-row">
                  <div>
                    <span className="checkout-eyebrow">{text.selectedCredit}</span>
                    <h2>{creditValue.toLocaleString("ja-JP")} ©</h2>
                  </div>
                </div>
                <div className="checkout-price-block"><strong>{yen(creditAmount)}</strong></div>
                <dl className="checkout-order-rows">
                  <div><dt>{text.dueToday}</dt><dd>{yen(creditAmount)}</dd></div>
                  <div><dt>{text.grantedCredit}</dt><dd>{creditValue.toLocaleString("ja-JP")} ©</dd></div>
                  <div><dt>{text.paymentType}</dt><dd>{text.oneTimePayment}</dd></div>
                </dl>
              </section>
            )}

            {kind === "storage" && (
              <section className="checkout-order" aria-label={text.orderSummary}>
                <div className="checkout-plan-row">
                  <div>
                    <span className="checkout-eyebrow">{text.selectedStorage}</span>
                    <h2>＋{storageCapacity.toLocaleString("ja-JP")}GB追加</h2>
                  </div>
                </div>
                <div className="checkout-price-block"><strong>{yen(storageAmount)}</strong></div>
                <dl className="checkout-order-rows">
                  <div><dt>{text.dueToday}</dt><dd>{yen(storageAmount)}</dd></div>
                  <div><dt>{text.addedCapacity}</dt><dd>{gb(storageCapacity)}</dd></div>
                  <div><dt>{text.currentCapacity}</dt><dd>{storageContext ? gb(storageContext.currentCapacityGb) : "—"}</dd></div>
                  <div><dt>{text.afterCapacity}</dt><dd>{storageContext ? gb(storageContext.currentCapacityGb + storageContext.capacityGb) : "—"}</dd></div>
                  <div><dt>{text.planLimit}</dt><dd>{storageContext ? gb(storageContext.planMaxCapacityGb) : "—"}</dd></div>
                </dl>
              </section>
            )}

            {kind === "plan" && (
              <section className="checkout-card" aria-label="Square card payment">
                <div id="square-card-container" />
                {squareState.status === "loading" && <span>{text.connectionChecking}</span>}
                {squareState.status === "error" && <code role="alert">{squareState.message}</code>}
              </section>
            )}

            <div className="checkout-agreement">
              <input id="checkout-agreement" type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} disabled={submit.status === "submitting"} />
              <div>
                <label htmlFor="checkout-agreement">{oneTimeAgreement ? text.oneTimeAgreementLead : text.agreementLead}</label>
                <span className="checkout-agreement-links">
                  <a href="/legal/terms">{text.terms}</a><span>・</span><a href="/legal/privacy">{text.privacy}</a><span>・</span><a href="/legal/commercial">{text.commercial}</a>
                </span>
                <span>{text.agreementTail}</span>
              </div>
            </div>

            <button className="platform-button is-primary checkout-pay-button" type="button" disabled={!canPay} onClick={() => void createCheckoutIntent()}>
              {submit.status === "submitting" ? text.preparing : text.pay}
            </button>
            <p className="checkout-square-note">{text.squareNote}</p>

            {showConnection && (
              <div className={`checkout-connection is-${connection.status}`} role={connection.status === "error" ? "alert" : "status"}>
                {connection.status === "checking" && <span>{text.connectionChecking}</span>}
                {connection.status === "login-required" && (
                  <>
                    <span>{text.loginRequired}</span>
                    <div className="checkout-connection-actions"><a href={`/login?return_to=${loginReturn}`}>{text.login}</a><a href={`/register?return_to=${loginReturn}`}>{text.register}</a></div>
                  </>
                )}
                {connection.status === "reauth-required" && (
                  <>
                    <span>{text.reauthRequired}</span>
                    <div className="checkout-connection-actions"><a href={`/login?return_to=${loginReturn}`}>{text.reauthenticate}</a></div>
                  </>
                )}
                {connection.status === "error" && (
                  <>
                    <span>{text.connectionBlocked}</span>
                    <code>{connection.message}</code>
                    <button type="button" onClick={() => void loadCheckoutContext()}>{text.retry}</button>
                  </>
                )}
                {submit.status === "error" && <code>{submit.message}</code>}
              </div>
            )}
          </>
        )}
      </div>
    </ResponsivePageShell>
  );
}
