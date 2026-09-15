import { expect, test, type Page } from '@playwright/test';

/** LIVE gate case A — comparison path (B covered by REAL_MCP) */
const LIVE_JOB_PROMPT = 'A案とB案を比較したい。最終結論は出さず判断材料だけ欲しい。';

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

type JobPollSnapshot = {
  httpStatus: number;
  state: string | null;
  resultKeys: string[] | null;
  errorCode: string | null;
};

async function pollJobState(page: Page, jobId: string): Promise<JobPollSnapshot> {
  return page.evaluate(async (id) => {
    const response = await fetch(`/api/jobs/${encodeURIComponent(id)}`, { credentials: 'include' });
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('json')) {
      return {
        httpStatus: response.status,
        state: null,
        resultKeys: null,
        errorCode: `NON_JSON_${response.status}`,
      };
    }
    let payload: { job?: Record<string, unknown> };
    try {
      payload = (await response.json()) as { job?: Record<string, unknown> };
    } catch {
      return {
        httpStatus: response.status,
        state: null,
        resultKeys: null,
        errorCode: 'JSON_PARSE_FAILED',
      };
    }
    const job = payload.job ?? {};
    const state = typeof job.state === 'string' ? job.state : typeof job.status === 'string' ? job.status : null;
    const errorCode =
      job.error && typeof job.error === 'object' && job.error !== null && 'code' in job.error
        ? String((job.error as { code?: unknown }).code ?? '')
        : null;
    let resultKeys: string[] | null = null;
    const result = job.result;
    if (result && typeof result === 'object') {
      const sections = (result as { sections?: unknown }).sections;
      if (Array.isArray(sections)) {
        resultKeys = sections
          .map((section) =>
            section && typeof section === 'object' && 'key' in section ? String((section as { key: unknown }).key) : '',
          )
          .filter(Boolean);
      } else if (sections && typeof sections === 'object') {
        resultKeys = Object.keys(sections as Record<string, unknown>);
      }
    }
    return { httpStatus: response.status, state, resultKeys, errorCode: errorCode || null };
  }, jobId);
}

async function waitForMain8OrFail(page: Page, jobId: string | null): Promise<void> {
  const deadline = Date.now() + 240_000;
  let lastLog = '(no job poll yet)';

  while (Date.now() < deadline) {
    const errorLocator = page.locator('.native-error');
    if (await errorLocator.isVisible().catch(() => false)) {
      const errorText = await errorLocator.innerText();
      throw new Error(`native-error visible: ${errorText}`);
    }

    const sectionCount = await page.locator('.native-result-section').count();
    if (sectionCount >= 8) {
      return;
    }

    if (jobId) {
      const snap = await pollJobState(page, jobId);
      lastLog = JSON.stringify({
        job_id: jobId,
        httpStatus: snap.httpStatus,
        state: snap.state,
        resultKeys: snap.resultKeys,
        errorCode: snap.errorCode,
        uiSections: sectionCount,
      });
      console.log(`[e2e-live-process job poll] ${lastLog}`);
    }

    await page.waitForTimeout(2_000);
  }

  throw new Error(`Timed out waiting for 8 .native-result-section elements. Last job poll: ${lastLog}`);
}

function bodyHasMain8Markers(bodyText: string): boolean {
  const hasCanonical = MAIN8_CANONICAL_KEYS.every((key) =>
    new RegExp(key.replace(/_/g, '[_\\s]?')).test(bodyText),
  );
  if (hasCanonical) return true;
  for (let i = 1; i <= 8; i += 1) {
    const n = String(i).padStart(2, '0');
    if (!new RegExp(`\\b${n}\\b`).test(bodyText)) return false;
  }
  return true;
}

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

  const postResponsePromise = page.waitForResponse(
    (response) => {
      const url = new URL(response.url());
      return url.pathname === '/api/jobs' && response.request().method() === 'POST';
    },
    { timeout: 120_000 },
  );
  await reserveButton.click();

  await expect.poll(() => jobPosts.length, { timeout: 10_000 }).toBeGreaterThan(0);

  const postResponse = await postResponsePromise;
  expect(postResponse.status()).toBeGreaterThanOrEqual(200);
  expect(postResponse.status()).toBeLessThan(300);

  const postBody = (await postResponse.json()) as { job?: { job_id?: string; id?: string; state?: string } };
  const jobId = postBody.job?.job_id ?? postBody.job?.id ?? null;
  console.log(
    `[e2e-live-process job POST] ${JSON.stringify({
      status: postResponse.status(),
      job_id: jobId,
      state: postBody.job?.state ?? null,
    })}`,
  );

  await waitForMain8OrFail(page, jobId);

  await expect(page.locator('.native-result-section')).toHaveCount(8);
  const bodyText = await page.locator('body').innerText();
  expect(bodyHasMain8Markers(bodyText)).toBe(true);

  await page.screenshot({ path: '/tmp/playwright-e2e-live-process-test-results/live-process-main8-success.png', fullPage: true });
});
