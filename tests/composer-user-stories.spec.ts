import { expect, test, type Page, type Route, type TestInfo } from '@playwright/test';

const STORY_PROJECTS = new Set(['chromium-desktop', 'webkit-iphone-large']);

function json(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({
    status,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify(body),
  });
}

function completeResult() {
  return {
    sections: Array.from({ length: 8 }, (_, index) => ({
      key: `section-${index + 1}`,
      title: `判断材料 ${index + 1}`,
      body: `利用者向け検証内容 ${index + 1}`,
    })),
  };
}

async function installAccount(page: Page): Promise<void> {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/account') {
      return json(route, {
        account: {
          id: 'composer-user',
          nickname: 'Composer User',
          email: 'composer@example.test',
          account_status: 'active',
        },
      });
    }
    return json(route, { ok: true });
  });
}

async function openComposer(page: Page): Promise<void> {
  await page.goto('/app/new', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.composer textarea')).toBeVisible();
}

test.beforeEach(async ({ page }, testInfo: TestInfo) => {
  test.skip(!STORY_PROJECTS.has(testInfo.project.name), 'Composer stories use one Chromium and one WebKit touch representative.');
  await installAccount(page);
});

test('STORY-COMPOSER-001 Enter creates a line break and never submits', async ({ page }) => {
  let processRequests = 0;
  await page.route('**/process', async (route) => {
    processRequests += 1;
    return json(route, completeResult());
  });

  await openComposer(page);
  const textarea = page.locator('.composer textarea');
  await textarea.fill('1行目');
  await textarea.press('Enter');
  await textarea.type('2行目');

  await expect(textarea).toHaveValue('1行目\n2行目');
  expect(processRequests).toBe(0);
  await expect(page.locator('.turn')).toHaveCount(0);
});

test('STORY-COMPOSER-002 Ctrl+Enter submits once with request identity and eight sections', async ({ page }) => {
  let processRequests = 0;
  let idempotencyKey = '';
  let requestId = '';
  await page.route('**/process', async (route) => {
    processRequests += 1;
    const headers = route.request().headers();
    idempotencyKey = headers['idempotency-key'] ?? '';
    requestId = headers['x-request-id'] ?? '';
    return json(route, completeResult());
  });

  await openComposer(page);
  const textarea = page.locator('.composer textarea');
  await textarea.fill('ユーザー目線で検証する');
  await textarea.press('Control+Enter');

  await expect(page.locator('.result-section')).toHaveCount(8);
  await expect(textarea).toHaveValue('');
  expect(processRequests).toBe(1);
  expect(idempotencyKey.length).toBeGreaterThan(10);
  expect(requestId).toBe(idempotencyKey);
});

test('STORY-COMPOSER-003 rapid duplicate clicks create one process request', async ({ page }) => {
  let processRequests = 0;
  await page.route('**/process', async (route) => {
    processRequests += 1;
    await new Promise((resolve) => setTimeout(resolve, 150));
    return json(route, completeResult());
  });

  await openComposer(page);
  await page.locator('.composer textarea').fill('二重送信を防止する');
  await page.locator('.composer .run-button').evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });

  await expect(page.locator('.result-section')).toHaveCount(8);
  expect(processRequests).toBe(1);
  await expect(page.locator('.turn')).toHaveCount(1);
});

test('STORY-COMPOSER-004 incomplete Result fails closed and preserves input', async ({ page }) => {
  await page.route('**/process', async (route) => {
    return json(route, {
      sections: [{ key: 'only-one', title: '不足Result', body: '1項目しかありません。' }],
    });
  });

  await openComposer(page);
  const textarea = page.locator('.composer textarea');
  await textarea.fill('固定8項目が必要');
  await textarea.press('Control+Enter');

  await expect(page.locator('.error-panel')).toBeVisible();
  await expect(page.locator('.result-section')).toHaveCount(0);
  await expect(textarea).toHaveValue('固定8項目が必要');
});

test('STORY-COMPOSER-005 network failure preserves the draft and exposes an error Turn', async ({ page }) => {
  await page.route('**/process', async (route) => route.abort('connectionfailed'));

  await openComposer(page);
  const textarea = page.locator('.composer textarea');
  await textarea.fill('通信が切れても入力を残す');
  await textarea.press('Control+Enter');

  await expect(page.locator('.error-panel')).toBeVisible();
  await expect(textarea).toHaveValue('通信が切れても入力を残す');
  await expect(page.locator('.turn')).toHaveCount(1);
});

test('STORY-COMPOSER-006 empty and whitespace-only input cannot run', async ({ page }) => {
  let processRequests = 0;
  await page.route('**/process', async (route) => {
    processRequests += 1;
    return json(route, completeResult());
  });

  await openComposer(page);
  const textarea = page.locator('.composer textarea');
  const run = page.locator('.composer .run-button');
  await expect(run).toBeDisabled();
  await textarea.fill('   ');
  await expect(run).toBeDisabled();
  await textarea.press('Control+Enter');
  expect(processRequests).toBe(0);
});

test('STORY-COMPOSER-007 Fullscreen Enter remains a line break', async ({ page }) => {
  let processRequests = 0;
  await page.route('**/process', async (route) => {
    processRequests += 1;
    return json(route, completeResult());
  });

  await openComposer(page);
  await page.locator('.composer-tool').click();
  const textarea = page.locator('.fullscreen-dialog textarea');
  await expect(textarea).toBeVisible();
  await textarea.fill('全画面1行目');
  await textarea.press('Enter');
  await textarea.type('全画面2行目');

  await expect(textarea).toHaveValue('全画面1行目\n全画面2行目');
  expect(processRequests).toBe(0);
});

test('STORY-COMPOSER-008 successful user posts are collapsed into an accessible accordion', async ({ page }) => {
  await page.route('**/process', async (route) => json(route, completeResult()));

  await openComposer(page);
  await page.locator('.composer textarea').fill('長い投稿内容を結果画面で折りたたむ');
  await page.locator('.composer textarea').press('Control+Enter');

  const trigger = page.locator('.user-message-accordion-trigger');
  await expect(trigger).toBeVisible();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.user-message > p')).toContainText('長い投稿内容を結果画面で折りたたむ');
});
