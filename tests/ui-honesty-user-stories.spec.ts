import { expect, test, type Route, type TestInfo } from '@playwright/test';

const STORY_PROJECTS = new Set(['chromium-desktop', 'webkit-iphone-large']);

function json(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({
    status,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify(body),
  });
}

test.beforeEach(async ({ page }, testInfo: TestInfo) => {
  test.skip(!STORY_PROJECTS.has(testInfo.project.name), 'UI honesty stories use Chromium and WebKit touch representatives.');
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/account') {
      return json(route, {
        account: {
          id: 'honesty-user',
          nickname: 'Honesty User',
          account_status: 'active',
        },
      });
    }
    return json(route, { ok: true });
  });
  await page.goto('/app/new');
});

async function openComposerMenu(page: import('@playwright/test').Page) {
  await page.locator('.composer-plus').click();
  await expect(page.locator('.composer-menu')).toBeVisible();
  return page.locator('.composer-menu .menu-item');
}

test('STORY-UI-001 Purpose selection remains single even after choosing another option', async ({ page }) => {
  const menuItems = await openComposerMenu(page);
  await menuItems.nth(1).click();

  const options = page.locator('.dialog-content .option-grid:not(.paid-option-grid) .option-card');
  await expect(options).toHaveCount(8);
  await options.nth(0).click();
  await options.nth(1).click();

  await expect(options.filter({ has: page.locator('.selected-mark') })).toHaveCount(1);
  await expect(options.nth(0)).not.toHaveClass(/is-selected/);
  await expect(options.nth(1)).toHaveClass(/is-selected/);
});

test('STORY-UI-002 unavailable Project Source controls are disabled instead of silently doing nothing', async ({ page }) => {
  const menuItems = await openComposerMenu(page);
  await menuItems.nth(2).click();

  const dialog = page.locator('.dialog-content[data-project-source-unavailable="true"]');
  await expect(dialog).toBeVisible();
  const sourceButtons = dialog.locator('.template-card');
  await expect(sourceButtons).toHaveCount(3);
  for (let index = 0; index < 3; index += 1) await expect(sourceButtons.nth(index)).toBeDisabled();
  await expect(dialog.locator('.dialog-notice')).toContainText('未実装');
});

test('STORY-UI-003 legacy Settings clearly identifies session-only changes and links to the saved Settings Page', async ({ page }) => {
  const settingsTrigger = page.getByText(/^(設定|Settings)$/).last();
  await settingsTrigger.click();

  const dialog = page.locator('.dialog-content[data-session-settings-notice="true"]');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.dialog-notice')).toContainText('現在の表示Sessionだけ');
  await expect(dialog.getByRole('link', { name: 'Settings Pageを開く' })).toHaveAttribute('href', '/app/settings');
});
