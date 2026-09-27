import { expect, test, type Page, type Route, type TestInfo } from '@playwright/test';

const STORY_PROJECTS = new Set(['chromium-desktop', 'webkit-iphone-large']);
const RESULT_KEYS = ['true_purpose','missing_assumptions','fact_check','risk_detection','counter_view','alternatives','recommendation','next_prompt'] as const;

type Captured = {
  estimates: Array<Record<string, unknown>>;
  jobs: Array<Record<string, unknown>>;
  conversations: Array<Record<string, unknown>>;
};

function json(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({ status, contentType: 'application/json; charset=utf-8', body: JSON.stringify(body) });
}
function result(jobNumber = 1) {
  return {
    sections: RESULT_KEYS.map((key, index) => ({ key, title: `判断材料 ${index + 1}`, body: `回答${jobNumber}-${index + 1}`, source_ids: [`source-${index + 1}`] })),
    sources: RESULT_KEYS.map((_, index) => ({ id: `source-${index + 1}`, title: `根拠 ${index + 1}`, url: `https://example.com/${index + 1}`, status: 'verified' })),
  };
}

async function installRuntime(page: Page, captured: Captured, conversationDetail?: Record<string, unknown>) {
  let jobNumber = 0;
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          (window as typeof window & { __copiedText?: string }).__copiedText = value;
        },
      },
    });
  });
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/account') return json(route, { account: { id: 'custom-purpose-user', account_status: 'active' } });
    if (path === '/api/preferences') return json(route, { preferences: { translation: true, agent_mode: true, storage_transfer: true } });
    if (path === '/api/history') return json(route, { items: [] });
    if (path === '/api/conversations' && request.method() === 'GET') return json(route, { conversations: [] });
    if (path === '/api/conversations' && request.method() === 'POST') {
      const body = request.postDataJSON() as Record<string, unknown>;
      captured.conversations.push(body);
      return json(route, { conversation_id: 'conversation-custom', turn_id: body.client_turn_id }, 201);
    }
    if (path.startsWith('/api/conversations/') && request.method() === 'GET') {
      return json(route, conversationDetail ?? { conversation: { id: 'conversation-custom', turns: [] } });
    }
    if (path === '/api/credit/balance') return json(route, { usable_balance: 1000, reserved_balance: 0, state: 'healthy', policy: { low_threshold: 200 } });
    if (path === '/api/account/catalog') return json(route, { subscription: { plan_id: 'basic' }, plans: [{ plan_id: 'basic', included_credits: 1000 }] });
    if (path === '/api/projects') return json(route, { projects: [] });
    if (path === '/api/storage/destinations') return json(route, { destinations: [] });
    if (path === '/api/jobs/estimate') {
      const body = request.postDataJSON() as Record<string, unknown>;
      captured.estimates.push(body);
      return json(route, { estimate: { estimate_id: `estimate-${captured.estimates.length}`, required_credits: 1, available_credits: 1000, expires_at: new Date(Date.now() + 60_000).toISOString() } }, 201);
    }
    if (path === '/api/jobs') {
      const body = request.postDataJSON() as Record<string, unknown>;
      captured.jobs.push(body);
      jobNumber += 1;
      return json(route, { job: { job_id: `job-custom-${jobNumber}`, state: 'completed', result: result(jobNumber) } }, 201);
    }
    return json(route, { ok: true });
  });
}

async function openComposer(page: Page, path = '/app/new') {
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await expect(page.getByLabel('Astera入力')).toBeVisible();
}

async function setPrivateOff(page: Page) {
  await page.getByLabel('Fileと実行Optionを追加').click();
  const dialog = page.getByRole('dialog', { name: '追加' });
  const privateButton = dialog.getByRole('button', { name: /Private Mode/ });
  if (await privateButton.getAttribute('aria-pressed') === 'true') await privateButton.click();
  await dialog.getByLabel('閉じる').click();
}

async function setCustomPurpose(page: Page, value: string) {
  await page.getByLabel('Purposeを選択').click();
  await page.getByRole('dialog', { name: '用途・目的' }).getByRole('button', { name: '目的を自由入力' }).click();
  const dialog = page.getByRole('dialog', { name: '目的を自由入力' });
  await dialog.getByLabel('自由目的').fill(value);
  await dialog.getByRole('button', { name: '適用' }).click();
}

