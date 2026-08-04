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
