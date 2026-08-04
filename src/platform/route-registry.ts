export type RouteAccess = 'public' | 'guest' | 'authenticated' | 'provisional';
export type RouteGroup = 'entry' | 'auth' | 'app' | 'settings' | 'account' | 'developer' | 'share' | 'legal' | 'system';

export type CanonicalRoute = {
  id: string;
  pattern: string;
  title: string;
  group: RouteGroup;
  access: RouteAccess;
  nav?: 'new' | 'projects' | 'history' | 'settings' | 'account';
};

export type RouteMatch = CanonicalRoute & { params: Record<string, string> };

export const CANONICAL_ROUTE_COUNT = 43;

export const canonicalRoutes: readonly CanonicalRoute[] = [
  { id: 'root', pattern: '/', title: 'Astera App', group: 'entry', access: 'public' },
  { id: 'pricing', pattern: '/pricing', title: '料金・プラン', group: 'entry', access: 'public' },
  { id: 'login', pattern: '/login', title: 'Login', group: 'auth', access: 'guest' },
  { id: 'register', pattern: '/register', title: 'Account登録', group: 'auth', access: 'guest' },
  { id: 'verify-email', pattern: '/verify-email', title: 'Email確認', group: 'auth', access: 'provisional' },
  { id: 'forgot-password', pattern: '/forgot-password', title: 'Passwordを忘れた場合', group: 'auth', access: 'guest' },
  { id: 'reset-password', pattern: '/reset-password', title: 'Password再設定', group: 'auth', access: 'guest' },
  { id: 'password-setup', pattern: '/account/password/setup', title: 'Astera用Password設定', group: 'auth', access: 'provisional' },
  { id: 'two-factor', pattern: '/auth/2fa', title: '2FA Challenge', group: 'auth', access: 'provisional' },
  { id: 'app', pattern: '/app', title: 'Astera App', group: 'app', access: 'authenticated', nav: 'new' },
  { id: 'new-run', pattern: '/app/new', title: '新しい実行', group: 'app', access: 'authenticated', nav: 'new' },
  { id: 'result-detail', pattern: '/app/results/:id', title: 'Result詳細', group: 'app', access: 'authenticated' },
  { id: 'projects', pattern: '/app/projects', title: 'Project', group: 'app', access: 'authenticated', nav: 'projects' },
  { id: 'history', pattern: '/app/history', title: 'History', group: 'app', access: 'authenticated', nav: 'history' },
  { id: 'about', pattern: '/app/about', title: 'Asteraについて', group: 'app', access: 'authenticated' },
  { id: 'settings', pattern: '/app/settings', title: 'Settings', group: 'settings', access: 'authenticated', nav: 'settings' },
  { id: 'settings-options', pattern: '/app/settings/options', title: 'Option設定', group: 'settings', access: 'authenticated', nav: 'settings' },
  { id: 'settings-language', pattern: '/app/settings/language', title: '表示・言語', group: 'settings', access: 'authenticated', nav: 'settings' },
  { id: 'settings-templates', pattern: '/app/settings/templates', title: '個別Template管理', group: 'settings', access: 'authenticated', nav: 'settings' },
  { id: 'settings-storage-destinations', pattern: '/app/settings/storage-destinations', title: '外部Storage接続', group: 'settings', access: 'authenticated', nav: 'settings' },
  { id: 'settings-astera-storage', pattern: '/app/settings/astera-storage', title: 'Astera Storage', group: 'settings', access: 'authenticated', nav: 'settings' },
  { id: 'settings-data-privacy', pattern: '/app/settings/data-privacy', title: 'Data・Privacy', group: 'settings', access: 'authenticated', nav: 'settings' },
  { id: 'account', pattern: '/account', title: 'Account概要', group: 'account', access: 'authenticated', nav: 'account' },
  { id: 'account-security', pattern: '/account/security', title: 'Account Security', group: 'account', access: 'authenticated', nav: 'account' },
  { id: 'account-subscription', pattern: '/account/subscription', title: 'Plan・Subscription', group: 'account', access: 'authenticated', nav: 'account' },
  { id: 'account-credit', pattern: '/account/credit', title: 'Credit購入・Ledger', group: 'account', access: 'authenticated', nav: 'account' },
  { id: 'account-checkout', pattern: '/account/checkout', title: 'Checkout確認', group: 'account', access: 'authenticated', nav: 'account' },
  { id: 'billing-status', pattern: '/account/billing/status', title: 'Billing Status', group: 'account', access: 'authenticated', nav: 'account' },
  { id: 'developer', pattern: '/app/developer', title: 'Developer Mode', group: 'developer', access: 'authenticated' },
  { id: 'public-share', pattern: '/s/:token', title: 'Public Share', group: 'share', access: 'public' },
  { id: 'private-share', pattern: '/share/:id', title: 'Private Share', group: 'share', access: 'authenticated' },
  { id: 'shares', pattern: '/app/shares', title: 'Share管理', group: 'share', access: 'authenticated' },
  { id: 'legal', pattern: '/legal', title: '規約・法務', group: 'legal', access: 'public' },
  { id: 'legal-terms', pattern: '/legal/terms', title: '利用規約', group: 'legal', access: 'public' },
  { id: 'legal-privacy', pattern: '/legal/privacy', title: 'Privacy Policy', group: 'legal', access: 'public' },
  { id: 'legal-commercial', pattern: '/legal/commercial', title: '特定商取引法表記', group: 'legal', access: 'public' },
  { id: 'legal-api-terms', pattern: '/legal/api-terms', title: 'API Terms', group: 'legal', access: 'public' },
  { id: 'status', pattern: '/status', title: 'System Status', group: 'system', access: 'public' },
  { id: 'offline', pattern: '/offline', title: 'Offline', group: 'system', access: 'public' },
  { id: 'maintenance', pattern: '/maintenance', title: 'Maintenance', group: 'system', access: 'public' },
  { id: 'support', pattern: '/support', title: 'Support', group: 'system', access: 'public' },
  { id: 'settings-notifications', pattern: '/app/settings/notifications', title: '通知・Credit警告', group: 'settings', access: 'authenticated', nav: 'settings' },
  { id: 'not-found', pattern: '*', title: 'Page Not Found', group: 'system', access: 'public' },
] as const;

