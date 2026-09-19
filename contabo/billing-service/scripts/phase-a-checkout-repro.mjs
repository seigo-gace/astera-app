#!/usr/bin/env node
/**
 * Phase A: authenticated checkout reproduction (no secrets on stdout).
 */
import fs from 'node:fs';
import crypto from 'node:crypto';

const BILLING_BASE = process.env.BILLING_BASE_URL || 'http://127.0.0.1:8792';
const APP_SECRET_FILE =
  process.env.BILLING_APP_SECRET_FILE || '/home/admin1/.config/astera-billing/billing-app-secret';
const PROJ_SECRET_FILE =
  process.env.BILLING_PROJECTION_SECRET_FILE || '/home/admin1/.config/astera-billing/billing-projection-secret';
const PROJECTION_URL = process.env.ASTERA_PROJECTION_API_URL;

const TENANT_ID = process.env.PHASE_A_TENANT_ID || 'personal:mL7HVxUNR3FS0sNmovqSJhr7FVO9nNTz';
const USER_ID = process.env.PHASE_A_USER_ID || 'mL7HVxUNR3FS0sNmovqSJhr7FVO9nNTz';

function readSecretFile(path) {
  return fs.readFileSync(path, 'utf8').trim();
}

async function projectionPost(pathname, body) {
  const secret = readSecretFile(PROJ_SECRET_FILE);
  const url = `${PROJECTION_URL}${pathname}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${secret}`,
      'X-Request-ID': `phase-a-${crypto.randomUUID()}`,
    },
    body: JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { _raw_prefix: text.slice(0, 200) };
  }
  return { status: res.status, json };
}

async function billingCheckout(kind, body) {
  const secret = readSecretFile(APP_SECRET_FILE);
  const correlationId = `phase-a-${kind}-${crypto.randomUUID()}`;
  const res = await fetch(`${BILLING_BASE}/api/billing/checkout-intents`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${secret}`,
      'Idempotency-Key': `phase-a-${kind}-${crypto.randomUUID()}`,
      'X-Correlation-ID': correlationId,
      'x-astera-tenant-id': TENANT_ID,
      'x-astera-user-id': USER_ID,
      'x-astera-user-email': 'phase-a-probe@internal.local',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { message: text.slice(0, 300) };
  }
  const out = {
    kind,
    http_status: res.status,
    correlation_id: res.headers.get('x-correlation-id') || correlationId,
    error_code: json.code ?? null,
    message: json.message ?? null,
    intent_id: json.intent_id ?? null,
    checkout_url_present: Boolean(json.checkout_url),
  };
  console.log(JSON.stringify(out));
  return out;
}

async function storageCheckout(productId) {
  const secret = readSecretFile(APP_SECRET_FILE);
  const correlationId = `phase-a-storage-${crypto.randomUUID()}`;
  const res = await fetch(`${BILLING_BASE}/api/storage/checkout-intents`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${secret}`,
      'Idempotency-Key': `phase-a-storage-${crypto.randomUUID()}`,
      'X-Correlation-ID': correlationId,
      'x-astera-tenant-id': TENANT_ID,
      'x-astera-user-id': USER_ID,
      'x-astera-user-email': 'phase-a-probe@internal.local',
    },
    body: JSON.stringify({ product_id: productId, return_to: 'account' }),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { message: text.slice(0, 300) };
  }
  const out = {
    kind: 'storage',
    http_status: res.status,
    correlation_id: res.headers.get('x-correlation-id') || correlationId,
    error_code: json.code ?? null,
    message: json.message ?? null,
    intent_id: json.intent_id ?? null,
    checkout_url_present: Boolean(json.checkout_url),
  };
  console.log(JSON.stringify(out));
  return out;
}

async function main() {
  if (!PROJECTION_URL) {
    console.log(JSON.stringify({ fatal: 'ASTERA_PROJECTION_API_URL unset' }));
    process.exit(1);
  }

  const catalog = await projectionPost('/internal/billing/reads/catalog', {});
  if (catalog.status !== 200) {
    console.log(JSON.stringify({ fatal: 'catalog_read_failed', status: catalog.status }));
    process.exit(1);
  }

  const credit = (catalog.json.creditProducts || []).find((p) => p.active && p.product_id === 'credit_500pack')
    || (catalog.json.creditProducts || []).find((p) => p.active);
  const plan = (catalog.json.plans || []).find((p) => p.active && p.plan_id === 'basic')
    || (catalog.json.plans || []).find((p) => p.active && p.plan_id !== 'free');

  const storageCommerce = await projectionPost('/internal/billing/reads/storage-commerce', {
    tenant_id: TENANT_ID,
  });
  let storageProductId = null;
  if (storageCommerce.status === 200) {
    const packs = storageCommerce.json.commerce?.packs || storageCommerce.json.packs || [];
    const active = packs.find((p) => p.active !== false && (p.product_id || p.productId));
    storageProductId = active?.product_id ?? active?.productId ?? null;
  }

  console.log(
    JSON.stringify({
      catalog_version: catalog.json.catalog_version,
      credit_product_id: credit?.product_id ?? null,
      plan_id: plan?.plan_id ?? null,
      storage_product_id: storageProductId,
      storage_commerce_status: storageCommerce.status,
    }),
  );

  if (credit?.product_id) {
    await billingCheckout('credit', { product_id: credit.product_id, return_to: 'credit' });
  }
  if (plan?.plan_id) {
    await billingCheckout('plan', { plan_id: plan.plan_id, billing_cycle: 'monthly', return_to: 'account' });
  }
  if (storageProductId) {
    await storageCheckout(storageProductId);
  }
}

main().catch((error) => {
  console.log(JSON.stringify({ fatal: error?.message || String(error) }));
  process.exit(1);
});
