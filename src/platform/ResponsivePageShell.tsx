import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useAppText } from '../app-text';
import { useVerifiedAccountSession, previewWithoutAuth } from './account-session';
import { ApiError, apiRequest, asArray, asRecord, recordText } from './api-client';
import { usePlatformText } from './platform-text';
import type { RouteMatch } from './route-registry';
import { SettingsSurface } from '../features/settings/SettingsSurface';

const APP_NAV = [
  { href: '/app/new', label: 'navNew', key: 'new' },
  { href: '/app/projects', label: 'navProjects', key: 'projects' },
  { href: '/app/settings/options', label: 'navOptions', key: 'options' },
  { href: '/app/plan-credit', label: 'navPlanCredit', key: 'plan-credit' },
  { href: '/app/developer', label: 'navDeveloper', key: 'developer' },
  { href: '/app/history', label: 'navHistory', key: 'history' },
] as const;

function focusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'))
    .filter((node) => {
      if (node.hasAttribute('hidden') || node.getAttribute('aria-hidden') === 'true') return false;
      const style = window.getComputedStyle(node);
      return style.display !== 'none' && style.visibility !== 'hidden';
    });
}

function Brand() {
  return (
    <a className="platform-brand" href="/app/new" aria-label="ASTERA">
      <img src="/logo-mark.svg" alt="" style={{ filter: 'var(--logo-filter)' }} />
      <span><strong>ASTERA</strong></span>
    </a>
  );
}

export function BusyState({ label }: { label?: string }) {
  const { text } = usePlatformText();
  return <div className="platform-state" role="status"><span className="platform-spinner" />{label ?? text('checking')}</div>;
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { text } = usePlatformText();
  const code = error instanceof ApiError ? error.code : 'UNKNOWN_ERROR';
  const message = error instanceof Error ? error.message : text('processFailed');
  return (
    <div className="platform-state is-error" role="alert">
      <strong>{text('processFailedTitle')}</strong>
      <p>{message}</p>
      <code>{code}</code>
      {onRetry && <button type="button" className="platform-button" onClick={onRetry}>{text('retry')}</button>}
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
  | { status: 'ready'; usable: number; reserved: number; state: 'healthy' | 'low' | 'critical' | 'depleted'; capacity: number };

type SidebarRecentItem = { id: string; title: string; href: string };
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
      const [balancePayload, catalogPayload] = await Promise.all([apiRequest('/api/credit/balance'), apiRequest('/api/account/catalog')]);
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
      setProjection({ status: 'ready', usable, reserved, state: normalizeCreditState(balance.state, usable), capacity });
    } catch { setProjection({ status: 'error' }); }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    void load();
    const refresh = () => { if (document.visibilityState === 'visible') void load(); };
    const timer = window.setInterval(refresh, 5_000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [enabled, load]);
  return projection;
}

function useSidebarRecent(enabled: boolean): SidebarRecentState {
  const [state, setState] = useState<SidebarRecentState>({ status: enabled ? 'loading' : 'ready', items: [] });
  useEffect(() => {
    if (!enabled) { setState({ status: 'ready', items: [] }); return; }
    const controller = new AbortController();
    setState({ status: 'loading', items: [] });
    apiRequest('/api/history?limit=6', { signal: controller.signal })
      .then((payload) => {
        const items = asArray(payload, ['history', 'items', 'results']).slice(0, 6).map((item, index) => {
          const record = asRecord(item);
          const id = recordText(record, ['result_id', 'id']);
          if (!id) return null;
          const title = recordText(record, ['title', 'prompt', 'name'], `Result ${index + 1}`);
          return { id, title, href: `/app/results/${encodeURIComponent(id)}` } satisfies SidebarRecentItem;
        }).filter((item): item is SidebarRecentItem => item !== null);
        setState({ status: 'ready', items });
      })
      .catch(() => { if (!controller.signal.aborted) setState({ status: 'error', items: [] }); });
    return () => controller.abort();
  }, [enabled]);
  return state;
}

