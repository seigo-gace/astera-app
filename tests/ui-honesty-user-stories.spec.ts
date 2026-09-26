import { expect, test, type Route, type TestInfo } from '@playwright/test';

const STORY_PROJECTS = new Set(['chromium-desktop', 'webkit-iphone-large']);

function json(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({
    status,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify(body),
  });
}

async function installCurrentComposerApi(route: Route): Promise<void> {
  const path = new URL(route.request().url()).pathname;
  if (path === '/api/account') return json(route, { account: { id: 'honesty-user', display_name: 'Honesty User', account_status: 'active' } });
  if (path === '/api/preferences') return json(route, { preferences: { translation: true, agent_mode: true, document: true, storage_transfer: true } });
  if (path === '/api/history') return json(route, { items: [] });
  if (path === '/api/credit/balance') return json(route, { usable_balance: 1000, reserved_balance: 0, state: 'healthy', policy: { low_threshold: 200 } });
  if (path === '/api/account/catalog') return json(route, { subscription: { plan_id: 'basic' }, plans: [{ plan_id: 'basic', included_credits: 1000 }] });
  if (path === '/api/projects') return json(route, { projects: [{ project_id: 'project-a', name: 'Project A' }, { project_id: 'project-b', name: 'Project B' }] });
  if (path === '/api/templates') return json(route, { templates: [] });
  if (path === '/api/storage/destinations') return json(route, { destinations: [] });
  return json(route, { ok: true });
}

test.beforeEach(async ({ page }, testInfo: TestInfo) => {
  test.skip(!STORY_PROJECTS.has(testInfo.project.name), 'UI honesty stories use Chromium and WebKit touch representatives.');
  await page.route('**/api/**', installCurrentComposerApi);
  await page.goto('/app/new', { waitUntil: 'domcontentloaded' });
  await expect(page.getByLabel('Astera入力')).toBeVisible();
});

async function openAddPicker(page: import('@playwright/test').Page) {
  await page.getByLabel('Fileと実行Optionを追加').click();
  const dialog = page.getByRole('dialog', { name: '追加' });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function openContextPicker(page: import('@playwright/test').Page) {
  const input = page.getByLabel('Astera入力');
  await input.focus();
  await input.press('@');
  const dialog = page.getByRole('dialog', { name: 'Option・対象選択' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test('STORY-UI-001 Purpose selection remains single after changing the current native Composer purpose', async ({ page }) => {
  let dialog = await openAddPicker(page);
  await dialog.getByText('用途・目的', { exact: true }).click();
  await dialog.getByRole('button', { name: 'レビュー', exact: true }).click();
  await dialog.getByLabel('閉じる').click();
  await expect(page.locator('.native-form-chip.is-purpose')).toHaveText(/レビュー/);

  dialog = await openAddPicker(page);
  await dialog.getByText('用途・目的', { exact: true }).click();
  await dialog.getByRole('button', { name: '比較', exact: true }).click();
  await dialog.getByLabel('閉じる').click();

  const purposeChips = page.locator('.native-form-chip.is-purpose');
  await expect(purposeChips).toHaveCount(1);
  await expect(purposeChips).toHaveText(/比較/);
  await expect(purposeChips).not.toContainText('レビュー');
});

test('STORY-UI-002 current Composer Project context exposes registered Projects instead of a disabled legacy placeholder', async ({ page }) => {
  let dialog = await openContextPicker(page);
  const projectSelect = dialog.locator('label.native-picker-field').filter({ hasText: 'Project' }).locator('select');
  await expect(projectSelect.locator('option')).toHaveCount(3);
  await expect(projectSelect.locator('option').nth(0)).toHaveText('Projectなし');
  await expect(projectSelect.locator('option').nth(1)).toHaveText('Project A');
  await expect(projectSelect.locator('option').nth(2)).toHaveText('Project B');
  await projectSelect.selectOption('project-b');
  await dialog.getByRole('button', { name: '完了', exact: true }).click();

  dialog = await openContextPicker(page);
  const selectedProject = dialog.locator('label.native-picker-field').filter({ hasText: 'Project' }).locator('select');
  await expect(selectedProject).toHaveValue('project-b');
});

test('STORY-UI-003 current Composer context links to the saved external Storage Settings page', async ({ page }) => {
  const dialog = await openContextPicker(page);
  await expect(dialog.getByRole('link', { name: '外部Storage設定を開く' })).toHaveAttribute('href', '/app/settings/storage-destinations');
});
