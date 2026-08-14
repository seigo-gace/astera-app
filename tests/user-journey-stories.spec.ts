import { expect, test, type Page, type Route, type TestInfo } from '@playwright/test';

const STORY_PROJECTS = new Set(['chromium-desktop', 'webkit-iphone-large']);

const protectedPaths = [
  '/app',
  '/app/new',
  '/app/results/result-1',
  '/app/projects',
  '/app/history?query=important#latest',
  '/app/about',
  '/app/settings',
  '/app/settings/options',
  '/app/settings/language',
  '/app/settings/templates',
  '/app/settings/storage-destinations',
  '/app/settings/astera-storage',
  '/app/settings/data-privacy',
  '/app/settings/notifications',
  '/account',
  '/account/security',
  '/account/subscription',
  '/account/credit',
  '/account/billing/status?intent=intent-1',
  '/app/developer',
  '/share/share-1',
  '/app/shares',
] as const;

const publicPaths = [
  '/pricing',
  '/legal',
  '/legal/privacy',
  '/s/public-token',
  '/status',
  '/support',
] as const;

function json(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({
    status,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify(body),
  });
}

function activeAccount(overrides: Record<string, unknown> = {}) {
  return {
    account: {
      id: 'account-story',
      nickname: 'Story User',
      email: 'story@example.test',
      account_status: 'active',
      current_plan_name: 'Basic',
      credit_balance: 1000,
      ...overrides,
    },
  };
}

async function defaultApi(route: Route): Promise<void> {
  const request = route.request();
  const path = new URL(request.url()).pathname;
  if (path === '/api/account') return json(route, activeAccount());
  if (path === '/api/projects') return json(route, { projects: [{ id: 'project-1', name: 'Story Project' }] });
  if (path === '/api/history') return json(route, { items: [{ id: 'result-1', title: 'Story Result' }] });
  if (path === '/api/results/result-1') return json(route, { result: { id: 'result-1', title: 'Story Result' }, sections: [] });
  if (path === '/api/account/catalog' || path === '/api/catalog/public') {
    return json(route, {
      account: { current_plan_name: 'Basic' },
      plans: [{ plan_id: 'basic', display_name: 'Basic', price_label: '¥980', description: 'Story plan' }],
    });
  }
  if (path === '/api/preferences') return json(route, { preferences: { ui_language: 'ja', theme: 'dark', history_enabled: true, analytics_enabled: false } });
  if (path === '/api/credit/notification-preferences') return json(route, { preferences: { in_app_enabled: true, email_enabled: false, push_enabled: false } });
  if (path === '/api/templates') return json(route, { templates: [] });
  if (path === '/api/storage/destinations') return json(route, { destinations: [] });
  if (path === '/api/credit/balance') return json(route, { balance: 1000 });
  if (path === '/api/credit/ledger') return json(route, { entries: [] });
  if (path === '/api/account/security') return json(route, { security: { active_sessions: 1 } });
  if (path === '/api/developer/catalog') return json(route, { targets: [] });
  if (path === '/api/developer/keys') return json(route, { keys: [] });
  if (path === '/api/shares') return json(route, { items: [] });
  if (path === '/api/shares/public/public-token' || path === '/api/shares/share-1') return json(route, { share: { id: 'share-1', title: 'Shared Story' } });
  if (path.startsWith('/api/legal')) return json(route, { title: 'Legal', body: 'Policy' });
  if (path === '/api/status') return json(route, { status: 'operational' });
  if (path === '/api/billing/status/intent-1') return json(route, { intent_id: 'intent-1', status: 'pending' });
  return json(route, { ok: true });
}

async function useDefaultApi(page: Page): Promise<void> {
  await page.route('**/api/**', defaultApi);
}

function onlyStoryProjects(testInfo: TestInfo): void {
  test.skip(!STORY_PROJECTS.has(testInfo.project.name), 'User journey matrix uses one Chromium desktop and one WebKit touch representative.');
}

