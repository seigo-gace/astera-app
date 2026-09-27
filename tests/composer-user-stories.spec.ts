import { expect, test, type Page, type Route, type TestInfo } from '@playwright/test';

const STORY_PROJECTS = new Set(['chromium-desktop', 'webkit-iphone-large']);
const RESULT_KEYS = ['true_purpose','missing_assumptions','fact_check','risk_detection','counter_view','alternatives','recommendation','next_prompt'] as const;

function json(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({ status, contentType: 'application/json; charset=utf-8', body: JSON.stringify(body) });
}
function completeSections(prefix = '利用者向け検証内容') {
  return RESULT_KEYS.map((key, index) => ({ key, title: `判断材料 ${index + 1}`, body: `${prefix} ${index + 1}`, source_ids: [`source-${index + 1}`] }));
}
function sources() {
  return RESULT_KEYS.map((_, index) => ({ id: `source-${index + 1}`, title: `根拠 ${index + 1}`, url: `https://example.com/source-${index + 1}`, status: 'verified', retrievedAt: '2026-09-27T00:00:00.000Z' }));
}
function estimatePayload() {
  return { estimate: { estimate_id: 'estimate-story', required_credits: 12, available_credits: 1000, reserved_credits: 0, credit_state: 'normal', expires_at: new Date(Date.now() + 60_000).toISOString(), billing_mode: 'full', billable_characters: 20 } };
}

type PreferenceState = { translation: boolean; agent_mode: boolean; document: boolean; storage_transfer: boolean };
type MockOptions = {
  estimateDelay?: number;
  estimateFailure?: boolean;
  incompleteResult?: boolean;
  counters?: { estimates: number; jobs: number; conversations: number };
  preferences?: Partial<PreferenceState>;
  preferencePatches?: Array<Record<string, unknown>>;
  jobBodies?: Array<Record<string, unknown>>;
  conversationBodies?: Array<Record<string, unknown>>;
  conversationDetail?: Record<string, unknown>;
};

async function installRuntime(page: Page, options: MockOptions = {}): Promise<void> {
  let preferences: PreferenceState = { translation: true, agent_mode: true, document: true, storage_transfer: true, ...options.preferences };
  let jobSequence = 0;
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/account') return json(route, { account: { id: 'composer-user', display_name: 'Composer User', account_status: 'active' } });
    if (path === '/api/preferences') {
      if (request.method() === 'PATCH') {
        const patch = request.postDataJSON() as Record<string, unknown>;
        options.preferencePatches?.push(patch);
        preferences = { ...preferences, ...patch } as PreferenceState;
      }
      return json(route, { preferences });
    }
    if (path === '/api/history') return json(route, { items: [] });
    if (path === '/api/conversations' && request.method() === 'GET') return json(route, { conversations: [] });
    if (path === '/api/conversations' && request.method() === 'POST') {
      if (options.counters) options.counters.conversations += 1;
      options.conversationBodies?.push(request.postDataJSON() as Record<string, unknown>);
      return json(route, { conversation_id: 'conversation-story', turn_id: (request.postDataJSON() as Record<string, unknown>).client_turn_id }, 201);
    }
    if (path.startsWith('/api/conversations/') && request.method() === 'GET') {
      return json(route, options.conversationDetail ?? { conversation: { id: 'conversation-story', turns: [] } });
    }
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
      const body = request.postDataJSON() as Record<string, unknown>;
      options.jobBodies?.push(body);
      jobSequence += 1;
      return json(route, {
        job: {
          job_id: `job-story-${jobSequence}`,
          state: 'completed',
          result: {
            sections: options.incompleteResult ? [{ key: 'true_purpose', title: '不足', body: '1項目だけ' }] : completeSections(`回答${jobSequence}`),
            sources: options.incompleteResult ? [] : sources(),
          },
        },
      }, 201);
    }
    return json(route, { ok: true });
  });
}

async function openComposer(page: Page, path = '/app/new'): Promise<void> {
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await expect(page.getByLabel('Astera入力')).toBeVisible();
}

async function setPrivateMode(page: Page, enabled: boolean): Promise<void> {
  await page.getByLabel('Fileと実行Optionを追加').click();
  const dialog = page.getByRole('dialog', { name: '追加' });
  const button = dialog.getByRole('button', { name: /Private Mode/ });
  const pressed = await button.getAttribute('aria-pressed');
  if ((pressed === 'true') !== enabled) await button.click();
  await dialog.getByLabel('閉じる').click();
}

