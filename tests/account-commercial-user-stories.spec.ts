import { expect, test, type Route, type TestInfo } from '@playwright/test';

const STORY_PROJECTS = new Set(['chromium-desktop', 'webkit-iphone-large']);

function json(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({
    status,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify(body),
  });
}

function activeAccount() {
  return {
    account: {
      id: 'commercial-user',
      nickname: 'Commercial User',
      email: 'commercial@example.test',
      account_status: 'active',
    },
  };
}

test.beforeEach(async ({}, testInfo: TestInfo) => {
  test.skip(!STORY_PROJECTS.has(testInfo.project.name), 'Account and commercial stories use Chromium and WebKit touch representatives.');
});

test('STORY-LOGIN-005 authentication routes cannot become post-Login return targets', async ({ page }) => {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/login') return json(route, { authenticated: true, account: { account_status: 'active' } });
    if (path === '/api/account') return json(route, activeAccount());
    return json(route, { ok: true });
  });

  await page.goto('/login?return_to=%2Flogin%3Freturn_to%3D%252Flogin');
  await page.getByLabel('Email').fill('commercial@example.test');
  await page.getByLabel('Password').fill('commercial-password-123');
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/new$/);
});

test('STORY-PRICING-001 catalog failure is visible and retry can recover without stale plans', async ({ page }) => {
  let catalogRequests = 0;
  await page.route('**/api/catalog/public', async (route) => {
    catalogRequests += 1;
    if (catalogRequests === 1) return json(route, { error: { code: 'CATALOG_TEMPORARILY_UNAVAILABLE' } }, 503);
    return json(route, {
      catalog_version: 'story-v2',
      plans: [{ plan_id: 'basic', display_name: 'Basic', price_label: '¥980', monthly_credits: '1000' }],
    });
  });

  await page.goto('/pricing');
  await expect(page.getByRole('alert')).toContainText('CATALOG_HTTP_503');
  await page.getByRole('button', { name: '再読み込み' }).click();
  await expect(page.getByRole('heading', { name: 'Basic' })).toBeVisible();
  await expect(page.getByText('Catalog Version: story-v2')).toBeVisible();
  expect(catalogRequests).toBe(2);
});

test('STORY-HISTORY-001 rapid typing produces one debounced search request for the final text', async ({ page }) => {
  let searchRequests = 0;
  let finalQuery = '';
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/account') return json(route, activeAccount());
    if (url.pathname === '/api/history') {
      if (url.searchParams.has('q')) {
        searchRequests += 1;
        finalQuery = url.searchParams.get('q') ?? '';
      }
      return json(route, { items: [] });
    }
    return json(route, { ok: true });
  });

  await page.goto('/app/history');
  const search = page.getByLabel('Keyword');
  await search.pressSequentially('final query', { delay: 15 });
  await page.waitForTimeout(500);

  expect(searchRequests).toBe(1);
  expect(finalQuery).toBe('final query');
});

test('STORY-SECURITY-001 incomplete Passkey and 2FA actions are disabled and never call mutation APIs', async ({ page }) => {
  let mutationRequests = 0;
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/account') return json(route, activeAccount());
    if (path === '/api/account/security') return json(route, { security: { active_sessions: 1 } });
    if (request.method() !== 'GET' && path.startsWith('/api/account/')) mutationRequests += 1;
    return json(route, { ok: true });
  });

  await page.goto('/account/security');
  await expect(page.getByText('成功したように見せる空POSTは行いません。')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Passkeyを追加' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '2FAを有効化' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Backup Code再生成' })).toBeDisabled();
  expect(mutationRequests).toBe(0);
});