test.beforeEach(async ({}, testInfo) => {
  onlyStoryProjects(testInfo);
});

test('STORY-AUTH-001 protected routes redirect to Login and preserve the exact return context', async ({ page }) => {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/account') return json(route, { error: { code: 'SESSION_EXPIRED', message: 'Session expired' } }, 401);
    return defaultApi(route);
  });

  for (const path of protectedPaths) {
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/login\?return_to=/);
    const login = new URL(page.url());
    expect(login.searchParams.get('return_to'), path).toBe(path);
  }
});

test('STORY-AUTH-002 public routes do not call the protected account projection', async ({ page }) => {
  let accountRequests = 0;
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/account') accountRequests += 1;
    return defaultApi(route);
  });

  for (const path of publicPaths) {
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#root')).toBeVisible();
    expect(new URL(page.url()).pathname).toBe(new URL(path, 'https://example.test').pathname);
  }
  expect(accountRequests).toBe(0);
});

test('STORY-AUTH-003 a protected page fetches the account projection only once', async ({ page }) => {
  let accountRequests = 0;
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/account') {
      accountRequests += 1;
      return json(route, activeAccount());
    }
    return defaultApi(route);
  });

  await page.goto('/app/projects');
  await expect(page.getByRole('heading', { name: 'Project' })).toBeVisible();
  await expect(page.getByText('Story Project')).toBeVisible();
  expect(accountRequests).toBe(1);
});

test('STORY-AUTH-004 a security hold stays visible instead of creating a Login loop', async ({ page }) => {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/account') return json(route, { error: { code: 'ACCOUNT_SECURITY_HOLD', message: '安全確認中です。' } }, 403);
    return defaultApi(route);
  });

  await page.goto('/account');
  await expect(page).toHaveURL(/\/account$/);
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('安全確認中です。');
  await expect(alert).toContainText('ACCOUNT_SECURITY_HOLD');
});

test('STORY-AUTH-005 pending Email verification is routed to verification with context intact', async ({ page }) => {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/account') return json(route, activeAccount({ account_status: 'pending_email_verification' }));
    return defaultApi(route);
  });

  await page.goto('/app/history?query=important');
  await expect(page).toHaveURL(/\/verify-email\?/);
  const url = new URL(page.url());
  expect(url.searchParams.get('return_to')).toBe('/app/history?query=important');
  expect(url.searchParams.get('email')).toBe('story@example.test');
});

test('STORY-AUTH-006 pending Password setup is routed before protected content is shown', async ({ page }) => {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/account') return json(route, activeAccount({ account_status: 'pending_password_setup' }));
    return defaultApi(route);
  });

  await page.goto('/app/developer');
  await expect(page).toHaveURL(/\/account\/password\/setup\?/);
  expect(new URL(page.url()).searchParams.get('return_to')).toBe('/app/developer');
});

test('STORY-CHECKOUT-001 checkout keeps the selected plan visible when Login is required', async ({ page }) => {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/account/catalog') return json(route, { error: { code: 'AUTHENTICATION_REQUIRED', message: 'Login required' } }, 401);
    return defaultApi(route);
  });

  await page.goto('/account/checkout?plan=basic&return_to=pricing');
  await expect(page.getByText('Astera AccountへのLoginまたは登録が必要です。')).toBeVisible();
  const loginHref = await page.getByRole('link', { name: 'Login' }).getAttribute('href');
  const registerHref = await page.getByRole('link', { name: 'Account登録' }).getAttribute('href');
  expect(decodeURIComponent(loginHref ?? '')).toContain('/account/checkout?plan=basic&return_to=pricing');
  expect(decodeURIComponent(registerHref ?? '')).toContain('/account/checkout?plan=basic&return_to=pricing');
});

