#!/usr/bin/env node
const token = process.env.SQUARE_ACCESS_TOKEN?.trim();
if (!token) {
  console.error('BLOCKED: SQUARE_ACCESS_TOKEN missing');
  process.exit(1);
}

const { ensureSquarePaidPlanVariants, sqlQuote } = await import('./square-sandbox-bootstrap.mjs');

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
const databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID?.trim() || '08a705ac-50f4-4592-b726-d50154a2a8cb';
const apiToken = process.env.CLOUDFLARE_API_TOKEN?.trim();

async function d1Execute(sql) {
  if (!accountId || !apiToken) {
    console.error('BLOCKED: CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID missing (live D1 UPSERT skipped)');
    process.exit(2);
  }
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sql }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success) {
    console.error('BLOCKED: D1 UPSERT failed');
    process.exit(3);
  }
}

const { mapping } = await ensureSquarePaidPlanVariants(token);
for (const item of Object.values(mapping)) {
  const sql = `
    UPDATE plan_billing_variants
    SET square_plan_variation_id=${sqlQuote(item.square_plan_variation_id)}
    WHERE plan_id=${sqlQuote(item.plan_id)}
      AND billing_cycle=${sqlQuote(item.billing_cycle)};
  `.replace(/\s+/g, ' ').trim();
  await d1Execute(sql);
}
console.log(JSON.stringify({ ok: true, mapped: Object.keys(mapping).length }));
