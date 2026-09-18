import { expect, test, type Page, type Route } from '@playwright/test';

function json(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({ status, contentType: 'application/json; charset=utf-8', body: JSON.stringify(body) });
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const state = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
  }));
  expect(state.scrollWidth).toBeLessThanOrEqual(state.clientWidth + 2);
}

async function mockBase(page: Page, surveyRequired = false): Promise<{ surveyAttempts: () => number }> {
  let surveyAttempts = 0;
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/account') {
      await json(route, { account: { user_id: 'u1', tenant_id: 'personal:u1', account_status: 'active', display_name: 'Reward Test', nickname: 'Reward Test', email: 'reward@example.test', email_verified: true, ui_language: 'ja-JP' } });
      return;
    }
    if (path === '/api/beta' && request.method() === 'GET') {
      await json(route, surveyRequired
        ? { beta: { survey_required: true, target_month: '2026-09', participant: { state: 'active', telemetry_enabled: 1 }, policy: { monthly_credit: 30000, minimum_commitment_days: 90 }, features: [] } }
        : { beta: { survey_required: false, target_month: '2026-09', participant: null, policy: { monthly_credit: 30000, minimum_commitment_days: 90 }, features: [] } });
      return;
    }
    if (path === '/api/beta/survey' && request.method() === 'POST') {
      surveyAttempts += 1;
      if (surveyAttempts === 1) { await json(route, { error: { code: 'TEMPORARY_ERROR', message: '一時的に送信できません。' } }, 503); return; }
      await json(route, { accepted: true, target_month: '2026-09' });
      return;
    }
    if (path === '/api/referral') {
      if (request.method() === 'GET') {
        await json(route, { referral: { code: 'ABCDE-FGHIJ', qualified_count: 3, milestones: [{ threshold: 1, cumulative_credit: 10000 }, { threshold: 3, cumulative_credit: 30000 }, { threshold: 5, cumulative_credit: 60000 }, { threshold: 10, cumulative_credit: 150000 }] } });
      } else await json(route, { accepted: true });
      return;
    }
    if (path === '/api/coupons/redemptions') { await json(route, { redemptions: [] }); return; }
    if (path === '/api/coupons/preview') { await json(route, { preview: { title: 'Event Reward', description: 'テスト特典', credit_amount: 10000 } }); return; }
    if (path === '/api/coupons/redeem') { await json(route, { state: 'applied' }); return; }
    if (path === '/api/credit/balance') { await json(route, { usable_balance: 50000, reserved_balance: 0, state: 'healthy', policy: { low_threshold: 10000 } }); return; }
    if (path === '/api/account/catalog') { await json(route, { subscription: { plan_id: 'basic' }, plans: [{ plan_id: 'basic', included_credits: 180000 }] }); return; }
    if (path === '/api/history') { await json(route, { items: [] }); return; }
    await json(route, { ok: true });
  });
  return { surveyAttempts: () => surveyAttempts };
}

test('Coupon Referral Beta settings overlays stay responsive and local to settings', async ({ page }) => {
  await mockBase(page, false);
  await page.goto('/app/settings');
  await expect(page.getByRole('button', { name: 'クーポン', exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: '友達紹介', exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'βテスト', exact: false })).toBeVisible();

  await page.getByRole('button', { name: 'クーポン', exact: false }).click();
  await expect(page.getByRole('dialog', { name: 'クーポン' })).toBeVisible();
  await page.getByLabel('クーポンコード').fill('TEST-CODE-1234');
  await page.getByRole('button', { name: '確認する' }).click();
  await expect(page.getByText('Event Reward')).toBeVisible();
  await page.getByRole('button', { name: '適用する' }).click();
  await expect(page.getByText(/クーポンを適用しました/)).toBeVisible();
  await page.getByRole('button', { name: '閉じる' }).click();

  await page.getByRole('button', { name: '友達紹介', exact: false }).click();
  await expect(page.getByRole('dialog', { name: '友達紹介' })).toBeVisible();
  await expect(page.getByText('ABCDE-FGHIJ')).toBeVisible();
  await expect(page.getByText('30,000 Credit')).toBeVisible();
  await page.getByRole('button', { name: '閉じる' }).click();

  await page.getByRole('button', { name: 'βテスト', exact: false }).click();
  await expect(page.getByRole('dialog', { name: 'βテスト' })).toBeVisible();
  await expect(page.getByText('30,000 Credit')).toBeVisible();
  await expect(page.getByText(/90日/)).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('mandatory Beta survey cannot dismiss and preserves input across failed submit', async ({ page }) => {
  const state = await mockBase(page, true);
  await page.goto('/app/settings');
  const dialog = page.getByRole('dialog', { name: '月次使用感アンケート' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: '閉じる' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();

  const scaleGroups = dialog.locator('fieldset').filter({ has: page.locator('.beta-scale') });
  for (let index = 0; index < 4; index += 1) await scaleGroups.nth(index).getByText('5', { exact: true }).click();

  const issueGroups = dialog.locator('fieldset').filter({ has: page.locator('.beta-binary') });
  for (let index = 0; index < 3; index += 1) await issueGroups.nth(index).getByText('なし', { exact: true }).click();
  await issueGroups.nth(3).getByText('なし', { exact: true }).click();

  await dialog.getByText('改善してほしい点').locator('..').getByRole('textbox').fill('スマホでさらに見やすくしてほしい');
  await dialog.getByText('今月使用した感想').locator('..').getByRole('textbox').fill('全体として操作しやすかった');
  await dialog.getByRole('button', { name: '送信する' }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('一時的に送信できません。')).toBeVisible();
  await expect(dialog.getByText('改善してほしい点').locator('..').getByRole('textbox')).toHaveValue('スマホでさらに見やすくしてほしい');
  expect(state.surveyAttempts()).toBe(1);

  await dialog.getByRole('button', { name: '送信する' }).click();
  await expect(dialog).toHaveCount(0);
  expect(state.surveyAttempts()).toBe(2);
  await expectNoHorizontalOverflow(page);
});