test('STORY-CHECKOUT-002 an untrusted checkout URL is rejected before navigation', async ({ page }) => {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/account/catalog') return defaultApi(route);
    if (path === '/api/billing/checkout-intents') return json(route, { checkout_url: 'https://evil.example/phishing' });
    return defaultApi(route);
  });

  await page.goto('/account/checkout?plan=basic&return_to=pricing');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Square Checkoutへ進む' }).click();
  await expect(page.getByRole('alert')).toContainText('CHECKOUT_URL_REJECTED');
  expect(new URL(page.url()).hostname).toBe('127.0.0.1');
});

test('STORY-LOGIN-001 normal Login returns to the requested protected page', async ({ page }) => {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/sign-in/email') return json(route, { authenticated: true, account: { account_status: 'active' } });
    return defaultApi(route);
  });

  await page.goto('/login?return_to=%2Fapp%2Fprojects');
  await page.getByLabel('Email').fill('story@example.test');
  await page.getByLabel('Password').fill('story-password-123');
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/projects$/);
});

test('STORY-LOGIN-002 Email Login respects a required Password setup stage', async ({ page }) => {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/sign-in/email') return json(route, { data: { requires_password_setup: true } });
    return defaultApi(route);
  });

  await page.goto('/login?return_to=%2Faccount%2Fcredit');
  await page.getByLabel('Email').fill('story@example.test');
  await page.getByLabel('Password').fill('story-password-123');
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await expect(page).toHaveURL(/\/account\/password\/setup\?/);
  expect(new URL(page.url()).searchParams.get('return_to')).toBe('/account/credit');
});

test('STORY-LOGIN-003 Email Login respects the current session-based 2FA stage', async ({ page }) => {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/sign-in/email') return json(route, { data: { twoFactorRedirect: true } });
    return defaultApi(route);
  });

  await page.goto('/login?return_to=%2Fapp%2Fhistory');
  await page.getByLabel('Email').fill('story@example.test');
  await page.getByLabel('Password').fill('story-password-123');
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await expect(page).toHaveURL(/\/auth\/2fa\?/);
  const url = new URL(page.url());
  expect(url.searchParams.has('challenge')).toBe(false);
  expect(url.searchParams.get('return_to')).toBe('/app/history');
});

test('STORY-LOGIN-004 external return targets are discarded', async ({ page }) => {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/sign-in/email') return json(route, { authenticated: true });
    return defaultApi(route);
  });

  await page.goto('/login?return_to=https%3A%2F%2Fevil.example%2Fsteal');
  await page.getByLabel('Email').fill('story@example.test');
  await page.getByLabel('Password').fill('story-password-123');
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/new$/);
});

test('STORY-REGISTER-001 mismatched Passwords never reach the API', async ({ page }) => {
  let registerRequests = 0;
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/sign-up/email') registerRequests += 1;
    return defaultApi(route);
  });

  await page.goto('/register');
  await page.getByLabel('Email').fill('story@example.test');
  await page.getByLabel('Nickname').fill('Story User');
  await page.getByLabel('Password（12〜128文字）').fill('story-password-123');
  await page.getByLabel('Password確認').fill('different-password-123');
  await page.getByRole('button', { name: 'Account登録' }).click();
  await expect(page.getByRole('alert')).toContainText('PASSWORD_MISMATCH');
  expect(registerRequests).toBe(0);
});

