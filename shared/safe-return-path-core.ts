const AUTH_RETURN_PATHS = new Set([
  '/login',
  '/register',
  '/verify-email',
  '/forgot-password',
  '/reset-password',
  '/account/password/setup',
  '/auth/2fa',
]);

function normalizePathname(pathname: string): string {
  if (!pathname || pathname === '/') return '/';
  const withoutTrailingSlash = pathname.replace(/\/+$/, '');
  return withoutTrailingSlash.startsWith('/') ? withoutTrailingSlash : `/${withoutTrailingSlash}`;
}

export function isAuthReturnPath(pathname: string): boolean {
  const normalized = normalizePathname(pathname);
  if (AUTH_RETURN_PATHS.has(normalized)) return true;
  return normalized.startsWith('/api/auth/callback/');
}

export type SafeReturnPathOptions = {
  requireAppPrefix?: boolean;
};

export function resolveSafeReturnPath(
  rawValue: string | null | undefined,
  origin: string,
  fallback = '/app/new',
  options: SafeReturnPathOptions = {},
): string {
  if (!rawValue) return fallback;
  try {
    const candidate = rawValue.startsWith('/') ? rawValue : decodeURIComponent(rawValue);
    if (!candidate.startsWith('/') || candidate.startsWith('//') || candidate.includes('\\') || /[\u0000-\u001f\u007f]/.test(candidate)) {
      return fallback;
    }
    const url = new URL(candidate, origin);
    if (url.origin !== new URL(origin).origin) return fallback;
    const pathname = normalizePathname(url.pathname);
    if (isAuthReturnPath(pathname)) return fallback;
    if (options.requireAppPrefix && pathname !== '/app' && !pathname.startsWith('/app/')) return fallback;
    return `${pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
