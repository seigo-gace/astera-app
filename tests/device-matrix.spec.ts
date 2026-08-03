import { expect, test, type Page, type Route } from '@playwright/test';

const canonicalPaths = [
  '/',
  '/pricing',
  '/login',
  '/register',
  '/verify-email',
  '/forgot-password',
  '/reset-password?token=reset-token',
  '/account/password/setup',
  '/auth/2fa?challenge=challenge-1',
  '/app',
  '/app/new',
  '/app/results/result-1',
  '/app/projects',
  '/app/history',
  '/app/about',
  '/app/settings',
  '/app/settings/options',
  '/app/settings/language',
  '/app/settings/templates',
  '/app/settings/storage-destinations',
  '/app/settings/astera-storage',
  '/app/settings/data-privacy',
  '/account',
  '/account/security',
  '/account/subscription',
  '/account/credit',
  '/account/checkout?plan=basic&return_to=pricing',
  '/account/billing/status?intent=intent-1',
  '/app/developer',
  '/s/public-token',
  '/share/share-1',
  '/app/shares',
  '/legal',
  '/legal/terms',
  '/legal/privacy',
  '/legal/commercial',
  '/legal/api-terms',
  '/status',
  '/offline',
  '/maintenance',
  '/support',
  '/app/settings/notifications',
  '/unknown-route-device-test',
] as const;

function json(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({
    status,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify(body),
  });
}

async function mockApi(page: Page): Promise<void> {
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;

    if (path === '/api/account') {
      await json(route, {
        account: {
          id: 'account-1',
          nickname: 'Device Test',
          email: 'device@example.test',
          current_plan_name: 'Basic',
          credit_balance: 1000,
          storage: { used: 10, quota: 100 },
        },
      });
      return;
    }

    if (path === '/api/catalog/public' || path === '/api/account/catalog') {
      await json(route, {
        account: { current_plan_name: 'Basic', storage: { used: 10, quota: 100 } },
        plans: [{ plan_id: 'basic', display_name: 'Basic', price_label: '¥980', description: 'Device test plan' }],
      });
      return;
    }

    if (path === '/api/projects') {
      await json(route, request.method() === 'POST'
        ? { project: { id: 'project-2', name: 'New Project' } }
        : { projects: [{ id: 'project-1', name: 'Device Project', updated_at: '2026-08-04' }] });
      return;
    }

    if (path === '/api/history') {
      await json(route, { items: [{ id: 'result-1', result_id: 'result-1', title: 'Device Result', created_at: '2026-08-04' }] });
      return;
    }

    if (path === '/api/results/result-1') {
      await json(route, {
        result: { id: 'result-1', title: 'Device Result', status: 'complete' },
        sections: [{ key: 'purpose', title: '目的', body: '全端末で表示する検証結果です。' }],
      });
      return;
    }

    if (path === '/api/results/result-1/download') {
      await route.fulfill({ status: 200, contentType: 'text/markdown; charset=utf-8', body: '# Device Result' });
      return;
    }

    if (path === '/api/preferences') {
      await json(route, { preferences: { ui_language: 'ja', theme: 'dark', history_enabled: true, analytics_enabled: false } });
      return;
    }

    if (path === '/api/credit/notification-preferences') {
      await json(route, { preferences: { in_app_enabled: true, email_enabled: false, push_enabled: false, low_credit_threshold: '20' } });
      return;
    }

    if (path === '/api/templates') {
      await json(route, { templates: [{ id: 'template-1', title: 'Device Template', updated_at: '2026-08-04' }] });
      return;
    }

    if (path === '/api/storage/destinations') {
      await json(route, { destinations: [{ id: 'storage-1', display_name: 'Google Drive', status: 'connected' }] });
      return;
    }

    if (path === '/api/credit/balance') {
      await json(route, { balance: 1000, unit: 'credit' });
      return;
    }

    if (path === '/api/credit/ledger') {
      await json(route, { entries: [{ id: 'ledger-1', type: 'purchase', amount: 1000, status: 'complete' }] });
      return;
    }

    if (path === '/api/account/security') {
      await json(route, { security: { passkey_enabled: true, two_factor_enabled: false, active_sessions: 1 } });
      return;
    }

    if (path === '/api/developer/catalog') {
      await json(route, { targets: [{ id: 'astera', target_id: 'astera', display_name: 'Astera API', status: 'available' }] });
      return;
    }

    if (path === '/api/developer/keys') {
      await json(route, { keys: [{ id: 'key-1', label: 'Device Key', target_id: 'astera', status: 'active' }] });
      return;
    }

    if (path === '/api/shares') {
      await json(route, { items: [{ id: 'share-1', title: 'Device Share', status: 'active' }] });
      return;
    }

    if (path === '/api/shares/public/public-token' || path === '/api/shares/share-1') {
      await json(route, { share: { id: 'share-1', title: 'Device Share', content: '共有内容', status: 'active' } });
      return;
    }

    if (path.startsWith('/api/legal')) {
      await json(route, { title: 'Astera Legal', body: 'Device matrix legal content.' });
      return;
    }

    if (path === '/api/status') {
      await json(route, { status: 'operational', updated_at: '2026-08-04T00:00:00Z' });
      return;
    }

    if (path === '/api/billing/status/intent-1') {
      await json(route, { intent_id: 'intent-1', status: 'complete', credit_applied: true });
      return;
    }

    if (path === '/api/billing/checkout-intents') {
      await json(route, { checkout_url: 'https://square.link/u/device-test' });
      return;
    }

    if (path === '/api/auth/login') {
      await json(route, { account: { id: 'account-1' }, authenticated: true });
      return;
    }

    await json(route, { ok: true, data: {} });
  });
}

