import { expect, test } from '@playwright/test';

const AUTH_ROUTES = [
  { path: '/login', ja: 'ログイン', en: 'Log in' },
  { path: '/register', ja: 'アカウント登録', en: 'Create account' },
  { path: '/forgot-password', ja: 'パスワードを忘れた場合', en: 'Forgot password' },
  { path: '/reset-password', ja: 'パスワード再設定', en: 'Reset password' },
  { path: '/verify-email', ja: 'メール確認', en: 'Verify email' },
  { path: '/account/password/setup', ja: 'Astera用パスワード設定', en: 'Set Astera password' },
  { path: '/auth/2fa', ja: '2段階認証', en: 'Two-factor authentication' },
] as const;

for (const route of AUTH_ROUTES) {
  test(`${route.path} switches the Text list between Japanese and English`, async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('astera-language', 'ja');
    });

    await page.goto(route.path);

    const toggle = page.locator('.auth-language-toggle');
    await expect(toggle).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: route.ja })).toBeVisible();
    await expect(page.getByRole('button', { name: '日本語' })).toHaveAttribute('aria-pressed', 'true');

    await page.getByRole('button', { name: 'English' }).click();

    await expect(page.getByRole('heading', { level: 1, name: route.en })).toBeVisible();
    await expect(page.getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => page.evaluate(() => localStorage.getItem('astera-language'))).toBe('en');
    await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe('en');

    await page.getByRole('button', { name: '日本語' }).click();

    await expect(page.getByRole('heading', { level: 1, name: route.ja })).toBeVisible();
    await expect.poll(() => page.evaluate(() => localStorage.getItem('astera-language'))).toBe('ja');
    await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe('ja');
  });
}

test('language toggle is not added to non-auth public pages', async ({ page }) => {
  await page.goto('/pricing');
  await expect(page.locator('.auth-language-toggle')).toHaveCount(0);
});
