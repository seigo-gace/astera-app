import { expect, test, type Page, type Route } from '@playwright/test';

const PURPOSES = [
  ['review', 'レビュー'],
  ['compare', '比較'],
  ['verify', '検証'],
  ['improve', '改善'],
  ['research', '調査'],
  ['plan', '計画'],
  ['consider', '検討'],
] as const;

const RESULT_KEYS = [
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

function completeSections() {
  return RESULT_KEYS.map((key, index) => ({
    key,
    title: `判断材料 ${index + 1}`,
    body: `用途Contract Browser Gate ${index + 1}`,
    source_ids: [],
  }));
}

async function installRuntime(page: Page, estimates: Array<Record<string, unknown>>, jobs: Array<Record<string, unknown>>) {
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/account') return json(route, { account: { id: 'purpose-gate-user', display_name: 'Purpose Gate', account_status: 'active' } });
    if (path === '/api/preferences') return json(route, { preferences: { translation: true, agent_mode: true, document: true, storage_transfer: true } });
    if (path === '/api/history') return json(route, { items: [] });
    if (path === '/api/credit/balance') return json(route, { usable_balance: 1000, reserved_balance: 0, state: 'healthy', policy: { low_threshold: 200 } });
    if (path === '/api/account/catalog') return json(route, { subscription: { plan_id: 'basic' }, plans: [{ plan_id: 'basic', included_credits: 1000 }] });
    if (path === '/api/projects') return json(route, { projects: [] });
    if (path === '/api/templates') return json(route, { templates: [] });
    if (path === '/api/storage/destinations') return json(route, { destinations: [] });
    if (path === '/api/jobs/estimate' && request.method() === 'POST') {
      estimates.push(request.postDataJSON() as Record<string, unknown>);
      return json(route, {
        estimate: {
          estimate_id: `estimate-${estimates.length}`,
          required_credits: 1,
          available_credits: 1000,
          reserved_credits: 0,
          credit_state: 'normal',
          expires_at: new Date(Date.now() + 60_000).toISOString(),
          billing_mode: 'full',
          billable_characters: 32,
        },
      }, 201);
    }
    if (path === '/api/jobs' && request.method() === 'POST') {
      jobs.push(request.postDataJSON() as Record<string, unknown>);
      return json(route, {
        job: {
          job_id: `purpose-job-${jobs.length}`,
          state: 'completed',
          result: { sections: completeSections() },
        },
      }, 201);
    }
    return json(route, { ok: true });
  });
}

test('STORY-COMPOSER-011 all seven manual purposes survive UI selection -> estimate -> Job create without prompt mutation', async ({ page }) => {
  const estimates: Array<Record<string, unknown>> = [];
  const jobs: Array<Record<string, unknown>> = [];
  await installRuntime(page, estimates, jobs);
  await page.goto('/app/new', { waitUntil: 'domcontentloaded' });
  await expect(page.getByLabel('Astera入力')).toBeVisible();

  for (const [purpose, label] of PURPOSES) {
    if (await page.getByRole('button', { name: '新規' }).count()) {
      await page.getByRole('button', { name: '新規' }).click();
    }

    await page.getByLabel('Fileと実行Optionを追加').click();
    const dialog = page.getByRole('dialog', { name: '追加' });
    await expect(dialog).toBeVisible();
    await dialog.getByText('用途・目的', { exact: true }).click();
    await dialog.getByRole('button', { name: label, exact: true }).click();
    await dialog.getByLabel('閉じる').click();
    await expect(page.getByText(label, { exact: true })).toBeVisible();

    const prompt = `purpose-contract-${purpose}-原文保持`;
    await page.getByLabel('Astera入力').fill(prompt);
    await page.getByLabel('実行').click();
    await expect(page.locator('.native-result-section')).toHaveCount(8);

    const estimate = estimates.at(-1);
    const job = jobs.at(-1);
    expect(estimate, `${purpose}: estimate payload missing`).toBeTruthy();
    expect(job, `${purpose}: job payload missing`).toBeTruthy();
    expect(estimate?.purpose, `${purpose}: estimate purpose`).toBe(purpose);
    expect(job?.purpose, `${purpose}: job purpose`).toBe(purpose);
    expect(estimate?.prompt, `${purpose}: estimate prompt mutation`).toBe(prompt);
    expect(job?.prompt, `${purpose}: job prompt mutation`).toBe(prompt);
  }

  expect(estimates).toHaveLength(PURPOSES.length);
  expect(jobs).toHaveLength(PURPOSES.length);
});
