import assert from 'node:assert/strict';
import test from 'node:test';

import {
  checkoutResponseError,
  isAllowedCheckoutUrl,
} from '../src/features/checkout/checkout-security.ts';

test('checkout authentication distinguishes missing, stale, and forbidden sessions', () => {
  assert.equal(
    checkoutResponseError(401, { error: { code: 'SESSION_REQUIRED' } }, 'HTTP_401').authentication,
    'login-required',
  );
  assert.equal(
    checkoutResponseError(403, { error: { code: 'FRESH_SESSION_REQUIRED' } }, 'HTTP_403').authentication,
    'reauth-required',
  );
  assert.deepEqual(
    checkoutResponseError(403, { error: { code: 'ACCOUNT_SUSPENDED' } }, 'HTTP_403'),
    { authentication: null, code: 'ACCOUNT_SUSPENDED', message: 'ACCOUNT_SUSPENDED' },
  );
});

test('checkout URL allowlist accepts only intended HTTPS Square destinations', () => {
  for (const url of [
    'https://sandbox.square.link/u/test',
    'https://square.link/u/test',
    'https://checkout.square.site/test',
    'https://merchant.square.site/test',
    'https://checkout.squareup.com/pay/test',
  ]) {
    assert.equal(isAllowedCheckoutUrl(url), true, url);
  }

  for (const url of [
    'http://sandbox.square.link/u/test',
    'https://square.link.evil.example/u/test',
    'https://evil.example/u/test',
    'https://unexpected.square.link/u/test',
    '/account/billing/status?intent=test',
  ]) {
    assert.equal(isAllowedCheckoutUrl(url), false, url);
  }
});
