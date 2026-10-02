import { expect, test, type Page, type Route, type TestInfo } from '@playwright/test';

function json(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({ status, contentType: 'application/json; charset=utf-8', body: JSON.stringify(body) });
}

async function installRuntime(page: Page): Promise<void> {
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/account') return json(route, { account: { id: 'viewport-user', account_status: 'active' } });
    if (path === '/api/preferences') return json(route, { preferences: { translation: true, agent_mode: true, storage_transfer: true } });
    if (path === '/api/credit/balance') return json(route, { usable_balance: 1000, reserved_balance: 0, state: 'healthy', policy: { low_threshold: 200 } });
    if (path === '/api/account/catalog') return json(route, { subscription: { plan_id: 'basic' }, plans: [{ plan_id: 'basic', included_credits: 1000 }] });
    if (path === '/api/conversations' && request.method() === 'GET') return json(route, { conversations: [] });
    if (path === '/api/history') return json(route, { items: [] });
    if (path === '/api/projects') return json(route, { projects: [] });
    if (path === '/api/storage/destinations') return json(route, { destinations: [] });
    return json(route, { ok: true });
  });
}

async function expectFullyInsideViewport(page: Page, label: string): Promise<void> {
  const control = page.getByRole('button', { name: label, exact: true });
  await expect(control).toBeVisible();
  const box = await control.boundingBox();
  const viewport = page.viewportSize();
  expect(box, `${label} のbounding box`).not.toBeNull();
  expect(viewport, 'viewport size').not.toBeNull();
  if (!box || !viewport) return;
  expect(box.x, `${label} left`).toBeGreaterThanOrEqual(0);
  expect(box.y, `${label} top`).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, `${label} right`).toBeLessThanOrEqual(viewport.width);
  expect(box.y + box.height, `${label} bottom`).toBeLessThanOrEqual(viewport.height);
}

async function logComposerGeometry(page: Page): Promise<void> {
  const geometry = await page.evaluate(() => {
    const selectors = [
      '.platform-shell',
      '.platform-main',
      '.platform-page-content',
      '.native-composer-workspace',
      '.native-composer-dock',
      '.native-composer',
      '.native-composer-actions',
    ];
    const rows = selectors.map((selector) => {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element) return { selector, missing: true };
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        selector,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, bottom: rect.bottom },
        height: style.height,
        minHeight: style.minHeight,
        paddingTop: style.paddingTop,
        paddingBottom: style.paddingBottom,
        marginTop: style.marginTop,
        boxSizing: style.boxSizing,
        overflow: style.overflow,
      };
    });
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      safeTop: getComputedStyle(document.documentElement).getPropertyValue('--safe-top'),
      safeBottom: getComputedStyle(document.documentElement).getPropertyValue('--safe-bottom'),
      rows,
    };
  });
  console.log(`COMPOSER_GEOMETRY=${JSON.stringify(geometry)}`);
}

async function fillAndVerifyComposerControls(page: Page): Promise<void> {
  await installRuntime(page);
  await page.goto('/app/new', { waitUntil: 'domcontentloaded' });
  const textarea = page.getByLabel('Astera入力');
  await expect(textarea).toBeVisible();
  await textarea.fill('1行目\n2行目');
  await logComposerGeometry(page);
  await expectFullyInsideViewport(page, 'Fileと実行Optionを追加');
  await expectFullyInsideViewport(page, 'Purposeを選択');
  await expectFullyInsideViewport(page, '実行');
}

test.beforeEach(async ({}, testInfo: TestInfo) => {
  test.skip(testInfo.project.name !== 'webkit-iphone-large', 'Mobile viewport regression uses the canonical large iPhone representative.');
});

test('MOBILE-COMPOSER-001 multiline input keeps plus, purpose and send fully inside viewport', async ({ page }) => {
  await fillAndVerifyComposerControls(page);
});

test('MOBILE-COMPOSER-002 landscape multiline input keeps plus, purpose and send fully inside viewport', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await fillAndVerifyComposerControls(page);
});
