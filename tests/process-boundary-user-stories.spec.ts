import { expect, test, type Route, type TestInfo } from '@playwright/test';

const STORY_PROJECTS = new Set(['chromium-desktop', 'webkit-iphone-large']);

function json(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({
    status,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify(body),
  });
}

async function installAccount(route: Route): Promise<void> {
  const path = new URL(route.request().url()).pathname;
  if (path === '/api/account') {
    return json(route, {
      account: {
        id: 'boundary-user',
        nickname: 'Boundary User',
        account_status: 'active',
      },
    });
  }
  return json(route, { ok: true });
}

test.beforeEach(async ({ page }, testInfo: TestInfo) => {
  test.skip(!STORY_PROJECTS.has(testInfo.project.name), 'Process boundary stories use Chromium and WebKit touch representatives.');
  await page.route('**/api/**', installAccount);
});

test('STORY-PROCESS-001 unresolved local file metadata fails closed before backend execution', async ({ page }) => {
  let processRequests = 0;
  await page.route('**/process', async (route) => {
    processRequests += 1;
    return json(route, { ok: true });
  });

  await page.goto('/app/new');
  await page.locator('input[type="file"]').setInputFiles({
    name: 'evidence.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('actual file bytes that are not uploaded by the current app'),
  });
  await page.locator('.composer textarea').fill('添付Fileを根拠として検証する');
  await page.locator('.composer textarea').press('Control+Enter');

  await expect(page.locator('.error-panel')).toContainText('添付Fileの実DataがUploadされていない');
  await expect(page.locator('.error-panel')).toContainText('FILE_UPLOAD_PIPELINE_NOT_CONNECTED');
  await expect(page.locator('.selection-chip')).toContainText('evidence.txt');
  await expect(page.locator('.composer textarea')).toHaveValue('添付Fileを根拠として検証する');
  expect(processRequests).toBe(0);
});

test('STORY-PROCESS-002 Composer and request boundary enforce the 200000 character limit', async ({ page }) => {
  let processRequests = 0;
  await page.route('**/process', async (route) => {
    processRequests += 1;
    return json(route, { ok: true });
  });

  await page.goto('/app/new');
  const textarea = page.locator('.composer textarea');
  await expect(textarea).toHaveAttribute('maxlength', '200000');

  const result = await page.evaluate(async () => {
    try {
      await fetch('/process', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input: 'あ'.repeat(200_001), purposes: [], paid_options: [], files: [], template: null }),
      });
      return { message: '' };
    } catch (error) {
      return { message: error instanceof Error ? error.message : String(error) };
    }
  });

  expect(result.message).toContain('200,000文字以内');
  expect(result.message).toContain('ASTERA_INPUT_TOO_LARGE');
  expect(processRequests).toBe(0);
});

test('STORY-PROCESS-003 non-JSON success responses fail closed and preserve the draft', async ({ page }) => {
  await page.route('**/process', async (route) => {
    return route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: '<html><body>unexpected proxy page</body></html>',
    });
  });

  await page.goto('/app/new');
  const textarea = page.locator('.composer textarea');
  await textarea.fill('ProxyのHTMLをResultとして表示しない');
  await textarea.press('Control+Enter');

  await expect(page.locator('.error-panel')).toContainText('AsteraのResult形式を確認できませんでした。');
  await expect(page.locator('.error-panel')).toContainText('ASTERA_RESPONSE_JSON_REQUIRED');
  await expect(page.locator('.result-section')).toHaveCount(0);
  await expect(textarea).toHaveValue('ProxyのHTMLをResultとして表示しない');
});