function normalizePathname(pathname: string): string {
  if (!pathname || pathname === '/') return '/';
  const withoutTrailingSlash = pathname.replace(/\/+$/, '');
  return withoutTrailingSlash.startsWith('/') ? withoutTrailingSlash : `/${withoutTrailingSlash}`;
}

function decodePathSegment(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function matchPattern(pattern: string, pathname: string): Record<string, string> | null {
  if (pattern === '*') return {};
  const patternParts = normalizePathname(pattern).split('/').filter(Boolean);
  const pathParts = normalizePathname(pathname).split('/').filter(Boolean);
  if (patternParts.length !== pathParts.length) return null;

  const params: Record<string, string> = {};
  for (let index = 0; index < patternParts.length; index += 1) {
    const expected = patternParts[index];
    const actual = pathParts[index];
    if (expected.startsWith(':')) {
      if (!actual) return null;
      const decoded = decodePathSegment(actual);
      if (decoded === null) return null;
      params[expected.slice(1)] = decoded;
      continue;
    }
    if (expected !== actual) return null;
  }
  return params;
}

export function matchCanonicalRoute(pathname: string): RouteMatch {
  const normalized = normalizePathname(pathname);
  for (const route of canonicalRoutes) {
    if (route.pattern === '*') continue;
    const params = matchPattern(route.pattern, normalized);
    if (params) return { ...route, params };
  }
  const fallback = canonicalRoutes.find((route) => route.pattern === '*');
  if (!fallback) throw new Error('ASTERA_NOT_FOUND_ROUTE_MISSING');
  return { ...fallback, params: {} };
}

export function safeReturnPath(rawValue: string | null | undefined, fallback = '/app/new'): string {
  if (!rawValue) return fallback;
  try {
    const candidate = rawValue.startsWith('/') ? rawValue : decodeURIComponent(rawValue);
    if (
      !candidate.startsWith('/')
      || candidate.startsWith('//')
      || candidate.includes('\\')
      || /[\u0000-\u001f\u007f]/.test(candidate)
    ) return fallback;
    const url = new URL(candidate, window.location.origin);
    if (url.origin !== window.location.origin) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
