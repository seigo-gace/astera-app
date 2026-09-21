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

  await page.route('**/api/account', async (route) => {
    return json(route, { account: { account_status: 'active' } });
  });
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
  await page.getByRole('button', { name: 'Squareで支払う' }).evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });

  await expect(page.getByText('CHECKOUT_URL_REJECTED')).toBeVisible();
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

test('STORY-CHECKOUT-007 successful reauthentication returns to checkout and refetches fresh state', async ({ page }) => {
  let fresh = false;
  let catalogRequests = 0;
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/account') {
      return json(route, { account: { account_status: 'active', email: 'checkout@example.test' } });
    }
    if (path === '/api/account/catalog') {
      catalogRequests += 1;
      if (!fresh) {
        return json(route, { error: { code: 'FRESH_SESSION_REQUIRED', message: 'Fresh session required' } }, 403);
      }
      return json(route, {
        account: { current_plan_name: 'Free' },
        plans: [{ plan_id: 'basic', display_name: 'Basic', price_label: '¥980' }],
      });
    }
    if (path === '/api/auth/sign-in/email') {
      fresh = true;
      return json(route, { user: { emailVerified: true, account_status: 'active' } });
    }
    return json(route, { ok: true });
  });

  await page.goto('/account/checkout?plan=basic&return_to=pricing');
  await page.getByRole('link', { name: '再認証' }).click();
  await expect(page).toHaveURL(/\/login\?return_to=/);
  await page.getByLabel('Email').fill('checkout@example.test');
  await page.getByLabel('Password').fill('test-password');
  await page.getByRole('button', { name: 'EmailでLogin' }).click();
  await expect(page).toHaveURL(/\/account\/checkout\?plan=basic&return_to=pricing/);
  await expect(page.getByText('安全な決済操作のため再認証してください。')).toHaveCount(0);
  await page.getByRole('checkbox').check();
  await expect(page.getByRole('button', { name: 'Squareで支払う' })).toBeEnabled();
  expect(catalogRequests).toBeGreaterThanOrEqual(2);
});

test('STORY-CHECKOUT-008 a security hold never enables checkout', async ({ page }) => {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/account') {
      return json(route, { account: { account_status: 'active', email: 'checkout@example.test' } });
    }
    if (path === '/api/account/catalog') {
      return json(route, { error: { code: 'ACCOUNT_SECURITY_HOLD', message: 'Security hold' } }, 403);
    }
    return json(route, { ok: true });
  });

  await page.goto('/account/checkout?plan=basic&return_to=pricing');
  await expect(page.getByRole('alert')).toContainText('ACCOUNT_SECURITY_HOLD');
  await expect(page.getByRole('button', { name: 'Squareで支払う' })).toBeDisabled();
  await expect(page.getByRole('link', { name: '再認証' })).toHaveCount(0);
});
