import { expect, test } from '@playwright/test';

const LIVE_JOB_PROMPT = 'A案とB案を比較したい。最終結論は出さず判断材料だけ欲しい。';

test('LIVE-E2E-MAIN8: App UI job reaches Process Main8 via App API (no /api/jobs mock)', async ({ page }) => {
  const jobPosts: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/jobs' && request.method() === 'POST') jobPosts.push(request.url());
  });

  await page.goto('/app/new');
  const textarea = page.getByLabel('Astera入力');
  await expect(textarea).toBeVisible();
  await textarea.fill(LIVE_JOB_PROMPT);
  await textarea.press('Control+Enter');

  const reserveButton = page.getByRole('button', { name: 'Creditを予約して実行' });
  await expect(reserveButton).toBeVisible({ timeout: 15_000 });
  await reserveButton.click();

  await expect.poll(() => jobPosts.length, { timeout: 5_000 }).toBeGreaterThan(0);

  const resultSurface = page.locator('.native-result-section, [data-testid="job-result"], .job-result');
  await expect(resultSurface.first()).toBeVisible({ timeout: 120_000 });
  const bodyText = await page.locator('body').innerText();
  expect(bodyText).toMatch(/01 本当の目的|01 True Objective/);
  expect(bodyText).toMatch(/07 根拠成立状態|07 Evidence Status/);
  expect(bodyText).not.toMatch(/外部Evidence検索: 不要（NOT_REQUIRED）/);
});
