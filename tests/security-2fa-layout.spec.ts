import { expect, test, type Page, type Route } from '@playwright/test';

type Language = 'ja' | 'en';

function json(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({ status, contentType: 'application/json; charset=utf-8', body: JSON.stringify(body) });
}

async function mockSecurityApi(page: Page, initialLanguage: Language): Promise<void> {
  let currentLanguage: Language = initialLanguage;

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;

    if (path === '/api/account') {
      await json(route, {
        account: {
          id: 'security-layout-account',
          account_status: 'active',
          display_name: 'Security Layout Test',
          nickname: 'Security Layout Test',
          email: 'security-layout@example.test',
          email_verified: true,
          ui_language: currentLanguage === 'en' ? 'en-US' : 'ja-JP',
        },
      });
      return;
    }

    if (path === '/api/preferences/display') {
      if (request.method() === 'PUT') {
        const body = request.postDataJSON() as { ui_language?: string } | null;
        currentLanguage = body?.ui_language?.toLowerCase().startsWith('en') ? 'en' : 'ja';
      }
      await json(route, { display: { ui_language: currentLanguage === 'en' ? 'en-US' : 'ja-JP' } });
      return;
    }

    if (path === '/api/account/security') {
      await json(route, {
        security: {
          email: 'security-layout@example.test',
          email_verified: true,
          password_configured: true,
          passkey_enabled: true,
          passkey_count: 1,
          passkeys: [{
            id: 'passkey-1',
            name: 'Layout Test Passkey',
            device_type: 'multiDevice',
            backed_up: true,
            transports: '["internal"]',
            created_at: '2026-09-16T12:00:00.000Z',
            aaguid: '',
          }],
          two_factor_enabled: false,
          session_count: 2,
          sessions: [
            { id: 'session-current', current: true, updated_at: '2026-09-16T12:00:00.000Z', expires_at: '2026-09-23T12:00:00.000Z', user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/152.0.0.0' },
            { id: 'session-other', current: false, updated_at: '2026-09-16T11:00:00.000Z', expires_at: '2026-09-23T11:00:00.000Z', user_agent: 'Mozilla/5.0 (Linux; Android 16) Chrome/152.0.0.0' },
          ],
        },
      });
      return;
    }

    if (path === '/api/credit/balance') {
      await json(route, { usable_balance: 1000, reserved_balance: 0, state: 'healthy', policy: { low_threshold: 100 } });
      return;
    }

    if (path === '/api/account/catalog') {
      await json(route, { subscription: { plan_id: 'basic' }, plans: [{ plan_id: 'basic', included_credits: 1000 }] });
      return;
    }

    if (path === '/api/history') {
      await json(route, { items: [] });
      return;
    }

    if (path === '/api/auth/two-factor/enable') {
      await json(route, {
        totpURI: 'otpauth://totp/Astera:security-layout@example.test?secret=JBSWY3DPEHPK3PXP&issuer=Astera',
        backupCodes: ['LAYOUT-ONE', 'LAYOUT-TWO'],
      });
      return;
    }

    if (path.startsWith('/api/auth/two-factor/')) {
      await json(route, { ok: true });
      return;
    }

    await json(route, { ok: true });
  });
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const state = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
  }));
  expect(state.scrollWidth).toBeLessThanOrEqual(state.clientWidth + 2);
}

async function gridColumnCount(page: Page, selector: string): Promise<number> {
  return page.locator(selector).evaluate((node) => {
    const value = getComputedStyle(node).gridTemplateColumns.trim();
    return value ? value.split(/\s+/).length : 0;
  });
}

async function expectCompactPill(page: Page, selector: string): Promise<void> {
  const style = await page.locator(selector).first().evaluate((node) => {
    const computed = getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return { fontSize: Number.parseFloat(computed.fontSize), borderRadius: Number.parseFloat(computed.borderRadius), height: rect.height };
  });
  expect(style.fontSize).toBeLessThanOrEqual(12.5);
  expect(style.borderRadius).toBeGreaterThan(15);
  expect(style.height).toBeLessThanOrEqual(36);
}

test('Security 2FA is optional and responsive', async ({ page }) => {
  await mockSecurityApi(page, 'ja');
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  const width = viewport?.width ?? 0;

  await page.goto('/account/security', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'セキュリティ', level: 1 })).toBeVisible();
  await expect(page.locator('.platform-page-head .platform-eyebrow')).toBeHidden();
  await expect(page.locator('.platform-page-head p')).toHaveCount(0);
  await expectCompactPill(page, '.platform-page-head h1');
  await expectCompactPill(page, '.security-card-head h2');

  const toggle = page.getByRole('checkbox', { name: '2段階認証を使用' });
  await expect(toggle).not.toBeChecked();
  await expect(page.locator('.security-method-list')).toHaveCount(0);

  await toggle.check();
  await expect(toggle).toBeChecked();
  await expect(page.locator('.security-method-list')).toBeVisible();
  expect(await gridColumnCount(page, '.security-method-list')).toBe(width > 1100 ? 2 : 1);
  await expect(page.getByText('メール', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('認証アプリ', { exact: true }).first()).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.getByLabel('現在のPassword').fill('device-password-123');
  await page.getByRole('button', { name: '2FA設定を開始' }).click();
  await expect(page.locator('.security-qr-frame img')).toBeVisible();
  expect(await gridColumnCount(page, '.security-enrollment')).toBe(width > 1100 ? 2 : 1);
  await expectNoHorizontalOverflow(page);

  if (width <= 760) {
    const box = await toggle.locator('..').boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(48);
  }
});

test('Management heading and Security follow Japanese-English switch', async ({ page }) => {
  await mockSecurityApi(page, 'ja');

  await page.goto('/app/settings/language', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: '言語', level: 1 })).toBeVisible();
  await expectCompactPill(page, '.platform-page-head h1');
  await page.getByLabel('表示言語').selectOption('en');
  await page.getByRole('button', { name: '保存' }).click();
  await expect(page.getByRole('heading', { name: 'Language', level: 1 })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');

  await page.goto('/account/security', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Security', level: 1 })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Use two-factor authentication' })).not.toBeChecked();
  await expect(page.locator('.security-method-list')).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expectNoHorizontalOverflow(page);

  const toggle = page.getByRole('checkbox', { name: 'Use two-factor authentication' });
  await toggle.check();
  await expect(page.getByText('Email', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Authenticator app', { exact: true }).first()).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