test('STORY-REGISTER-002 rapid duplicate registration becomes one request and keeps the return path', async ({ page }) => {
  let registerRequests = 0;
  let idempotencyKey = '';
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/sign-up/email') {
      registerRequests += 1;
      idempotencyKey = route.request().headers()['idempotency-key'] ?? '';
      await new Promise((resolve) => setTimeout(resolve, 120));
      return json(route, { registered: true });
    }
    return defaultApi(route);
  });

  await page.goto('/register?return_to=%2Faccount%2Fcheckout%3Fplan%3Dbasic%26return_to%3Dpricing');
  await page.getByLabel('Email').fill('story@example.test');
  await page.getByLabel('Nickname').fill('Story User');
  await page.getByLabel('Password（12〜128文字）').fill('story-password-123');
  await page.getByLabel('Password確認').fill('story-password-123');
  await page.getByRole('button', { name: 'Account登録' }).evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });

  await expect(page).toHaveURL(/\/verify-email\?/);
  const url = new URL(page.url());
  expect(url.searchParams.get('return_to')).toBe('/account/checkout?plan=basic&return_to=pricing');
  expect(registerRequests).toBe(1);
  expect(idempotencyKey.length).toBeGreaterThan(10);
});

test('STORY-VERIFY-001 Email verification preserves the original destination through Login', async ({ page }) => {
  let verifyRequests = 0;
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/verify-email') {
      verifyRequests += 1;
      await route.fulfill({
        status: 302,
        headers: { location: '/login?return_to=%2Faccount%2Fcredit' },
        body: '',
      });
      return;
    }
    return defaultApi(route);
  });

  await page.goto('/verify-email?token=verify-token&return_to=%2Faccount%2Fcredit');
  await expect(page).toHaveURL(/\/login\?return_to=/, { timeout: 5_000 });
  expect(new URL(page.url()).searchParams.get('return_to')).toBe('/account/credit');
  expect(verifyRequests).toBe(1);
});

test('STORY-PASSWORD-001 reset without a Token fails locally and keeps both Password fields', async ({ page }) => {
  let resetRequests = 0;
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/reset-password') resetRequests += 1;
    return defaultApi(route);
  });

  await page.goto('/reset-password');
  await page.getByLabel('新しいPassword').fill('story-password-123');
  await page.getByLabel('Password確認').fill('story-password-123');
  await page.getByRole('button', { name: 'Passwordを更新' }).click();
  await expect(page.getByRole('alert')).toContainText('RESET_TOKEN_REQUIRED');
  await expect(page.getByLabel('新しいPassword')).toHaveValue('story-password-123');
  expect(resetRequests).toBe(0);
});

test('STORY-2FA-001 session-based 2FA submits a Code without a legacy Challenge', async ({ page }) => {
  let requestBody: Record<string, unknown> = {};
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/two-factor/verify-totp') {
      requestBody = route.request().postDataJSON() as Record<string, unknown>;
      return json(route, { authenticated: true });
    }
    return defaultApi(route);
  });

  await page.goto('/auth/2fa');
  await page.getByLabel('認証Code').fill('123456');
  await page.getByRole('button', { name: '認証' }).click();
  await expect(page).toHaveURL(/\/app\/new$/);
  expect(requestBody.code).toBe('123456');
  expect(requestBody.trustDevice).toBe(true);
  expect(requestBody.challenge_id).toBeUndefined();
});

test('STORY-2FA-002 spaces are removed from the Code and the return path is restored', async ({ page }) => {
  let requestBody: Record<string, unknown> = {};
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/two-factor/verify-totp') {
      requestBody = route.request().postDataJSON() as Record<string, unknown>;
      return json(route, { authenticated: true });
    }
    return defaultApi(route);
  });

  await page.goto('/auth/2fa?return_to=%2Fapp%2Fprojects');
  await page.getByLabel('認証Code').fill('123 456');
  await page.getByRole('button', { name: '認証' }).click();
  await expect(page).toHaveURL(/\/app\/projects$/);
  expect(requestBody.code).toBe('123456');
  expect(requestBody.trustDevice).toBe(true);
  expect(requestBody.challenge_id).toBeUndefined();
});

