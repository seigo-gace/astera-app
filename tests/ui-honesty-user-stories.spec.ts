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
    if (path === '/api/projects') return json(route, { projects: [] });
    if (path === '/api/storage/destinations') return json(route, { destinations: [] });
    return json(route, { ok: true });
  });
  await page.goto('/app/new');
});

test('STORY-UI-001 Purpose selection remains single even after choosing another option', async ({ page }) => {
  const purposeButton = page.getByRole('button', { name: 'Purposeを選択' });
  await purposeButton.click();
  let dialog = page.getByRole('dialog', { name: '用途・目的' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.native-purpose-list button.is-selected')).toHaveCount(1);
  await expect(dialog.getByRole('button', { name: /Auto/ })).toHaveClass(/is-selected/);

  await dialog.getByRole('button', { name: /レビュー/ }).click();
  await expect(purposeButton).toContainText('レビュー');

  await purposeButton.click();
  dialog = page.getByRole('dialog', { name: '用途・目的' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.native-purpose-list button.is-selected')).toHaveCount(1);
  await expect(dialog.getByRole('button', { name: /Auto/ })).not.toHaveClass(/is-selected/);
  await expect(dialog.getByRole('button', { name: /レビュー/ })).toHaveClass(/is-selected/);

  await dialog.getByRole('button', { name: /比較/ }).click();
  await expect(purposeButton).toContainText('比較');
  await purposeButton.click();
  dialog = page.getByRole('dialog', { name: '用途・目的' });
  await expect(dialog.locator('.native-purpose-list button.is-selected')).toHaveCount(1);
  await expect(dialog.getByRole('button', { name: /比較/ })).toHaveClass(/is-selected/);
});

test('STORY-UI-002 Project context exposes explicit no-Project state and never fabricates unavailable projects', async ({ page }) => {
  const composer = page.getByRole('textbox', { name: 'Astera入力' });
  await composer.focus();
  await composer.press('@');

  const dialog = page.getByRole('dialog', { name: 'Option・対象選択' });
  await expect(dialog).toBeVisible();
  const project = dialog.getByLabel('Project');
  await expect(project).toBeVisible();
  await expect(project.locator('option')).toHaveCount(1);
  await expect(project.locator('option')).toHaveText(['Projectなし']);
  await expect(project).toHaveValue('');
});

test('STORY-UI-003 Settings opens the canonical settings surface instead of legacy session-only controls', async ({ page }) => {
  const settingsTrigger = page.getByText(/^(設定|Settings)$/).last();
  await settingsTrigger.click();

  const dialog = page.getByRole('dialog', { name: /^(設定|Settings)$/ });
  await expect(dialog).toBeVisible();
  const surface = dialog.locator('.settings-surface');
  await expect(surface).toBeVisible();
  await expect(surface.locator('a[href="/account"]')).toHaveCount(1);
  await expect(surface.locator('a[href="/app/settings/language"]')).toHaveCount(1);
  await expect(surface.locator('a[href="/app/settings/notifications"]')).toHaveCount(1);
  await expect(surface.locator('a[href="/app/settings/data-privacy"]')).toHaveCount(1);
  await expect(surface.locator('a[href="/app/settings/legal-support"]')).toHaveCount(1);
});
