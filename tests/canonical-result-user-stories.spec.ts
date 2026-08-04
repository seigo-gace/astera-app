import { expect, test, type Route, type TestInfo } from '@playwright/test';

const STORY_PROJECTS = new Set(['chromium-desktop', 'webkit-iphone-large']);
const CANONICAL_KEYS = [
  'true_purpose',
  'missing_assumptions',
  'fact_check',
  'risk_detection',
  'counter_view',
  'alternatives',
  'recommendation',
  'next_prompt',
] as const;

function json(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({
    status,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify(body),
  });
}

test.beforeEach(async ({ page }, testInfo: TestInfo) => {
  test.skip(!STORY_PROJECTS.has(testInfo.project.name), 'Canonical Result story uses Chromium and WebKit touch representatives.');
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/account') {
      return json(route, {
        account: {
          id: 'canonical-user',
          nickname: 'Canonical User',
          account_status: 'active',
        },
      });
    }
    return json(route, { ok: true });
  });
});

test('STORY-RESULT-001 canonical eight-key section objects are rendered in fixed order', async ({ page }) => {
  await page.route('**/process', async (route) => {
    const sections = Object.fromEntries(CANONICAL_KEYS.map((key, index) => [
      key,
      {
        key,
        title: `正規項目 ${index + 1}`,
        content: `正規Result本文 ${index + 1}`,
        sourceIds: [],
      },
    ]));
    return json(route, {
      schemaVersion: '1.0.0',
      runtimeVersion: 'story',
      purposeVersion: 'story',
      jobId: 'job-canonical-story',
      completionState: 'complete',
      sections,
      sources: [],
      warnings: [],
      generatedAt: new Date().toISOString(),
    });
  });

  await page.goto('/app/new');
  const textarea = page.locator('.composer textarea');
  await textarea.fill('正規Contractの8項目Objectを表示する');
  await textarea.press('Control+Enter');

  const rendered = page.locator('.result-section');
  await expect(rendered).toHaveCount(8);
  for (let index = 0; index < CANONICAL_KEYS.length; index += 1) {
    await expect(rendered.nth(index)).toContainText(`正規項目 ${index + 1}`);
    await expect(rendered.nth(index)).toContainText(`正規Result本文 ${index + 1}`);
  }
});