test.beforeEach(async ({}, testInfo: TestInfo) => {
  test.skip(!STORY_PROJECTS.has(testInfo.project.name), 'Custom purpose stories use Chromium and WebKit representatives.');
});

test('STORY-COMPOSER-013 custom purpose is visible and identical across estimate, job and normal history persistence', async ({ page }) => {
  const captured: Captured = { estimates: [], jobs: [], conversations: [] };
  await installRuntime(page, captured);
  await openComposer(page);
  const objective = '公開前の法的リスクと個人情報保護を重点的に確認する';
  await setCustomPurpose(page, objective);
  await expect(page.getByLabel('Purposeを選択')).toContainText(objective);
  await setPrivateOff(page);
  await page.getByLabel('Astera入力').fill('元の依頼本文');
  await page.getByLabel('Astera入力').press('Control+Enter');
  await expect(page.locator('.native-result-section')).toHaveCount(8);
  await expect.poll(() => captured.estimates.length).toBe(1);
  await expect.poll(() => captured.jobs.length).toBe(1);
  await expect.poll(() => captured.conversations.length).toBe(1);
  expect(captured.estimates[0].purpose).toBe('auto');
  expect(captured.jobs[0].purpose).toBe('auto');
  expect(captured.estimates[0].purpose_text).toBe(objective);
  expect(captured.jobs[0].purpose_text).toBe(objective);
  expect(captured.conversations[0].purpose_text).toBe(objective);
  expect(captured.jobs[0].prompt).toBe('元の依頼本文');
});

test('STORY-COMPOSER-014 custom purpose restores from history and changing it during edit does not reuse revision payload', async ({ page }) => {
  const objectiveA = '一次情報を優先する';
  const objectiveB = '法規制を重点確認する';
  const captured: Captured = { estimates: [], jobs: [], conversations: [] };
  await installRuntime(page, captured, {
    conversation: {
      id: 'conversation-custom',
      turns: [{
        id: 'turn-custom',
        job_id: 'job-history',
        prompt: '過去の投稿',
        purpose: 'research',
        purpose_text: objectiveA,
        result: result(),
      }],
    },
  });
  await openComposer(page, '/app/chats/conversation-custom');
  await expect(page.getByLabel('Purposeを選択')).toContainText(objectiveA);
  await page.getByLabel('投稿を編集').click();
  await setCustomPurpose(page, objectiveB);
  await page.getByLabel('Astera入力').fill('修整後本文');
  await page.getByLabel('Astera入力').press('Control+Enter');
  await expect.poll(() => captured.jobs.length).toBe(1);
  expect(captured.jobs[0].purpose_text).toBe(objectiveB);
  expect(captured.jobs[0]).not.toHaveProperty('revision_of_job_id');
  expect(captured.jobs[0]).not.toHaveProperty('revision_base_prompt');
});

test('STORY-COMPOSER-015 copy action writes only user text and reports success state', async ({ page }) => {
  const captured: Captured = { estimates: [], jobs: [], conversations: [] };
  await installRuntime(page, captured);
  await openComposer(page);
  await page.getByLabel('Astera入力').fill('コピー対象本文');
  await page.getByLabel('Astera入力').press('Control+Enter');
  const copy = page.getByLabel('投稿をコピー');
  await expect(copy).toBeVisible();
  await copy.click();
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __copiedText?: string }).__copiedText)).toBe('コピー対象本文');
  await expect(copy.locator('span')).toHaveText('✓');
});

test('STORY-COMPOSER-016 long user post is collapsed only when long and can be expanded', async ({ page }) => {
  const captured: Captured = { estimates: [], jobs: [], conversations: [] };
  await installRuntime(page, captured);
  await openComposer(page);
  const longText = '長文投稿。'.repeat(260);
  await page.getByLabel('Astera入力').fill(longText);
  await page.getByLabel('Astera入力').press('Control+Enter');
  const message = page.locator('.native-user-message');
  await expect(message).toHaveClass(/is-collapsed/);
  await message.getByRole('button', { name: 'もっと見る' }).click();
  await expect(message).not.toHaveClass(/is-collapsed/);
  await expect(message.getByRole('button', { name: '閉じる' })).toBeVisible();
});