function CreditMeter({ enabled }: { enabled: boolean }) {
  const credit = useCreditProjection(enabled);
  const { locale, text } = usePlatformText();
  if (!enabled) return null;
  if (credit.status !== 'ready') {
    const displayValue = credit.status === 'loading' ? '…' : '0 C';
    return <div className="platform-credit-layer" aria-live="polite"><a href="/app/plan-credit" className={`platform-credit-meter is-${credit.status}`} aria-label={credit.status === 'loading' ? text('creditLoading') : text('creditUnavailable')}><span className="platform-credit-mark" aria-hidden="true" /><span className="platform-credit-title">CREDIT</span><span className="platform-credit-track" aria-hidden="true"><span className="platform-credit-fill" /></span><strong className="platform-credit-number">{displayValue}</strong></a></div>;
  }
  const fill = credit.state === 'depleted' ? 0 : Math.max(3, Math.min(100, (credit.usable / credit.capacity) * 100));
  const meterStyle = { '--credit-fill': `${fill}%` } as CSSProperties;
  const creditLabel = `${Math.trunc(credit.usable).toLocaleString(locale)} C`;
  return <div className="platform-credit-layer" aria-live="polite"><a href="/app/plan-credit" className={`platform-credit-meter is-${credit.state}`} style={meterStyle} role="meter" aria-label={`${text('usableCredit')} ${creditLabel}`} aria-valuemin={0} aria-valuemax={credit.capacity} aria-valuenow={credit.usable} title={credit.reserved > 0 ? `${text('reservedCredit')} ${credit.reserved.toLocaleString(locale)} C` : `${text('usableCredit')} ${creditLabel}`}><span className="platform-credit-mark" aria-hidden="true" /><span className="platform-credit-title">CREDIT</span><span className="platform-credit-track" aria-hidden="true"><span className="platform-credit-fill" /></span><strong className="platform-credit-number">{creditLabel}</strong></a></div>;
}

function useSession(required: boolean): SessionState {
  const verified = useVerifiedAccountSession();
  const preview = previewWithoutAuth();
  const [state, setState] = useState<SessionState>(preview || !required || verified ? { status: 'ready', displayName: verified?.displayName ?? (preview ? 'Preview' : '') } : { status: 'loading' });
  useEffect(() => {
    if (preview || !required || verified) return;
    const controller = new AbortController();
    apiRequest('/api/account', { signal: controller.signal }).then((payload) => {
      const root = asRecord(payload); const account = asRecord(root.account ?? root.data ?? root);
      setState({ status: 'ready', displayName: recordText(account, ['nickname', 'display_name', 'name', 'email'], 'Account') });
    }).catch((error: unknown) => {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        const returnTo = encodeURIComponent(window.location.pathname + window.location.search + window.location.hash);
        window.location.replace(`/login?return_to=${returnTo}`); return;
      }
      if (!controller.signal.aborted) setState({ status: 'error', error });
    });
    return () => controller.abort();
  }, [required, verified, preview]);
  if (preview || verified) return { status: 'ready', displayName: verified?.displayName ?? 'Preview' };
  return state;
}

function openGuideAi() {
  const ui = (window as Window & { AsteraCustomerAIUI?: { open?: () => void } }).AsteraCustomerAIUI;
  ui?.open?.();
}

function openResultOrganization() {
  const details = document.querySelector<HTMLDetailsElement>('.result-organization-menu, .result-summary-actions .result-more');
  if (!details) return;
  details.open = !details.open;
}

