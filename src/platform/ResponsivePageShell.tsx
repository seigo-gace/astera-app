import { useEffect, useState, type ReactNode } from 'react';
import { ApiError, apiRequest, asRecord, recordText } from './api-client';
import type { RouteMatch } from './route-registry';

const APP_NAV = [
  { href: '/app/new', label: '新しい実行', key: 'new' },
  { href: '/app/projects', label: 'Project', key: 'projects' },
  { href: '/app/history', label: 'History', key: 'history' },
  { href: '/app/settings', label: 'Settings', key: 'settings' },
  { href: '/account', label: 'Account', key: 'account' },
] as const;

function Brand() {
  return (
    <a className="platform-brand" href="/app/new" aria-label="Astera App">
      <img src="/logo-mark.svg" alt="" />
      <span><strong>ASTERA</strong><small>APP</small></span>
    </a>
  );
}

export function BusyState({ label = '確認しています…' }: { label?: string }) {
  return <div className="platform-state" role="status"><span className="platform-spinner" />{label}</div>;
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const code = error instanceof ApiError ? error.code : 'UNKNOWN_ERROR';
  const message = error instanceof Error ? error.message : '処理に失敗しました。';
  return (
    <div className="platform-state is-error" role="alert">
      <strong>処理を完了できませんでした</strong>
      <p>{message}</p>
      <code>{code}</code>
      {onRetry && <button type="button" className="platform-button" onClick={onRetry}>再確認</button>}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="platform-state">{children}</div>;
}

type SessionState =
  | { status: 'loading' }
  | { status: 'ready'; displayName: string }
  | { status: 'error'; error: unknown };

function useSession(required: boolean): SessionState {
  const [state, setState] = useState<SessionState>(required ? { status: 'loading' } : { status: 'ready', displayName: '' });

  useEffect(() => {
    if (!required) return;
    const controller = new AbortController();
    apiRequest('/api/account', { signal: controller.signal })
      .then((payload) => {
        const root = asRecord(payload);
        const account = asRecord(root.account ?? root.data ?? root);
        setState({
          status: 'ready',
          displayName: recordText(account, ['nickname', 'display_name', 'name', 'email'], 'Account'),
        });
      })
      .catch((error: unknown) => {
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
          const returnTo = encodeURIComponent(window.location.pathname + window.location.search + window.location.hash);
          window.location.replace(`/login?return_to=${returnTo}`);
          return;
        }
        if (!controller.signal.aborted) setState({ status: 'error', error });
      });
    return () => controller.abort();
  }, [required]);

  return state;
}

export function ResponsivePageShell({
  route,
  children,
  eyebrow,
  description,
  actions,
  fullWidth = false,
}: {
  route: RouteMatch;
  children: ReactNode;
  eyebrow?: string;
  description?: string;
  actions?: ReactNode;
  fullWidth?: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const session = useSession(route.access === 'authenticated');

  useEffect(() => {
    document.title = `${route.title} | Astera App`;
    setMenuOpen(false);
  }, [route.id, route.title]);

  if (session.status === 'loading') return <BusyState label="AccountとSessionを確認しています…" />;
  if (session.status === 'error') return <ErrorState error={session.error} onRetry={() => window.location.reload()} />;

  const nav = (
    <>
      <Brand />
      <nav className="platform-nav" aria-label="Astera App navigation">
        {APP_NAV.map((item) => (
          <a
            key={item.key}
            href={item.href}
            aria-current={route.nav === item.key ? 'page' : undefined}
            onClick={() => setMenuOpen(false)}
          >
            <span>{item.label}</span>
          </a>
        ))}
      </nav>
      <div className="platform-side-meta">
        {session.displayName && <span className="platform-account-name">{session.displayName}</span>}
        <a href="/app/about">Asteraについて</a>
        <a href="/legal">規約・Privacy</a>
        <a href="/status">System Status</a>
      </div>
    </>
  );

  return (
    <div className={`platform-shell${fullWidth ? ' is-full-width' : ''}`}>
      <header className="platform-mobile-header">
        <button
          type="button"
          className="platform-menu-button"
          aria-expanded={menuOpen}
          aria-controls="platform-mobile-drawer"
          onClick={() => setMenuOpen((value) => !value)}
        >
          <span aria-hidden="true">☰</span><span className="sr-only">Menu</span>
        </button>
        <Brand />
        <a className="platform-header-account" href="/account" aria-label="Account">◎</a>
      </header>

      <aside className="platform-sidebar">{nav}</aside>

      {menuOpen && (
        <>
          <button className="platform-backdrop" aria-label="Menuを閉じる" type="button" onClick={() => setMenuOpen(false)} />
          <aside id="platform-mobile-drawer" className="platform-mobile-drawer">{nav}</aside>
        </>
      )}

      <main className="platform-main">
        <section className="platform-page-head">
          <div>
            <div className="platform-eyebrow">{eyebrow ?? route.group.toUpperCase()}</div>
            <h1>{route.title}</h1>
            {description && <p>{description}</p>}
          </div>
          {actions && <div className="platform-head-actions">{actions}</div>}
        </section>
        <div className="platform-page-content">{children}</div>
      </main>
    </div>
  );
}

export function PublicPageFrame({
  route,
  children,
  description,
  actions,
}: {
  route: RouteMatch;
  children: ReactNode;
  description?: string;
  actions?: ReactNode;
}) {
  useEffect(() => {
    document.title = `${route.title} | Astera App`;
  }, [route.title]);

  return (
    <main className="platform-public-page">
      <header className="platform-public-header">
        <Brand />
        <nav>
          <a href="/pricing">料金</a>
          <a href="/login">Login</a>
          <a href="/register">登録</a>
        </nav>
      </header>
      <section className="platform-public-hero">
        <div className="platform-eyebrow">ASTERA APP</div>
        <h1>{route.title}</h1>
        {description && <p>{description}</p>}
        {actions && <div className="platform-head-actions">{actions}</div>}
      </section>
      <div className="platform-public-content">{children}</div>
    </main>
  );
}
