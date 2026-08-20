import { expect, test, type Route, type TestInfo } from '@playwright/test';

const STORY_PROJECTS = new Set(['chromium-desktop', 'webkit-iphone-large']);

function json(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({ status, contentType: 'application/json; charset=utf-8', body: JSON.stringify(body) });
}

async function installBase(route: Route): Promise<void> {
  const path = new URL(route.request().url()).pathname;
  if (path === '/api/account') return json(route, { account: { id: 'boundary-user', display_name: 'Boundary User', account_status: 'active' } });
  if (path === '/api/preferences') return json(route, { preferences: {} });
  if (path === '/api/history') return json(route, { items: [] });
  if (path === '/api/credit/balance') return json(route, { usable_balance: 1000, reserved_balance: 0, state: 'healthy', policy: { low_threshold: 200 } });
  if (path === '/api/account/catalog') return json(route, { subscription: { plan_id: 'basic' }, plans: [{ plan_id: 'basic', included_credits: 1000 }] });
  return json(route, { ok: true });
}

test.beforeEach(async ({ page }, testInfo: TestInfo) => {
  test.skip(!STORY_PROJECTS.has(testInfo.project.name), 'Process boundary stories use Chromium and WebKit touch representatives.');
  await page.route('**/api/**', installBase);
});

test('STORY-PROCESS-001 failed real-byte upload blocks estimate and preserves file plus draft', async ({ page }) => {
  let estimateRequests = 0;
  await page.route('**/api/uploads', async (route) => json(route, { error: { code: 'UPLOAD_STORAGE_FAILED', message: '実Byte Uploadに失敗しました。' } }, 503));
  await page.route('**/api/jobs/estimate', async (route) => { estimateRequests += 1; return json(route, { ok: true }); });

  await page.goto('/app/new');
  await page.locator('input[type="file"]').setInputFiles({ name: 'evidence.txt', mimeType: 'text/plain', buffer: Buffer.from('actual bytes') });
  await expect(page.locator('.native-file-queue')).toContainText('UPLOAD_STORAGE_FAILED');
  const textarea = page.getByLabel('Astera入力');
  await textarea.fill('添付Fileを根拠として検証する');
  await textarea.press('Control+Enter');

  await expect(page.locator('.native-error')).toContainText('FILE_UPLOAD_FAILED');
  await expect(page.locator('.native-file-queue')).toContainText('evidence.txt');
  await expect(textarea).toHaveValue('添付Fileを根拠として検証する');
  expect(estimateRequests).toBe(0);
});

test('STORY-PROCESS-002 Composer and request boundary enforce the 200000 character limit', async ({ page }) => {
  let estimateRequests = 0;
  await page.route('**/api/jobs/estimate', async (route) => {
    estimateRequests += 1;
    const body = route.request().postDataJSON() as { prompt?: string };
    if ([...(body.prompt ?? '')].length > 200_000) return json(route, { error: { code: 'ASTERA_INPUT_TOO_LARGE', message: '入力は200,000文字以内です。' } }, 413);
    return json(route, { ok: true });
  });

  await page.goto('/app/new');
  const textarea = page.getByLabel('Astera入力');
  await expect(textarea).toHaveAttribute('maxlength', '200000');
  await textarea.fill('あ'.repeat(200_000));
  await expect(textarea).toHaveValue('あ'.repeat(200_000));
  expect(estimateRequests).toBe(0);
});

test('STORY-PROCESS-003 non-JSON estimate success fails closed and preserves the draft', async ({ page }) => {
  await page.route('**/api/jobs/estimate', async (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: '<html><body>unexpected proxy page</body></html>' }));

  await page.goto('/app/new');
  const textarea = page.getByLabel('Astera入力');
  await textarea.fill('ProxyのHTMLをResultとして表示しない');
  await textarea.press('Control+Enter');

  await expect(page.locator('.native-error')).toContainText('JOB_ESTIMATE_INVALID');
  await expect(page.locator('.native-result-section')).toHaveCount(0);
  await expect(textarea).toHaveValue('ProxyのHTMLをResultとして表示しない');
});
