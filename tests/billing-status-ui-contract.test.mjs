import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/platform/pages/AccountPages.tsx', import.meta.url), 'utf8');
const horizontalCss = readFileSync(new URL('../src/horizontal-stability.css', import.meta.url), 'utf8');
const start = source.indexOf('function BillingStatusPage');
const end = source.indexOf('function targetCanIssue');
const billingStatusSource = source.slice(start, end);

test('billing result page is customer-facing instead of a raw internal status dump', () => {
  assert.ok(start >= 0 && end > start, 'BillingStatusPage source must exist');
  assert.doesNotMatch(billingStatusSource, /<KeyValueGrid\s+value=\{resource\.data\}/);
  assert.doesNotMatch(billingStatusSource, /Billing状態/);
  assert.doesNotMatch(billingStatusSource, /Redirectだけを信用せず/);

  for (const internalLabel of ['Intent Id', 'Catalog Version', 'Return Context Id', 'Resume Mode', 'Provider Payment Id']) {
    assert.doesNotMatch(billingStatusSource, new RegExp(internalLabel));
  }
});

test('completed billing layout keeps only completion hero and Astera action', () => {
  for (const requiredText of [
    'プランの登録が完了しました',
    '購入したプランとCreditがAsteraアカウントへ反映されています。',
    'Asteraを使う',
  ]) {
    assert.match(billingStatusSource, new RegExp(requiredText));
  }

  for (const hiddenSelector of [
    '.platform-page-head',
    'section[aria-labelledby="billing-summary-heading"]',
    'a[href="/account/subscription"]',
    'a[href="/account/credit"]',
  ]) {
    assert.match(horizontalCss, new RegExp(hiddenSelector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(horizontalCss, /display:\s*none\s*!important/);
});

test('billing completion layout has explicit PC, tablet, and smartphone rules', () => {
  assert.match(horizontalCss, /width:\s*min\(100%,\s*680px\)/);
  assert.match(horizontalCss, /@media \(min-width: 721px\) and \(max-width: 1024px\)/);
  assert.match(horizontalCss, /@media \(max-width: 720px\)/);
  assert.match(horizontalCss, /width:\s*100%\s*!important/);
  assert.match(horizontalCss, /max-width:\s*100%\s*!important/);
});

test('pending and failed payment safety actions remain available', () => {
  assert.match(billingStatusSource, /状態を更新/);
  assert.match(billingStatusSource, /二重決済/);
  assert.match(billingStatusSource, /サポート/);
});