test.beforeEach(async ({}, testInfo: TestInfo) => {
  test.skip(!STORY_PROJECTS.has(testInfo.project.name), 'Composer stories use one Chromium and one WebKit touch representative.');
});

test('STORY-COMPOSER-001 Enter creates a line break and never estimates', async ({ page }) => {
  const counters = { estimates: 0, jobs: 0, conversations: 0 };
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

test('STORY-COMPOSER-002 successful post clears textarea and preserves user bubble plus eight-section answer', async ({ page }) => {
  await installRuntime(page);
  await openComposer(page);
  const textarea = page.getByLabel('Astera入力');
  await textarea.fill('ユーザー目線で検証する');
  await textarea.press('Control+Enter');
  await expect(textarea).toHaveValue('');
  await expect(page.locator('.native-user-message').last().locator('> p')).toHaveText('ユーザー目線で検証する');
  await expect(page.locator('.native-result-section')).toHaveCount(8);
  await expect(page.locator('.native-response')).toBeVisible();
});

test('STORY-COMPOSER-003 estimate failure preserves draft and creates no posted turn', async ({ page }) => {
  await installRuntime(page, { estimateFailure: true });
  await openComposer(page);
  const textarea = page.getByLabel('Astera入力');
  await textarea.fill('通信が切れても入力を残す');
  await textarea.press('Control+Enter');
  await expect(page.locator('.native-error')).toBeVisible();
  await expect(textarea).toHaveValue('通信が切れても入力を残す');
  await expect(page.locator('.native-user-message')).toHaveCount(0);
});

test('STORY-COMPOSER-004 incomplete accepted Result fails closed but keeps the posted turn', async ({ page }) => {
  await installRuntime(page, { incompleteResult: true });
  await openComposer(page);
  const textarea = page.getByLabel('Astera入力');
  await textarea.fill('固定8項目が必要');
  await textarea.press('Control+Enter');
  await expect(textarea).toHaveValue('');
  await expect(page.locator('.native-user-message')).toContainText('固定8項目が必要');
  await expect(page.locator('.native-error')).toContainText('ASTERA_RESPONSE_SECTIONS_INCOMPLETE');
  await expect(page.locator('.native-result-section')).toHaveCount(0);
});

test('STORY-COMPOSER-005 two normal posts remain two turns and second post is not an automatic revision', async ({ page }) => {
  const jobBodies: Array<Record<string, unknown>> = [];
  await installRuntime(page, { jobBodies });
  await openComposer(page);
  const textarea = page.getByLabel('Astera入力');
  await textarea.fill('1回目');
  await textarea.press('Control+Enter');
  await expect(page.locator('.native-result-section')).toHaveCount(8);
  await textarea.fill('2回目');
  await textarea.press('Control+Enter');
  await expect(page.locator('.native-user-message')).toHaveCount(2);
  await expect(page.locator('.native-result-section')).toHaveCount(16);
  expect(jobBodies).toHaveLength(2);
  expect(jobBodies[1]).not.toHaveProperty('revision_of_job_id');
  expect(jobBodies[1]).not.toHaveProperty('revision_base_prompt');
});

test('STORY-COMPOSER-006 edit action uses revision only for the edited turn', async ({ page }) => {
  const jobBodies: Array<Record<string, unknown>> = [];
  await installRuntime(page, { jobBodies });
  await openComposer(page);
  const textarea = page.getByLabel('Astera入力');
  await textarea.fill('元の投稿');
  await textarea.press('Control+Enter');
  await page.getByLabel('投稿を編集').click();
  await expect(textarea).toHaveValue('元の投稿');
  await textarea.fill('修整後の投稿');
  await textarea.press('Control+Enter');
  expect(jobBodies).toHaveLength(2);
  expect(jobBodies[1].revision_of_job_id).toBe('job-story-1');
  expect(jobBodies[1].revision_base_prompt).toBe('元の投稿');
  await expect(page.locator('.native-user-message')).toHaveCount(1);
  await expect(page.locator('.native-user-message > p')).toHaveText('修整後の投稿');
});

test('STORY-COMPOSER-007 purpose is always visible next to plus and defaults to Auto', async ({ page }) => {
  await installRuntime(page);
  await openComposer(page);
  await expect(page.getByLabel('Fileと実行Optionを追加')).toBeVisible();
  const purpose = page.getByLabel('Purposeを選択');
  await expect(purpose).toContainText('Auto');
  await purpose.click();
  const dialog = page.getByRole('dialog', { name: '用途・目的' });
  await dialog.getByRole('button', { name: '調査' }).click();
  await expect(purpose).toContainText('調査');
});

test('STORY-COMPOSER-008 sources are absent inline and available through top-right evidence view', async ({ page }) => {
  await installRuntime(page);
  await openComposer(page);
  await page.getByLabel('Astera入力').fill('根拠を確認する');
  await page.getByLabel('Astera入力').press('Control+Enter');
  await expect(page.locator('.native-result-section small')).toHaveCount(0);
  const evidence = page.locator('.platform-main-evidence-toggle button').first();
  await expect(evidence).toBeEnabled();
  await evidence.click();
  await expect(page.getByRole('region', { name: '根拠一覧' })).toBeVisible();
  await expect(page.locator('.native-evidence-view li')).toHaveCount(8);
  await page.locator('.platform-main-evidence-toggle a').first().click();
  await expect(page.locator('.native-result-section')).toHaveCount(8);
});

test('STORY-COMPOSER-009 private mode defaults ON and only OFF persists a conversation', async ({ page }) => {
  const counters = { estimates: 0, jobs: 0, conversations: 0 };
  const conversationBodies: Array<Record<string, unknown>> = [];
  await installRuntime(page, { counters, conversationBodies });
  await openComposer(page);
  await page.getByLabel('Fileと実行Optionを追加').click();
  let dialog = page.getByRole('dialog', { name: '追加' });
  await expect(dialog.getByRole('button', { name: /Private Mode/ })).toHaveAttribute('aria-pressed', 'true');
  await dialog.getByLabel('閉じる').click();
  await page.getByLabel('Astera入力').fill('Private');
  await page.getByLabel('Astera入力').press('Control+Enter');
  expect(counters.conversations).toBe(0);

  await setPrivateMode(page, false);
  await page.getByLabel('Astera入力').fill('Normal');
  await page.getByLabel('Astera入力').press('Control+Enter');
  expect(counters.conversations).toBe(1);
  expect(conversationBodies[0].prompt).toBe('Normal');
  expect(page.url()).toContain('/app/chats/conversation-story');
});

test('STORY-COMPOSER-010 saved conversation restores user prompt and result from history route', async ({ page }) => {
  await installRuntime(page, {
    conversationDetail: {
      conversation: {
        id: 'conversation-story',
        project_id: null,
        turns: [{
          id: 'turn-1',
          job_id: 'job-history',
          prompt: '過去の投稿',
          purpose: 'research',
          result: { sections: completeSections('過去回答'), sources: sources() },
        }],
      },
    },
  });
  await openComposer(page, '/app/chats/conversation-story');
  await expect(page.locator('.native-user-message > p')).toHaveText('過去の投稿');
  await expect(page.locator('.native-result-section')).toHaveCount(8);
  await expect(page.getByLabel('Purposeを選択')).toContainText('調査');
});

test('STORY-COMPOSER-011 user bubble has copy and edit actions and assistant remains unboxed', async ({ page }) => {
  await installRuntime(page);
  await openComposer(page);
  await page.getByLabel('Astera入力').fill('投稿内容をそのまま表示する');
  await page.getByLabel('Astera入力').press('Control+Enter');
  await expect(page.getByLabel('投稿をコピー')).toBeVisible();
  await expect(page.getByLabel('投稿を編集')).toBeEnabled();
  const userMessage = page.locator('.native-user-message');
  const response = page.locator('.native-response');
  expect(await userMessage.evaluate((element) => getComputedStyle(element).borderTopWidth)).toBe('0px');
  expect(await response.evaluate((element) => getComputedStyle(element).borderTopWidth)).toBe('0px');
});

test('STORY-COMPOSER-012 plus and at reflect sidebar preference candidates', async ({ page }) => {
  await installRuntime(page, { preferences: { translation: true, agent_mode: false, document: true, storage_transfer: true } });
  await openComposer(page);
  await page.getByLabel('Fileと実行Optionを追加').click();
  let dialog = page.getByRole('dialog', { name: '追加' });
  await expect(dialog.getByText('高精度翻訳', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Agent Mode', { exact: true })).toHaveCount(0);
  await expect(dialog.getByText('外部Storage転送', { exact: true })).toBeVisible();
  await dialog.getByLabel('閉じる').click();
  await page.getByLabel('Astera入力').press('@');
  dialog = page.getByRole('dialog', { name: 'Option・対象選択' });
  await expect(dialog.getByText('高精度翻訳', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Agent Mode', { exact: true })).toHaveCount(0);
  await expect(dialog.getByText('外部Storage転送', { exact: true })).toBeVisible();
});
