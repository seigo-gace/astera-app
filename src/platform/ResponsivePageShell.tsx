import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { useVerifiedAccountSession, previewWithoutAuth } from './account-session';
import { ApiError, apiRequest, asRecord, recordText } from './api-client';
import type { RouteMatch } from './route-registry';

const APP_NAV = [
  { href: '/app/new', label: '新しいページ', key: 'new' },
  { href: '/app/history?mode=search', label: '検索', key: 'search' },
  { href: '/app/projects', label: 'プロジェクト', key: 'projects' },
  { href: '/app/settings/options', label: 'オプション', key: 'options' },
  { href: '/account', label: 'プラン/クレジット', key: 'plan-credit' },
  { href: '/app/developer', label: '開発者モード', key: 'developer' },
  { href: '/app/history', label: '履歴', key: 'history' },
] as const;

const APP_BOTTOM_NAV = [
  { href: '/app/about', label: 'ASTERAとは？', key: 'about' },
  { href: '/app/settings', label: '設定', key: 'settings' },
] as const;

function Brand() {
  return (
    <a className="platform-brand" href="/app/new" aria-label="Astera App">
      <img src="/logo-mark.svg" alt="" style={{ filter: 'var(--logo-filter)' }} />
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

type CreditProjection =
  | { status: 'loading' }
  | { status: 'error' }
  | {
      status: 'ready';
      usable: number;
      reserved: number;
      state: 'healthy' | 'low' | 'critical' | 'depleted';
      capacity: number;
    };

function numeric(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function normalizeCreditState(value: unknown, usable: number): 'healthy' | 'low' | 'critical' | 'depleted' {
  const state = typeof value === 'string' ? value.toLowerCase() : '';
  if (usable <= 0 || state === 'depleted') return 'depleted';
  if (state === 'critical') return 'critical';
  if (state === 'low') return 'low';
  return 'healthy';
}

function useCreditProjection(enabled: boolean): CreditProjection {
  const [projection, setProjection] = useState<CreditProjection>(enabled ? { status: 'loading' } : { status: 'error' });

  const load = useCallback(async () => {
    if (!enabled) return;
    try {
      const [balancePayload, catalogPayload] = await Promise.all([
        apiRequest('/api/credit/balance'),
        apiRequest('/api/account/catalog'),
      ]);
      const balance = asRecord(balancePayload);
      const policy = asRecord(balance.policy);
      const usable = numeric(balance.usable_balance ?? balance.usableBalance);
      const reserved = numeric(balance.reserved_balance ?? balance.reservedBalance);
      const lowThreshold = numeric(policy.low_threshold ?? policy.lowThreshold);

      const catalog = asRecord(catalogPayload);
      const account = asRecord(catalog.account);
      const subscription = asRecord(catalog.subscription ?? account.subscription);
      const planId = recordText(subscription, ['plan_id', 'planId']);
      const plans = Array.isArray(catalog.plans) ? catalog.plans : [];
      let includedCredits = 0;
      for (const item of plans) {
        const plan = asRecord(item);
        if (recordText(plan, ['plan_id', 'id']) === planId) {
          includedCredits = numeric(plan.included_credits ?? plan.monthly_credits ?? plan.includedCredits);
          break;
        }
      }

      const capacity = Math.max(1, includedCredits, lowThreshold > 0 ? lowThreshold * 5 : 0, usable > 0 && includedCredits === 0 && lowThreshold === 0 ? usable : 0);
      setProjection({
        status: 'ready',
        usable,
        reserved,
        state: normalizeCreditState(balance.state, usable),
        capacity,
      });
    } catch {
      setProjection({ status: 'error' });
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    void load();
    const refresh = () => { if (document.visibilityState === 'visible') void load(); };
    const timer = window.setInterval(refresh, 5_000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [enabled, load]);

  return projection;
}

function CreditMeter({ enabled }: { enabled: boolean }) {
  const credit = useCreditProjection(enabled);
  if (!enabled) return null;

  if (credit.status !== 'ready') {
    return (
      <div className="platform-credit-layer" aria-live="polite">
        <div className={`platform-credit-meter is-${credit.status}`} aria-label={credit.status === 'loading' ? 'クレジット残高を確認中' : 'クレジット残高を取得できません'}>
          <span className="platform-credit-mark" aria-hidden="true" />
          <span className="platform-credit-title">CREDIT</span>
          <span className="platform-credit-track" aria-hidden="true"><span className="platform-credit-fill" /></span>
          <strong className="platform-credit-number">{credit.status === 'loading' ? '…' : '—'}</strong>
        </div>
      </div>
    );
  }

  const fill = credit.state === 'depleted' ? 0 : Math.max(3, Math.min(100, (credit.usable / credit.capacity) * 100));
  const meterStyle = { '--credit-fill': `${fill}%` } as CSSProperties;
  return (
    <div className="platform-credit-layer" aria-live="polite">
      <div
        className={`platform-credit-meter is-${credit.state}`}
        style={meterStyle}
        role="meter"
        aria-label={`利用可能クレジット ${credit.usable.toLocaleString('ja-JP')}`}
        aria-valuemin={0}
        aria-valuemax={credit.capacity}
        aria-valuenow={credit.usable}
        title={credit.reserved > 0 ? `予約中 ${credit.reserved.toLocaleString('ja-JP')}` : '利用可能クレジット'}
      >
        <span className="platform-credit-mark" aria-hidden="true" />
        <span className="platform-credit-title">CREDIT</span>
        <span className="platform-credit-track" aria-hidden="true"><span className="platform-credit-fill" /></span>
        <strong className="platform-credit-number">{Math.trunc(credit.usable).toLocaleString('ja-JP')}</strong>
      </div>
    </div>
  );
}

function useSession(required: boolean): SessionState {
  const verified = useVerifiedAccountSession();
  const preview = previewWithoutAuth();
  const [state, setState] = useState<SessionState>(
    preview || !required || verified
      ? { status: 'ready', displayName: verified?.displayName ?? (preview ? 'プレビュー' : '') }
      : { status: 'loading' },
  );

  useEffect(() => {
    if (preview || !required || verified) return;
    const controller = new AbortController();
    apiRequest('/api/account', { signal: controller.signal })
      .then((payload) => {
        const root = asRecord(payload);
        const account = asRecord(root.account ?? root.data ?? root);
        setState({
          status: 'ready',
          displayName: recordText(account, ['nickname', 'display_name', 'name', 'email'], 'アカウント'),
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
  }, [required, verified, preview]);

  if (preview || verified) {
    return { status: 'ready', displayName: verified?.displayName ?? 'プレビュー' };
  }

  return state;
}

function activeNavigationKey(): string {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  const mode = new URLSearchParams(window.location.search).get('mode');
  if (path === '/app/new' || path === '/app') return 'new';
  if (path === '/app/history' && mode === 'search') return 'search';
  if (path === '/app/history') return 'history';
  if (path === '/app/projects') return 'projects';
  if (path === '/app/developer') return 'developer';
  if (path === '/app/about') return 'about';
  if (path === '/app/settings') return 'settings';
  if (path === '/app/settings/language' || path === '/app/settings/notifications') return 'settings';
  if (
    path === '/app/settings/options'
    || path === '/app/settings/templates'
    || path === '/app/settings/storage-destinations'
    || path === '/app/settings/astera-storage'
    || path === '/app/settings/data-privacy'
  ) return 'options';
  if (path === '/account' || path.startsWith('/account/')) return 'plan-credit';
  return '';
}

function NavigationLinks({ onNavigate }: { onNavigate: () => void }) {
  const active = activeNavigationKey();
  return (
    <>
      <Brand />
      <nav className="platform-nav" aria-label="Astera App メニュー">
        {APP_NAV.map((item) => (
          <a key={item.key} href={item.href} aria-current={active === item.key ? 'page' : undefined} onClick={onNavigate}>
            <span>{item.label}</span>
          </a>
        ))}
      </nav>
      <div className="platform-side-meta">
        {APP_BOTTOM_NAV.map((item) => (
          <a key={item.key} href={item.href} aria-current={active === item.key ? 'page' : undefined} onClick={onNavigate}>
            <span>{item.label}</span>
          </a>
        ))}
      </div>
    </>
  );
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

  if (session.status === 'loading') return <BusyState label="アカウントとセッションを確認しています…" />;
  if (session.status === 'error') return <ErrorState error={session.error} onRetry={() => window.location.reload()} />;

  return (
    <div className={`platform-shell${fullWidth ? ' is-full-width' : ''}`}>
      <CreditMeter enabled={route.access === 'authenticated'} />

      {route.access === 'authenticated' && (
        <div className="platform-global-actions" aria-label="案内AIとアカウント">
          <span className="platform-ai-anchor" data-customer-ai-anchor="true" />
          <a className="platform-header-account" href="/account" aria-label="アカウント">◎</a>
        </div>
      )}

      <header className="platform-mobile-header">
        <button
          type="button"
          className="platform-menu-button"
          aria-expanded={menuOpen}
          aria-controls="platform-mobile-drawer"
          onClick={() => setMenuOpen((value) => !value)}
        >
          <span aria-hidden="true">☰</span><span className="sr-only">メニュー</span>
        </button>
        <span className="platform-mobile-header-center" aria-hidden="true" />
        <span className="platform-mobile-header-spacer" aria-hidden="true" />
      </header>

      <aside className="platform-sidebar">
        <NavigationLinks onNavigate={() => setMenuOpen(false)} />
      </aside>

      {menuOpen && (
        <>
          <button className="platform-backdrop" aria-label="メニューを閉じる" type="button" onClick={() => setMenuOpen(false)} />
          <aside id="platform-mobile-drawer" className="platform-mobile-drawer">
            <NavigationLinks onNavigate={() => setMenuOpen(false)} />
          </aside>
        </>
      )}

      <main className="platform-main">
        <section className="platform-page-head">
          <div>
            <div className="platform-eyebrow">{eyebrow ?? 'ASTERA APP'}</div>
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
          <a href="/login">ログイン</a>
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
