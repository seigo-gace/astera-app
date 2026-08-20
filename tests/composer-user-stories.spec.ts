import { expect, test, type Page, type Route, type TestInfo } from '@playwright/test';

const STORY_PROJECTS = new Set(['chromium-desktop', 'webkit-iphone-large']);
const RESULT_KEYS = ['true_purpose','missing_assumptions','fact_check','risk_detection','counter_view','alternatives','recommendation','next_prompt'] as const;

function json(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({ status, contentType: 'application/json; charset=utf-8', body: JSON.stringify(body) });
}

function completeSections() {
  return RESULT_KEYS.map((key, index) => ({ key, title: `判断材料 ${index + 1}`, body: `利用者向け検証内容 ${index + 1}`, source_ids: [] }));
}

function estimatePayload() {
  return {
    estimate: {
      estimate_id: 'estimate-story',
      required_credits: 12,
      available_credits: 1000,
      reserved_credits: 0,
      credit_state: 'normal',
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      billing_mode: 'full',
      billable_characters: 20,
    },
  };
}

type MockOptions = {
  estimateDelay?: number;
  estimateFailure?: boolean;
  incompleteResult?: boolean;
  counters?: { estimates: number; jobs: number };
};

async function installRuntime(page: Page, options: MockOptions = {}): Promise<void> {
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/account') return json(route, { account: { id: 'composer-user', display_name: 'Composer User', account_status: 'active' } });
    if (path === '/api/preferences') return json(route, { preferences: { translation: true, agent_mode: true, document: true, storage_transfer: true } });
    if (path === '/api/history') return json(route, { items: [] });
    if (path === '/api/credit/balance') return json(route, { usable_balance: 1000, reserved_balance: 0, state: 'healthy', policy: { low_threshold: 200 } });
    if (path === '/api/account/catalog') return json(route, { subscription: { plan_id: 'basic' }, plans: [{ plan_id: 'basic', included_credits: 1000 }] });
    if (path === '/api/projects') return json(route, { projects: [{ id: 'project-1', name: 'Project One' }] });
    if (path === '/api/templates') return json(route, { templates: [{ id: 'template-1', title: 'Personal Template', template_source: 'personal' }] });
    if (path === '/api/storage/destinations') return json(route, { destinations: [{ id: 'storage-1', display_name: 'Google Drive', status: 'connected' }] });
    if (path === '/api/jobs/estimate') {
      if (options.counters) options.counters.estimates += 1;
      if (options.estimateDelay) await new Promise((resolve) => setTimeout(resolve, options.estimateDelay));
      if (options.estimateFailure) return route.abort('connectionfailed');
      return json(route, estimatePayload(), 201);
    }
    if (path === '/api/jobs') {
      if (options.counters) options.counters.jobs += 1;
      return json(route, {
        job: {
          job_id: 'job-story',
          state: 'completed',
          result: { sections: options.incompleteResult ? [{ key: 'true_purpose', title: '不足', body: '1項目だけ' }] : completeSections() },
        },
      }, 201);
    }
    return json(route, { ok: true });
  });
}

async function openComposer(page: Page): Promise<void> {
  await page.goto('/app/new', { waitUntil: 'domcontentloaded' });
  await expect(page.getByLabel('Astera入力')).toBeVisible();
}

async function executeConfirmed(page: Page): Promise<void> {
  await expect(page.getByRole('dialog', { name: '実行前確認' })).toBeVisible();
  await page.getByRole('button', { name: 'Creditを予約して実行' }).click();
}

test.beforeEach(async ({}, testInfo: TestInfo) => {
  test.skip(!STORY_PROJECTS.has(testInfo.project.name), 'Composer stories use one Chromium and one WebKit touch representative.');
});

test('STORY-COMPOSER-001 Enter creates a line break and never estimates', async ({ page }) => {
  const counters = { estimates: 0, jobs: 0 };
  await installRuntime(page, { counters });
  await openComposer(page);
  const textarea = page.getByLabel('Astera入力');
  await textarea.fill('1行目');
  await textarea.press('Enter');
  await textarea.type('2行目');
  await expect(textarea).toHaveValue('1行目\n2行目');
  expect(counters.estimates).toBe(0);
  expect(counters.jobs).toBe(0);
});