test('STORY-CREDIT-001 Credit purchase accepts only active products from the account catalog', async ({ page }) => {
  let checkoutBody: Record<string, unknown> = {};
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/account') return json(route, activeAccount());
    if (path === '/api/account/catalog') {
      return json(route, {
        creditProducts: [
          { product_id: 'credit-1000', display_name: '1,000 Credit', price_label: '¥500', credits: 1000, active: true },
          { product_id: 'retired-product', display_name: 'Retired', active: false },
        ],
      });
    }
    if (path === '/api/credit/balance') return json(route, { balance: 500 });
    if (path === '/api/credit/ledger') return json(route, { entries: [] });
    if (path === '/api/billing/checkout-intents') {
      checkoutBody = request.postDataJSON() as Record<string, unknown>;
      return json(route, { checkout_url: '/account/billing/status?intent=credit-story' });
    }
    return json(route, { ok: true });
  });

  await page.goto('/account/credit');
  const product = page.getByLabel('Credit商品');
  await expect(product).toHaveValue('credit-1000');
  await expect(product.locator('option')).toHaveCount(1);
  await page.getByRole('button', { name: 'Checkoutへ' }).click();
  await expect(page).toHaveURL(/\/account\/billing\/status\?intent=credit-story$/);
  expect(checkoutBody.product_id).toBe('credit-1000');
});

test('STORY-CREDIT-002 an untrusted Credit Checkout URL is rejected and stays on the Credit page', async ({ page }) => {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/account') return json(route, activeAccount());
    if (path === '/api/account/catalog') return json(route, { creditProducts: [{ product_id: 'credit-1000', display_name: '1,000 Credit', active: true }] });
    if (path === '/api/credit/balance') return json(route, { balance: 500 });
    if (path === '/api/credit/ledger') return json(route, { entries: [] });
    if (path === '/api/billing/checkout-intents') return json(route, { checkout_url: 'https://evil.example/credit-phishing' });
    return json(route, { ok: true });
  });

  await page.goto('/account/credit');
  await page.getByRole('button', { name: 'Checkoutへ' }).click();
  await expect(page.getByRole('alert')).toContainText('CHECKOUT_URL_REJECTED');
  await expect(page).toHaveURL(/\/account\/credit$/);
});

test('STORY-DEVELOPER-001 unavailable API targets remain visible but cannot be selected for key issuance', async ({ page }) => {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/account') return json(route, activeAccount());
    if (path === '/api/developer/catalog') {
      return json(route, {
        targets: [
          { target_id: 'astera.integrated', display_name: 'Astera Integrated', availability: 'available', key_issuance_allowed: true },
          { target_id: 'skill-runtime', display_name: 'Skill Runtime', availability: 'preparing', key_issuance_allowed: false },
        ],
      });
    }
    if (path === '/api/developer/keys') return json(route, { keys: [] });
    return json(route, { ok: true });
  });

  await page.goto('/app/developer');
  await expect(page.getByText('Skill Runtime')).toBeVisible();
  const target = page.getByLabel('Target');
  await expect(target.locator('option')).toHaveCount(2);
  await expect(target.locator('option')).not.toContainText('Skill Runtime');
});

test('STORY-DEVELOPER-002 issued API Key Secret is shown once and missing Secret fails closed', async ({ page }) => {
  let issuance = 0;
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/account') return json(route, activeAccount());
    if (path === '/api/developer/catalog') return json(route, { targets: [{ target_id: 'astera.integrated', display_name: 'Astera Integrated', availability: 'available', key_issuance_allowed: true }] });
    if (path === '/api/developer/keys') return json(route, { keys: [] });
    if (path === '/api/developer/targets/astera.integrated/keys') {
      issuance += 1;
      return issuance === 1 ? json(route, { api_key: 'astera_story_secret_once' }) : json(route, { key_id: 'key-without-secret' });
    }
    return json(route, { ok: true });
  });

  await page.goto('/app/developer');
  await page.getByLabel('Target').selectOption('astera.integrated');
  await page.getByRole('button', { name: '発行' }).click();
  await expect(page.getByText('このSecretは再表示されません。')).toBeVisible();
  await expect(page.getByText('astera_story_secret_once')).toBeVisible();

  await page.getByRole('button', { name: '発行' }).click();
  await expect(page.getByRole('alert')).toContainText('API_KEY_SECRET_MISSING');
});
