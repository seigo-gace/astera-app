import { expect, test, type Page, type Route } from '@playwright/test';

function json(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({
    status,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify(body),
  });
}

async function mockApi(page: Page): Promise<void> {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;

    if (path === '/api/account') {
      await json(route, {
        account: {
          id: 'account-horizontal-test',
          nickname: 'Horizontal Test',
          email: 'horizontal@example.test',
          current_plan_name: 'Basic',
          credit_balance: 1000,
          storage: { used: 10, quota: 100 },
        },
      });
      return;
    }

    if (path === '/api/projects') {
      await json(route, {
        projects: [{
          id: 'project-horizontal-test',
          name: 'Horizontal Stability Project',
          updated_at: '2026-08-04',
        }],
      });
      return;
    }

    await json(route, { ok: true, data: {} });
  });
}

async function horizontalState(page: Page) {
  return page.evaluate(() => {
    const documentElement = document.documentElement;
    const body = document.body;
    const root = document.getElementById('root');
    const rootRect = root?.getBoundingClientRect();

    return {
      clientWidth: documentElement.clientWidth,
      documentScrollWidth: documentElement.scrollWidth,
      bodyScrollWidth: body.scrollWidth,
      windowScrollX: window.scrollX,
      windowScrollY: window.scrollY,
      documentScrollLeft: documentElement.scrollLeft,
      bodyScrollLeft: body.scrollLeft,
      rootLeft: rootRect?.left ?? 0,
      rootRight: rootRect?.right ?? 0,
      rootWidth: rootRect?.width ?? 0,
    };
  });
}

async function expectNoDocumentHorizontalOverflow(page: Page, label: string): Promise<void> {
  const state = await horizontalState(page);
  expect(state.documentScrollWidth, `${label}: document overflow`).toBeLessThanOrEqual(state.clientWidth + 1);
  expect(state.bodyScrollWidth, `${label}: body overflow`).toBeLessThanOrEqual(state.clientWidth + 1);
  expect(Math.abs(state.windowScrollX), `${label}: window scrollX`).toBeLessThanOrEqual(0.5);
  expect(Math.abs(state.documentScrollLeft), `${label}: document scrollLeft`).toBeLessThanOrEqual(0.5);
  expect(Math.abs(state.bodyScrollLeft), `${label}: body scrollLeft`).toBeLessThanOrEqual(0.5);
  expect(Math.abs(state.rootLeft), `${label}: root left anchor`).toBeLessThanOrEqual(1);
  expect(state.rootRight, `${label}: root right boundary`).toBeLessThanOrEqual(state.clientWidth + 1);
  expect(state.rootWidth, `${label}: root width`).toBeGreaterThan(0);
}

async function waitForSettledOrientation(page: Page, orientation: 'portrait' | 'landscape'): Promise<void> {
  await expect.poll(() => page.evaluate(() => ({
    orientation: document.documentElement.dataset.asteraOrientation,
    rotating: document.documentElement.classList.contains('astera-rotating'),
  }))).toEqual({ orientation, rotating: false });
}

test.beforeEach(async ({ page }) => {
  await mockApi(page);
});

test('horizontal wheel and drawer interactions cannot move the document sideways', async ({ page }) => {
  await page.goto('/app/projects', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#root')).toBeVisible();
  await expectNoDocumentHorizontalOverflow(page, 'initial');

  await page.mouse.wheel(1200, 0);
  await page.waitForTimeout(80);
  await expectNoDocumentHorizontalOverflow(page, 'after horizontal wheel');

  const viewport = page.viewportSize();
  if (viewport && viewport.width <= 760) {
    const menu = page.getByRole('button', { name: 'Menu' });
    await expect(menu).toBeVisible();
    await menu.click();
    await expect(page.locator('#platform-mobile-drawer')).toBeVisible();
    await expectNoDocumentHorizontalOverflow(page, 'drawer open');
    await page.getByRole('button', { name: 'Menuを閉じる' }).click();
    await expect(page.locator('#platform-mobile-drawer')).toHaveCount(0);
    await expectNoDocumentHorizontalOverflow(page, 'drawer closed');
  }
});

test('long unbroken content and many chips wrap instead of creating a horizontal scroller', async ({ page }) => {
  await page.goto('/support', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#root')).toBeVisible();

  await page.evaluate(() => {
    const host = document.querySelector('.platform-public-content') ?? document.getElementById('root');
    if (!host) throw new Error('HORIZONTAL_TEST_HOST_MISSING');

    const code = document.createElement('code');
    code.id = 'horizontal-long-code';
    code.textContent = `https://example.test/${'unbroken-segment-'.repeat(180)}`;
    host.appendChild(code);

    const row = document.createElement('div');
    row.id = 'horizontal-chip-row';
    row.className = 'selection-row';
    for (let index = 0; index < 12; index += 1) {
      const chip = document.createElement('span');
      chip.className = 'selection-chip';
      chip.textContent = `非常に長い選択項目-${index}-${'ABCDEFGHIJ'.repeat(5)}`;
      row.appendChild(chip);
    }
    host.appendChild(row);
  });

  await expectNoDocumentHorizontalOverflow(page, 'long content');
  const chipState = await page.locator('#horizontal-chip-row').evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    flexWrap: getComputedStyle(element).flexWrap,
    overflowX: getComputedStyle(element).overflowX,
  }));
  expect(chipState.scrollWidth).toBeLessThanOrEqual(chipState.clientWidth + 1);
  expect(chipState.flexWrap).toBe('wrap');
  expect(['visible', 'clip', 'hidden']).toContain(chipState.overflowX);
});