async function layoutState(page: Page) {
  return page.evaluate(() => {
    const documentElement = document.documentElement;
    const root = document.getElementById('root');
    return {
      viewportWidth: documentElement.clientWidth,
      scrollWidth: Math.max(documentElement.scrollWidth, document.body.scrollWidth),
      rootWidth: root?.getBoundingClientRect().width ?? 0,
      rootHeight: root?.getBoundingClientRect().height ?? 0,
      compatibility: documentElement.dataset.asteraDeviceCompatibility,
      viewportClass: documentElement.dataset.asteraViewport,
      bodyText: document.body.innerText,
    };
  });
}

async function blockedInteractiveControls(page: Page): Promise<string[]> {
  return page.locator('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [role="button"]')
    .evaluateAll((elements) => elements.flatMap((element, index) => {
      const node = element as HTMLElement;
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        Number(style.opacity) <= 0.05 ||
        style.pointerEvents === 'none' ||
        rect.width < 1 ||
        rect.height < 1
      ) return [];

      const x = Math.min(innerWidth - 1, Math.max(0, rect.left + rect.width / 2));
      const y = Math.min(innerHeight - 1, Math.max(0, rect.top + rect.height / 2));
      if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return [];
      const top = document.elementFromPoint(x, y);
      if (!top || top === node || node.contains(top) || top.contains(node)) return [];
      return [`${index}:${node.tagName}:${node.getAttribute('aria-label') ?? node.textContent?.trim().slice(0, 30) ?? ''}->${top.tagName}`];
    }));
}

test.beforeEach(async ({ page }) => {
  await mockApi(page);
});

test('all canonical routes render without horizontal overflow or blocked controls', async ({ page }) => {
  for (const path of canonicalPaths) {
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#root')).toBeVisible();
    await page.waitForTimeout(40);

    const state = await layoutState(page);
    expect(state.compatibility, `${path}: compatibility runtime`).toBe('ready');
    expect(state.rootWidth, `${path}: root width`).toBeGreaterThan(0);
    expect(state.rootHeight, `${path}: root height`).toBeGreaterThan(0);
    expect(state.scrollWidth, `${path}: horizontal overflow`).toBeLessThanOrEqual(state.viewportWidth + 2);

    if (path.includes('unknown-route')) {
      expect(state.bodyText).toContain('Page Not Found');
    } else {
      expect(state.bodyText).not.toContain('Page Not Found');
    }

    const blocked = await blockedInteractiveControls(page);
    expect(blocked, `${path}: controls covered by another layer`).toEqual([]);
  }
});

test('touch inputs do not trigger iOS focus zoom', async ({ page }) => {
  const hasTouch = await page.evaluate(() => navigator.maxTouchPoints > 0 || matchMedia('(pointer: coarse)').matches);
  test.skip(!hasTouch, 'Touch-only regression');
  await page.goto('/login');
  const email = page.getByLabel('Email');
  await expect(email).toBeVisible();
  await email.click();
  await expect(email).toBeFocused();
  const fontSize = await email.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
  expect(fontSize).toBeGreaterThanOrEqual(16);
});

test('mobile drawer is visible and clickable on compact widths', async ({ page }) => {
  const viewport = page.viewportSize();
  test.skip(!viewport || viewport.width > 760, 'Drawer is only used on compact widths');
  await page.goto('/app/projects');
  const menu = page.getByRole('button', { name: 'Menu' });
  await expect(menu).toBeVisible();
  await menu.click();
  const drawer = page.locator('#platform-mobile-drawer');
  await expect(drawer).toBeVisible();
  await drawer.getByRole('link', { name: 'History' }).click();
  await expect(page).toHaveURL(/\/app\/history$/);
});

test('email and password login remains clickable', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('device@example.test');
  await page.getByLabel('Password').fill('device-password-123');
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/new$/);
  await expect(page.locator('#root')).toBeVisible();
});
