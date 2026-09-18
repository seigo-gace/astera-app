import { expect, test, type Route, type TestInfo } from '@playwright/test';

const STORY_PROJECTS = new Set(['chromium-desktop', 'webkit-iphone-large']);

function json(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({
    status,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify(body),
  });
}

test.beforeEach(async ({}, testInfo: TestInfo) => {
  test.skip(!STORY_PROJECTS.has(testInfo.project.name), 'Checkout resilience story uses Chromium and WebKit touch representatives.');
});

test('STORY-CHECKOUT-003 rapid duplicate confirmation creates one Checkout Intent with one request identity', async ({ page }) => {
  let checkoutRequests = 0;
  const idempotencyKeys: string[] = [];
  const requestIds: string[] = [];

  await page.route('**/api/account/catalog', async (route) => {
    return json(route, {
      account: { current_plan_name: 'Free' },
      plans: [{ plan_id: 'basic', display_name: 'Basic', price_label: '¥980' }],
    });
  });
  await page.route('**/api/billing/checkout-intents', async (route) => {
    checkoutRequests += 1;
    const headers = route.request().headers();
    idempotencyKeys.push(headers['idempotency-key'] ?? '');
    requestIds.push(headers['x-request-id'] ?? '');
    await new Promise((resolve) => setTimeout(resolve, 150));
    return json(route, { checkout_url: 'https://evil.example/rejected' });
  });

  await page.goto('/account/checkout?plan=basic&return_to=pricing');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Square Checkoutへ進む' }).evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });

  await expect(page.getByRole('alert')).toContainText('CHECKOUT_URL_REJECTED');
  expect(checkoutRequests).toBe(1);
  expect(idempotencyKeys[0].length).toBeGreaterThan(10);
  expect(requestIds[0]).toBe(idempotencyKeys[0]);
});

test('STORY-CHECKOUT-004 a stale authenticated session requests reauthentication and keeps the checkout return URL', async ({ page }) => {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/account') {
      return json(route, { account: { account_status: 'active', email: 'checkout@example.test' } });
    }
    if (path === '/api/account/catalog') {
      return json(route, { error: { code: 'FRESH_SESSION_REQUIRED', message: 'Fresh session required' } }, 403);
    }
    return json(route, { ok: true });
  });

  await page.goto('/account/checkout?plan=basic&return_to=pricing');
  await expect(page.getByText('安全な決済操作のため再認証してください。')).toBeVisible();
  await expect(page.getByText('決済へ進むにはLoginが必要です。')).toHaveCount(0);
  const href = await page.getByRole('link', { name: '再認証' }).getAttribute('href');
  expect(decodeURIComponent(href ?? '')).toContain('/account/checkout?plan=basic&return_to=pricing');
});

test('STORY-CHECKOUT-005 a missing session remains a Login-required state', async ({ page }) => {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/account') {
      return json(route, { account: { account_status: 'active', email: 'checkout@example.test' } });
    }
    if (path === '/api/account/catalog') {
      return json(route, { error: { code: 'SESSION_REQUIRED', message: 'Login required' } }, 401);
    }
    return json(route, { ok: true });
  });

  await page.goto('/account/checkout?plan=basic&return_to=pricing');
  await expect(page.getByText('決済へ進むにはLoginが必要です。')).toBeVisible();
  await expect(page.getByText('安全な決済操作のため再認証してください。')).toHaveCount(0);
});

test('STORY-CHECKOUT-006 a non-auth 403 preserves the account error code', async ({ page }) => {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/account') {
      return json(route, { account: { account_status: 'active', email: 'checkout@example.test' } });
    }
    if (path === '/api/account/catalog') {
      return json(route, { error: { code: 'ACCOUNT_SUSPENDED', message: 'Account suspended' } }, 403);
    }
    return json(route, { ok: true });
  });

  await page.goto('/account/checkout?plan=basic&return_to=pricing');
  await expect(page.getByRole('alert')).toContainText('ACCOUNT_SUSPENDED');
  await expect(page.getByText('決済へ進むにはLoginが必要です。')).toHaveCount(0);
});