test('vertical scrollbar appearance and viewport restoration do not shift the page horizontally', async ({ page }) => {
  await page.goto('/support', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#root')).toBeVisible();
  const before = await horizontalState(page);

  await page.evaluate(() => {
    const spacer = document.createElement('div');
    spacer.id = 'horizontal-scrollbar-spacer';
    spacer.style.height = '2400px';
    spacer.style.width = '1px';
    document.body.appendChild(spacer);
  });
  await page.waitForTimeout(80);
  await expectNoDocumentHorizontalOverflow(page, 'vertical scrollbar present');
  const withScrollbar = await horizontalState(page);
  expect(Math.abs(withScrollbar.rootLeft - before.rootLeft)).toBeLessThanOrEqual(1);

  const viewport = page.viewportSize();
  if (viewport) {
    const temporaryWidth = Math.max(320, viewport.width - 37);
    await page.setViewportSize({ width: temporaryWidth, height: viewport.height });
    await page.waitForTimeout(80);
    await expectNoDocumentHorizontalOverflow(page, 'temporary viewport');
    await page.setViewportSize(viewport);
    await page.waitForTimeout(80);
    await expectNoDocumentHorizontalOverflow(page, 'restored viewport');
  }
});

test('portrait landscape round trip preserves input and scroll without horizontal movement', async ({ page }) => {
  const initial = page.viewportSize();
  if (!initial) throw new Error('VIEWPORT_SIZE_MISSING');
  const shortSide = Math.min(initial.width, initial.height);
  const longSide = Math.max(initial.width, initial.height);
  const portrait = { width: shortSide, height: longSide };
  const landscape = { width: longSide, height: shortSide };

  await page.setViewportSize(portrait);
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await waitForSettledOrientation(page, 'portrait');
  await page.getByLabel('Email').fill('rotation@example.test');
  await page.getByLabel('Password').fill('rotation-password-123');

  await page.evaluate(() => {
    const events: string[] = [];
    window.addEventListener('astera:orientationchange', (event) => {
      const detail = (event as CustomEvent<{ current?: string }>).detail;
      if (detail?.current) events.push(detail.current);
    });
    (window as Window & { __ASTERA_ORIENTATION_EVENTS__?: string[] }).__ASTERA_ORIENTATION_EVENTS__ = events;

    const spacer = document.createElement('div');
    spacer.id = 'rotation-scroll-spacer';
    spacer.style.height = '1800px';
    spacer.style.width = '1px';
    document.body.appendChild(spacer);
    window.scrollTo({ top: 180, left: 0, behavior: 'auto' });
  });

  await page.setViewportSize(landscape);
  await waitForSettledOrientation(page, 'landscape');
  await expect(page.getByLabel('Email')).toHaveValue('rotation@example.test');
  await expect(page.getByLabel('Password')).toHaveValue('rotation-password-123');
  await expectNoDocumentHorizontalOverflow(page, 'landscape settled');
  const landscapeState = await horizontalState(page);
  expect(landscapeState.windowScrollY).toBeGreaterThanOrEqual(170);

  await page.setViewportSize(portrait);
  await waitForSettledOrientation(page, 'portrait');
  await expect(page.getByLabel('Email')).toHaveValue('rotation@example.test');
  await expect(page.getByLabel('Password')).toHaveValue('rotation-password-123');
  await expectNoDocumentHorizontalOverflow(page, 'portrait restored');
  const portraitState = await horizontalState(page);
  expect(portraitState.windowScrollY).toBeGreaterThanOrEqual(170);

  const orientationEvents = await page.evaluate(() =>
    (window as Window & { __ASTERA_ORIENTATION_EVENTS__?: string[] }).__ASTERA_ORIENTATION_EVENTS__ ?? [],
  );
  expect(orientationEvents).toContain('landscape');
  expect(orientationEvents).toContain('portrait');
});

test('open compact drawer closes before landscape layout settles', async ({ page }) => {
  const initial = page.viewportSize();
  if (!initial) throw new Error('VIEWPORT_SIZE_MISSING');
  const shortSide = Math.min(initial.width, initial.height);
  test.skip(shortSide > 760, 'Compact drawer is not used at this portrait width');

  const longSide = Math.max(initial.width, initial.height);
  await page.setViewportSize({ width: shortSide, height: longSide });
  await page.goto('/app/projects', { waitUntil: 'domcontentloaded' });
  await waitForSettledOrientation(page, 'portrait');

  await page.getByRole('button', { name: 'Menu' }).click();
  await expect(page.locator('#platform-mobile-drawer')).toBeVisible();

  await page.setViewportSize({ width: longSide, height: shortSide });
  await waitForSettledOrientation(page, 'landscape');
  await expect(page.locator('#platform-mobile-drawer')).toHaveCount(0);
  await expectNoDocumentHorizontalOverflow(page, 'drawer rotation settled');
});