test('STORY-COMPOSER-002 Ctrl+Enter estimates, confirms, then creates one job with eight sections', async ({ page }) => {
  const counters = { estimates: 0, jobs: 0 };
  await installRuntime(page, { counters });
  await openComposer(page);
  await page.getByLabel('Astera入力').fill('ユーザー目線で検証する');
  await page.getByLabel('Astera入力').press('Control+Enter');
  expect(counters.estimates).toBe(1);
  expect(counters.jobs).toBe(0);
  await executeConfirmed(page);
  await expect(page.locator('.native-result-section')).toHaveCount(8);
  expect(counters.jobs).toBe(1);
});

test('STORY-COMPOSER-003 rapid duplicate run clicks create one estimate', async ({ page }) => {
  const counters = { estimates: 0, jobs: 0 };
  await installRuntime(page, { counters, estimateDelay: 180 });
  await openComposer(page);
  await page.getByLabel('Astera入力').fill('二重送信を防止する');
  await page.getByLabel('予定Creditを確認').evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect(page.getByRole('dialog', { name: '実行前確認' })).toBeVisible();
  expect(counters.estimates).toBe(1);
  expect(counters.jobs).toBe(0);
});

test('STORY-COMPOSER-004 incomplete Result fails closed and preserves input', async ({ page }) => {
  await installRuntime(page, { incompleteResult: true });
  await openComposer(page);
  const textarea = page.getByLabel('Astera入力');
  await textarea.fill('固定8項目が必要');
  await textarea.press('Control+Enter');
  await executeConfirmed(page);
  await expect(page.locator('.native-error')).toContainText('ASTERA_RESPONSE_SECTIONS_INCOMPLETE');
  await expect(page.locator('.native-result-section')).toHaveCount(0);
  await expect(textarea).toHaveValue('固定8項目が必要');
});

test('STORY-COMPOSER-005 estimate network failure preserves the draft', async ({ page }) => {
  await installRuntime(page, { estimateFailure: true });
  await openComposer(page);
  const textarea = page.getByLabel('Astera入力');
  await textarea.fill('通信が切れても入力を残す');
  await textarea.press('Control+Enter');
  await expect(page.locator('.native-error')).toBeVisible();
  await expect(textarea).toHaveValue('通信が切れても入力を残す');
});

test('STORY-COMPOSER-006 empty and whitespace-only input cannot run', async ({ page }) => {
  const counters = { estimates: 0, jobs: 0 };
  await installRuntime(page, { counters });
  await openComposer(page);
  const textarea = page.getByLabel('Astera入力');
  const run = page.getByLabel('予定Creditを確認');
  await expect(run).toBeDisabled();
  await textarea.fill('   ');
  await expect(run).toBeDisabled();
  await textarea.press('Control+Enter');
  expect(counters.estimates).toBe(0);
});

test('STORY-COMPOSER-007 Fullscreen Enter remains a line break', async ({ page }) => {
  const counters = { estimates: 0, jobs: 0 };
  await installRuntime(page, { counters });
  await openComposer(page);
  await page.getByRole('button', { name: '全画面' }).click();
  const textarea = page.getByRole('dialog', { name: '全画面入力' }).locator('textarea');
  await textarea.fill('全画面1行目');
  await textarea.press('Enter');
  await textarea.type('全画面2行目');
  await expect(textarea).toHaveValue('全画面1行目\n全画面2行目');
  expect(counters.estimates).toBe(0);
});

test('STORY-COMPOSER-008 successful user posts are collapsed into an accessible accordion', async ({ page }) => {
  await installRuntime(page);
  await openComposer(page);
  await page.getByLabel('Astera入力').fill('長い投稿内容を結果画面で折りたたむ');
  await page.getByLabel('Astera入力').press('Control+Enter');
  await executeConfirmed(page);
  const trigger = page.locator('.native-user-message-trigger');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.native-user-message > p')).toContainText('長い投稿内容を結果画面で折りたたむ');
});