test('STORY-ERROR-001 nested API errors show the actionable message and code', async ({ page }) => {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/sign-up/email') {
      return json(route, { error: { code: 'EMAIL_ALREADY_REGISTERED', message: 'このEmailは登録済みです。' } }, 409);
    }
    return defaultApi(route);
  });

  await page.goto('/register');
  await page.getByLabel('Email').fill('story@example.test');
  await page.getByLabel('Nickname').fill('Story User');
  await page.getByLabel('Password（12〜128文字）').fill('story-password-123');
  await page.getByLabel('Password確認').fill('story-password-123');
  await page.getByRole('button', { name: 'Account登録' }).click();
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('このEmailは登録済みです。');
  await expect(alert).toContainText('EMAIL_ALREADY_REGISTERED');
});

test('STORY-ERROR-002 a network failure keeps Login input and exposes a retryable error', async ({ page }) => {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/sign-in/email') return route.abort('connectionfailed');
    return defaultApi(route);
  });

  await page.goto('/login');
  await page.getByLabel('Email').fill('story@example.test');
  await page.getByLabel('Password').fill('story-password-123');
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('NETWORK_ERROR');
  await expect(page.getByLabel('Email')).toHaveValue('story@example.test');
  await expect(page.getByLabel('Password')).toHaveValue('story-password-123');
});

test('STORY-SETTINGS-001 failed preference loading disables overwrite', async ({ page }) => {
  let patchRequests = 0;
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/preferences' && request.method() === 'GET') {
      return json(route, { error: { code: 'PREFERENCE_SOURCE_UNAVAILABLE', message: '現在設定を取得できません。' } }, 503);
    }
    if (path === '/api/preferences' && request.method() === 'PATCH') patchRequests += 1;
    return defaultApi(route);
  });

  await page.goto('/app/settings/language');
  await expect(page.getByRole('alert')).toContainText('PREFERENCE_SOURCE_UNAVAILABLE');
  await expect(page.getByRole('button', { name: '保存' })).toBeDisabled();
  expect(patchRequests).toBe(0);
});

test('STORY-SETTINGS-002 failed preference save keeps the loaded values visible', async ({ page }) => {
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/preferences' && request.method() === 'GET') {
      return json(route, { preferences: { ui_language: 'ja-JP', theme: 'dark', reduced_motion: false } });
    }
    if (path === '/api/preferences' && request.method() === 'PATCH') {
      return json(route, { error: { code: 'PREFERENCE_VERSION_CONFLICT', message: '別端末で設定が更新されました。' } }, 409);
    }
    return defaultApi(route);
  });

  await page.goto('/app/settings/language');
  await expect(page.getByLabel('システム言語')).toHaveValue('ja-JP');
  await page.getByLabel('システム言語').fill('en-US');
  await page.getByRole('button', { name: '保存' }).click();
  await expect(page.getByRole('alert')).toContainText('PREFERENCE_VERSION_CONFLICT');
  await expect(page.getByLabel('システム言語')).toHaveValue('en-US');
});

test('STORY-RECOVERY-001 a transient account failure can be retried without reloading the page', async ({ page }) => {
  let accountRequests = 0;
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/account') {
      accountRequests += 1;
      if (accountRequests === 1) return json(route, { error: { code: 'ACCOUNT_TEMPORARILY_UNAVAILABLE', message: '一時的に確認できません。' } }, 503);
      return json(route, activeAccount());
    }
    return defaultApi(route);
  });

  await page.goto('/app/projects');
  await expect(page.getByRole('alert')).toContainText('ACCOUNT_TEMPORARILY_UNAVAILABLE');
  await page.getByRole('button', { name: '再確認' }).click();
  await expect(page.getByRole('heading', { name: 'Project' })).toBeVisible();
  await expect(page.getByText('Story Project')).toBeVisible();
  expect(accountRequests).toBe(2);
});

test('STORY-ROUTE-001 malformed encoded route parameters fail closed to Not Found', async ({ page }) => {
  await useDefaultApi(page);
  await page.goto('/s/%E0%A4%A', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Page Not Found' })).toBeVisible();
  await expect(page.locator('#root')).toBeVisible();
});
