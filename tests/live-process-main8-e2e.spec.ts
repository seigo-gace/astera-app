import { expect, test } from '@playwright/test';

/** REAL_MCP gate case B — domain claim + search plan expected */
const LIVE_JOB_PROMPT =
  '新方式は従来より20%速いと言われている。事実確認も含め判断材料だけ欲しい。';

const MAIN8_CANONICAL_KEYS = [
  'true_purpose',
  'missing_assumptions',
  'fact_check',
  'risk_detection',
  'counter_view',
  'alternatives',
  'recommendation',
  'next_prompt',
] as const;

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

  await expect(page.locator('.native-result-section').first()).toBeVisible({ timeout: 240_000 });
  await expect(page.locator('.native-result-section')).toHaveCount(8);
  const bodyText = await page.locator('body').innerText();
  for (const key of MAIN8_CANONICAL_KEYS) {
    expect(bodyText).toMatch(new RegExp(key.replace(/_/g, '[_\\s]?')));
  }
  expect(bodyText).toMatch(/01[\s\S]{0,120}true_purpose/);
  expect(bodyText).toMatch(/07[\s\S]{0,120}recommendation/);
  expect(bodyText).toMatch(/MAIN8-07-EVIDENCE-STATUS-SEPARATION/);
});
