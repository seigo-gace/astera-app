import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/platform/pages/AccountPages.tsx', import.meta.url), 'utf8');
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

test('billing result page exposes useful post-purchase actions and responsive summary', () => {
  for (const customerText of [
    'ご購入内容',
    '今回のお支払い',
    '現在のCredit',
    'Asteraを使う',
    '状態を更新',
    'プランを管理',
    'Creditを確認',
  ]) {
    assert.match(billingStatusSource, new RegExp(customerText));
  }

  assert.match(billingStatusSource, /maxWidth: '760px'/);
  assert.match(billingStatusSource, /repeat\(auto-fit, minmax\(180px, 1fr\)\)/);
  assert.match(billingStatusSource, /二重決済/);
});
