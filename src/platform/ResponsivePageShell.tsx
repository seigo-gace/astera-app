import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { useVerifiedAccountSession } from './account-session';
import { ApiError, apiRequest, asArray, asRecord, recordText } from './api-client';
import type { RouteMatch } from './route-registry';

const APP_NAV = [
  { href: '/app/new', label: '新しい実行', key: 'new' },
  { href: '/app/projects', label: 'Project', key: 'projects' },
  { href: '/app/history', label: 'History', key: 'history' },
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

type SidebarRecentItem = {
  id: string;
  title: string;
  href: string;
};

type SidebarRecentState =
  | { status: 'loading'; items: SidebarRecentItem[] }
  | { status: 'ready'; items: SidebarRecentItem[] }
  | { status: 'error'; items: SidebarRecentItem[] };

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

function useSidebarRecent(enabled: boolean): SidebarRecentState {
  const [state, setState] = useState<SidebarRecentState>({ status: enabled ? 'loading' : 'ready', items: [] });

  useEffect(() => {
    if (!enabled) {
      setState({ status: 'ready', items: [] });
      return;
    }
    const controller = new AbortController();
    setState({ status: 'loading', items: [] });
    apiRequest('/api/history?limit=6', { signal: controller.signal })
      .then((payload) => {
        const items = asArray(payload, ['history', 'items', 'results'])
          .slice(0, 6)
          .map((item, index) => {
            const record = asRecord(item);
            const id = recordText(record, ['result_id', 'id']);
            if (!id) return null;
            const title = recordText(record, ['title', 'prompt', 'name'], `Result ${index + 1}`);
            return { id, title, href: `/app/results/${encodeURIComponent(id)}` } satisfies SidebarRecentItem;
          })
          .filter((item): item is SidebarRecentItem => item !== null);
        setState({ status: 'ready', items });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: 'error', items: [] });
      });
    return () => controller.abort();
  }, [enabled]);

  return state;
}

function CreditMeter({ enabled }: { enabled: boolean }) {
  const credit = useCreditProjection(enabled);
  if (!enabled) return null;

  if (credit.status !== 'ready') {
    return (
      <div className="platform-credit-layer" aria-live="polite">
        <div className={`platform-credit-meter is-${credit.status}`} aria-label={credit.status === 'loading' ? 'Credit残高を確認中' : 'Credit残高を取得できません'}>
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
        aria-label={`利用可能Credit ${credit.usable.toLocaleString('ja-JP')}`}
        aria-valuemin={0}
        aria-valuemax={credit.capacity}
        aria-valuenow={credit.usable}
        title={credit.reserved > 0 ? `予約中 ${credit.reserved.toLocaleString('ja-JP')}` : '利用可能Credit'}
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
  const [state, setState] = useState<SessionState>(required && !verified ? { status: 'loading' } : { status: 'ready', displayName: verified?.displayName ?? '' });

  useEffect(() => {
    if (!required || verified) return;
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
  }, [required, verified]);

  return verified ? { status: 'ready', displayName: verified.displayName } : state;
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
  const recent = useSidebarRecent(route.access === 'authenticated');

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
      <section className="platform-side-section" aria-label="Recent history">
        <div className="platform-side-section-title">Recent</div>
        <div className="platform-recent-list">
          {recent.status === 'loading' && <span className="platform-recent-state">読み込み中…</span>}
          {recent.status === 'error' && <a className="platform-recent-state" href="/app/history" onClick={() => setMenuOpen(false)}>Historyを開く</a>}
          {recent.status === 'ready' && recent.items.length === 0 && <span className="platform-recent-state">まだ履歴がありません</span>}
          {recent.status === 'ready' && recent.items.map((item) => (
            <a key={item.id} href={item.href} title={item.title} onClick={() => setMenuOpen(false)}>
              <span>{item.title}</span>
            </a>
          ))}
        </div>
      </section>
      <div className="platform-side-meta">
        <a href="/app/about" onClick={() => setMenuOpen(false)}>Asteraについて</a>
        <button type="button" className="exterior-settings-trigger" data-exterior-settings-trigger="true">⚙ Settings</button>
        <a href="/account" className="exterior-account-row" onClick={() => setMenuOpen(false)}>
          <span aria-hidden="true">◎</span>
          <span><strong>{session.displayName || 'Account'}</strong><small>Account・Plan・Security</small></span>
        </a>
      </div>
    </>
  );

  return (
    <div className={`platform-shell${fullWidth ? ' is-full-width' : ''}`}>
      <CreditMeter enabled={route.access === 'authenticated'} />
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
        <span className="platform-mobile-header-center" aria-hidden="true" />
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
