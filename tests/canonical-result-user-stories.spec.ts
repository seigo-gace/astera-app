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
  return route.fulfill({ status, contentType: 'application/json; charset=utf-8', body: JSON.stringify(body) });
}

test.beforeEach(async ({ page }, testInfo: TestInfo) => {
  test.skip(!STORY_PROJECTS.has(testInfo.project.name), 'Canonical Result story uses Chromium and WebKit touch representatives.');
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/account') return json(route, { account: { id: 'canonical-user', display_name: 'Canonical User', account_status: 'active' } });
    if (path === '/api/preferences') return json(route, { preferences: {} });
    if (path === '/api/history') return json(route, { items: [] });
    if (path === '/api/credit/balance') return json(route, { usable_balance: 1000, reserved_balance: 0, state: 'healthy', policy: { low_threshold: 200 } });
    if (path === '/api/account/catalog') return json(route, { subscription: { plan_id: 'basic' }, plans: [{ plan_id: 'basic', included_credits: 1000 }] });
    if (path === '/api/jobs/estimate') return json(route, { estimate: { estimate_id: 'estimate-result', required_credits: 10, available_credits: 1000, reserved_credits: 0, credit_state: 'normal', expires_at: new Date(Date.now() + 60_000).toISOString() } }, 201);
    if (path === '/api/jobs') {
      const sections = Object.fromEntries(CANONICAL_KEYS.map((key, index) => [key, { key, title: `正規項目 ${index + 1}`, content: `正規Result本文 ${index + 1}`, sourceIds: [] }]));
      return json(route, { job: { job_id: 'job-canonical-story', state: 'completed', result: { sections } } }, 201);
    }
    return json(route, { ok: true });
  });
});

test('STORY-RESULT-001 canonical eight-key section objects are rendered in fixed order', async ({ page }) => {
  await page.goto('/app/new');
  const textarea = page.getByLabel('Astera入力');
  await textarea.fill('正規Contractの8項目Objectを表示する');
  await textarea.press('Control+Enter');
  await page.getByRole('button', { name: 'Creditを予約して実行' }).click();

  const rendered = page.locator('.native-result-section');
  await expect(rendered).toHaveCount(8);
  for (let index = 0; index < CANONICAL_KEYS.length; index += 1) {
    await expect(rendered.nth(index)).toContainText(`正規項目 ${index + 1}`);
    await expect(rendered.nth(index)).toContainText(`正規Result本文 ${index + 1}`);
  }
});