function openEvidenceList() {
  const toggle = document.querySelector<HTMLElement>('.result-source-toggle');
  const panel = toggle?.closest<HTMLElement>('.platform-panel');
  panel?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export function ResponsivePageShell({ route, children, eyebrow, description, actions, fullWidth = false }: { route: RouteMatch; children: ReactNode; eyebrow?: string; description?: string; actions?: ReactNode; fullWidth?: boolean }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsTriggerRef = useRef<HTMLButtonElement>(null);
  const settingsPanelRef = useRef<HTMLElement>(null);
  const settingsReturnFocusRef = useRef<HTMLElement | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const session = useSession(route.access === 'authenticated');
  const recent = useSidebarRecent(route.access === 'authenticated');
  const { text: appText } = useAppText();
  const { text: platformText, routeTitle } = usePlatformText();
  const localizedTitle = routeTitle(route.id, route.title);
  const isResultRoute = route.id === 'result-detail';

  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
    const target = settingsReturnFocusRef.current ?? settingsTriggerRef.current;
    settingsReturnFocusRef.current = null;
    window.requestAnimationFrame(() => {
      if (target?.isConnected) {
        target.focus();
        return;
      }
      if (settingsTriggerRef.current?.isConnected) {
        settingsTriggerRef.current.focus();
        return;
      }
      menuButtonRef.current?.focus();
    });
  }, []);

  const openSettings = useCallback((trigger?: HTMLElement | null) => {
    settingsReturnFocusRef.current = trigger ?? settingsTriggerRef.current;
    setMenuOpen(false);
    setSettingsOpen(true);
  }, []);

  useEffect(() => { document.title = `${localizedTitle} | ASTERA`; setMenuOpen(false); }, [localizedTitle, route.id]);

  useEffect(() => {
    if (!settingsOpen) return;
    document.documentElement.classList.add('exterior-settings-open');
    window.requestAnimationFrame(() => focusableElements(settingsPanelRef.current ?? document.body)[0]?.focus());
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      const panel = settingsPanelRef.current;
      if (!panel) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        closeSettings();
        return;
      }
      if (event.key !== 'Tab') return;
      if (!panel.contains(document.activeElement)) return;
      const focusable = focusableElements(panel);
      if (!focusable.length) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.documentElement.classList.remove('exterior-settings-open');
    };
  }, [settingsOpen, closeSettings]);
  if (session.status === 'loading') return <BusyState label={platformText('accountSessionChecking')} />;
  if (session.status === 'error') return <ErrorState error={session.error} onRetry={() => window.location.reload()} />;

  const nav = <>
    <Brand />
    <nav className="platform-nav" aria-label={platformText('appNavigation')}>
      {APP_NAV.map((item) => <a key={item.key} href={item.href} aria-current={route.nav === item.key ? 'page' : undefined} onClick={() => setMenuOpen(false)}><span>{appText(item.label)}</span></a>)}
    </nav>
    <section className="platform-side-section" aria-label={appText('recent')}>
      <div className="platform-side-section-title">{appText('recent')}</div>
      <div className="platform-recent-list">
        {recent.status === 'loading' && <span className="platform-recent-state">{appText('recentLoading')}</span>}
        {recent.status === 'error' && <a className="platform-recent-state" href="/app/history" onClick={() => setMenuOpen(false)}>{appText('openHistory')}</a>}
        {recent.status === 'ready' && recent.items.length === 0 && <span className="platform-recent-state">{appText('recentEmpty')}</span>}
        {recent.status === 'ready' && recent.items.map((item) => <a key={item.id} href={item.href} title={item.title} onClick={() => setMenuOpen(false)}><span>{item.title}</span></a>)}
      </div>
    </section>
    <div className="platform-side-meta">
      <a href="/app/about" onClick={() => setMenuOpen(false)}>{appText('navAbout')}</a>
      <button
        type="button"
        ref={settingsTriggerRef}
        className="exterior-settings-trigger"
        onClick={(event) => { openSettings(event.currentTarget); setMenuOpen(false); }}
      >
        {appText('navSettings')}
      </button>
    </div>
  </>;

  const settingsOverlay = settingsOpen ? <>
    <button
      type="button"
      className="exterior-settings-backdrop"
      aria-label={appText('closeMenu')}
      tabIndex={-1}
      data-exterior-settings-overlay="true"
      onClick={closeSettings}
    />
    <section
      ref={settingsPanelRef}
      className="exterior-settings-panel"
      role="dialog"
      aria-modal="true"
      aria-label={appText('settingsTitle')}
    >
      <header>
        <div>
          <strong>{appText('settingsTitle')}</strong>
          <small>ASTERA</small>
        </div>
        <button type="button" aria-label={appText('closeMenu')} onClick={closeSettings}>×</button>
      </header>
      <div className="settings-surface-host">
        <SettingsSurface
          variant="overlay"
          onNavigate={() => { closeSettings(); setMenuOpen(false); }}
        />
      </div>
    </section>
  </> : null;

  return <div className={`platform-shell${fullWidth ? ' is-full-width' : ''}`}>
    <CreditMeter enabled={route.access === 'authenticated'} />
    <header className="platform-mobile-header">
      <div className="platform-mobile-header-left">
        <button type="button" ref={menuButtonRef} className="platform-menu-button" aria-expanded={menuOpen} aria-controls="platform-mobile-drawer" aria-label={appText('openMenu')} onClick={() => setMenuOpen((value) => !value)}><span aria-hidden="true">☰</span><span className="sr-only">{appText('openMenu')}</span></button>
      </div>
      <span className="platform-mobile-header-center" aria-hidden="true" />
      <span className="platform-mobile-account-actions">
        <button className="platform-header-ai" type="button" onClick={openGuideAi} aria-label={appText('openGuideAi')}><img src="/guide-ai.png?v=ai-guide-20260822-2" alt="" aria-hidden="true" /></button>
        <span className="platform-main-evidence-toggle" role="group" aria-label={platformText('headerToggleAria')}>
          <a className={!isResultRoute ? 'is-active' : undefined} href="/app/new" aria-current={!isResultRoute ? 'page' : undefined}>{platformText('headerPage')}</a>
          <button type="button" className={isResultRoute ? 'is-active' : undefined} disabled={!isResultRoute} aria-disabled={!isResultRoute} onClick={openEvidenceList}>{platformText('headerEvidence')}</button>
        </span>
        <button className="platform-header-organize" type="button" onClick={openResultOrganization} aria-label={platformText('organizeResultAria')} title={platformText('organizeResultTitle')}><svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 1-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" /></svg></button>
      </span>
    </header>
    <aside className="platform-sidebar">{nav}</aside>
    {menuOpen && <><button className="platform-backdrop" aria-label={appText('closeMenu')} type="button" onClick={() => setMenuOpen(false)} /><aside id="platform-mobile-drawer" className="platform-mobile-drawer">{nav}</aside></>}
    {settingsOverlay}
    <main className="platform-main">
      <section className="platform-page-head"><div><div className="platform-eyebrow">{eyebrow ?? route.group.toUpperCase()}</div><h1>{localizedTitle}</h1>{description && <p>{description}</p>}</div>{actions && <div className="platform-head-actions">{actions}</div>}</section>
      <div className="platform-page-content">{children}</div>
    </main>
  </div>;
}

export function PublicPageFrame({ route, children, description, actions }: { route: RouteMatch; children: ReactNode; description?: string; actions?: ReactNode }) {
  const { text, routeTitle } = usePlatformText();
  const localizedTitle = routeTitle(route.id, route.title);
  useEffect(() => { document.title = `${localizedTitle} | Astera App`; }, [localizedTitle]);
  return <main className="platform-public-page"><header className="platform-public-header"><Brand /><nav><a href="/pricing">{text('publicPricing')}</a><a href="/login">{text('publicLogin')}</a><a href="/register">{text('publicRegister')}</a></nav></header><section className="platform-public-hero"><div className="platform-eyebrow">ASTERA APP</div><h1>{localizedTitle}</h1>{description && <p>{description}</p>}{actions && <div className="platform-head-actions">{actions}</div>}</section><div className="platform-public-content">{children}</div></main>;
}
