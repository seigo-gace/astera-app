import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { ApiError, apiRequest, asArray, asRecord, recordText } from './api-client';
import { authClient, authErrorMessage } from './auth-client';
import './canonical-account-security-management.css';

type Feedback = { type: 'idle' | 'working' | 'success' | 'error'; message?: string; code?: string };
type SessionItem = { id: string; token: string; current: boolean; userAgent: string; ipAddress: string; createdAt: string; updatedAt: string; expiresAt: string };
type AccountItem = { providerId: string; accountId: string };

const routeKey = () => window.location.pathname.replace(/\/+$/, '') || '/';
const findHost = () => document.querySelector<HTMLElement>('.platform-page-content') ?? document.querySelector<HTMLElement>('.platform-main') ?? document.querySelector<HTMLElement>('main');

function authResult<T>(value: { data?: T | null; error?: unknown }, fallback: string): T {
  if (value.error) throw new ApiError(authErrorMessage(value.error, fallback), 400, recordText(asRecord(value.error), ['code'], 'AUTH_OPERATION_FAILED'), value.error);
  if (value.data == null) throw new ApiError(fallback, 502, 'AUTH_RESPONSE_EMPTY');
  return value.data;
}

function dateText(value: string): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function normalizeSessions(payload: unknown, projection: unknown): SessionItem[] {
  const currentIds = new Set(asArray(asRecord(asRecord(projection).security).sessions).filter((item) => asRecord(item).current === true).map((item) => recordText(asRecord(item), ['id'])));
  return asArray(payload).map((item) => {
    const source = asRecord(item);
    const id = recordText(source, ['id']);
    return {
      id,
      token: recordText(source, ['token']),
      current: currentIds.has(id),
      userAgent: recordText(source, ['userAgent', 'user_agent'], '不明な端末'),
      ipAddress: recordText(source, ['ipAddress', 'ip_address']),
      createdAt: recordText(source, ['createdAt', 'created_at']),
      updatedAt: recordText(source, ['updatedAt', 'updated_at']),
      expiresAt: recordText(source, ['expiresAt', 'expires_at']),
    };
  }).filter((item) => item.id && item.token);
}

function normalizeAccounts(payload: unknown): AccountItem[] {
  return asArray(payload).map((item) => {
    const source = asRecord(item);
    return { providerId: recordText(source, ['providerId', 'provider_id']), accountId: recordText(source, ['accountId', 'account_id', 'id']) };
  }).filter((item) => item.providerId);
}

function AccountSecurityManagementSurface() {
  const [feedback, setFeedback] = useState<Feedback>({ type: 'idle' });
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [accounts, setAccounts] = useState<AccountItem[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [sessionResult, accountResult, projection] = await Promise.all([
        authClient.listSessions(),
        authClient.listAccounts(),
        apiRequest('/api/account/security'),
      ]);
      setSessions(normalizeSessions(authResult(sessionResult, 'Session一覧を取得できませんでした。'), projection));
      setAccounts(normalizeAccounts(authResult(accountResult, 'Login連携一覧を取得できませんでした。')));
    } catch (error) {
      setFeedback({ type: 'error', message: error instanceof Error ? error.message : 'Security状態を取得できませんでした。', code: error instanceof ApiError ? error.code : 'SECURITY_MANAGEMENT_LOAD_FAILED' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const run = async (action: () => Promise<unknown>, success: string, code: string, after = true) => {
    setFeedback({ type: 'working' });
    try {
      await action();
      setFeedback({ type: 'success', message: success });
      if (after) await reload();
    } catch (error) {
      setFeedback({ type: 'error', message: error instanceof Error ? error.message : '操作に失敗しました。', code: error instanceof ApiError ? error.code : code });
    }
  };

  const changePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const currentPassword = String(data.get('current_password') ?? '');
    const newPassword = String(data.get('new_password') ?? '');
    const confirm = String(data.get('confirm_password') ?? '');
    if (newPassword !== confirm) { setFeedback({ type: 'error', message: '新しいPasswordの確認入力が一致しません。', code: 'PASSWORD_CONFIRMATION_MISMATCH' }); return; }
    await run(async () => { authResult(await authClient.changePassword({ currentPassword, newPassword, revokeOtherSessions: true }), 'Passwordを変更できませんでした。'); }, 'Passwordを変更し、他のSessionを失効しました。', 'PASSWORD_CHANGE_FAILED');
    form.reset();
  };

  const linkProvider = async (provider: 'google' | 'github') => {
    setFeedback({ type: 'working' });
    try {
      const result = await authClient.linkSocial({ provider, callbackURL: '/account/security' });
      if (result.error) throw new ApiError(authErrorMessage(result.error, `${provider}連携を開始できませんでした。`), 400, recordText(asRecord(result.error), ['code'], 'ACCOUNT_LINK_FAILED'), result.error);
      setFeedback({ type: 'success', message: `${provider}連携の認証画面へ進みます。` });
    } catch (error) {
      setFeedback({ type: 'error', message: error instanceof Error ? error.message : `${provider}連携を開始できませんでした。`, code: error instanceof ApiError ? error.code : 'ACCOUNT_LINK_FAILED' });
    }
  };

  const unlinkProvider = async (account: AccountItem) => {
    if (!window.confirm(`${account.providerId}連携を解除します。最後のLogin手段は解除できません。`)) return;
    await run(async () => { authResult(await authClient.unlinkAccount(account.accountId ? { providerId: account.providerId, accountId: account.accountId } : { providerId: account.providerId }), 'Login連携を解除できませんでした。'); }, `${account.providerId}連携を解除しました。`, 'ACCOUNT_UNLINK_FAILED');
  };

  const linked = new Map(accounts.map((item) => [item.providerId, item]));

  return <section className="security-management" data-canon-account-security-management="true">
    <header><div><h2>Account・Security 管理</h2><p>Password、Session、Google/GitHub Login連携を既存認証Runtimeで管理します。</p></div><button type="button" className="platform-button" onClick={() => void reload()} disabled={loading}>再読込</button></header>

    {feedback.type !== 'idle' && <div className={`security-management-feedback is-${feedback.type}`} role={feedback.type === 'error' ? 'alert' : 'status'}><strong>{feedback.type === 'working' ? '処理しています…' : feedback.message}</strong>{feedback.code && <code>{feedback.code}</code>}</div>}

    <div className="security-management-grid">
      <section className="security-management-card"><h3>Password変更</h3><p>変更時は他のSessionも失効します。12〜128文字。</p><form className="security-management-form" onSubmit={changePassword}><label><span>現在のPassword</span><input name="current_password" type="password" autoComplete="current-password" required /></label><label><span>新しいPassword</span><input name="new_password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required /></label><label><span>新しいPassword（確認）</span><input name="confirm_password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required /></label><button className="platform-button is-primary" type="submit" disabled={feedback.type === 'working'}>Passwordを変更</button></form></section>

      <section className="security-management-card"><h3>Login連携</h3><p>Google / GitHubを追加・解除します。最後のLogin手段は解除しません。</p><div className="security-provider-list">{(['google','github'] as const).map((provider) => { const account = linked.get(provider); return <div key={provider}><div><strong>{provider === 'google' ? 'Google' : 'GitHub'}</strong><small>{account ? '連携済み' : '未連携'}</small></div>{account ? <button type="button" className="platform-button" onClick={() => void unlinkProvider(account)} disabled={feedback.type === 'working'}>解除</button> : <button type="button" className="platform-button" onClick={() => void linkProvider(provider)} disabled={feedback.type === 'working'}>連携</button>}</div>; })}</div></section>
    </div>

    <section className="security-management-card"><div className="security-management-card-head"><div><h3>Session一覧</h3><p>Token本文は表示せず、端末情報と期限だけ表示します。</p></div><span>{sessions.length}件</span></div>{loading ? <p>Sessionを確認しています…</p> : sessions.length === 0 ? <p>有効なSessionを確認できませんでした。</p> : <ul className="security-session-list">{sessions.map((session) => <li key={session.id}><div><strong>{session.current ? 'この端末' : session.userAgent}</strong><span>{session.ipAddress || 'IP非表示'} · 更新 {dateText(session.updatedAt)}</span><small>有効期限 {dateText(session.expiresAt)} / ID {session.id.slice(0, 8)}…</small></div><button className="platform-button" type="button" disabled={session.current || feedback.type === 'working'} onClick={() => void run(async () => { authResult(await authClient.revokeSession({ token: session.token }), 'Sessionを失効できませんでした。'); }, 'Sessionを失効しました。', 'SESSION_REVOKE_FAILED')}>{session.current ? '現在使用中' : '失効'}</button></li>)}</ul>}<div className="security-session-actions"><button type="button" className="platform-button" disabled={feedback.type === 'working'} onClick={() => void run(async () => { authResult(await authClient.revokeOtherSessions(), '他のSessionを失効できませんでした。'); }, 'この端末以外のSessionを失効しました。', 'OTHER_SESSIONS_REVOKE_FAILED')}>他のSessionを全て失効</button><button type="button" className="platform-button is-danger" disabled={feedback.type === 'working'} onClick={() => { if (window.confirm('全Sessionを失効してLogin画面へ戻ります。')) void run(async () => { authResult(await authClient.revokeSessions(), '全Sessionを失効できませんでした。'); window.location.assign('/login'); }, '全Sessionを失効しました。', 'ALL_SESSIONS_REVOKE_FAILED', false); }}>全Sessionを失効</button></div></section>

    <section className="security-management-card is-muted"><h3>Security Event</h3><p>Security Event履歴Backendは現Repositoryで未接続です。未実施を履歴表示として偽装しません。</p><button type="button" className="platform-button" disabled aria-disabled="true">Security Event（未接続）</button></section>
  </section>;
}

export function CanonicalAccountSecurityManagement() {
  const [state, setState] = useState(() => ({ route: routeKey(), host: findHost() }));
  useEffect(() => {
    const sync = () => setState((current) => { const next={ route: routeKey(), host: findHost() }; return current.route===next.route&&current.host===next.host?current:next; });
    const observer = new MutationObserver(sync); observer.observe(document.documentElement,{childList:true,subtree:true}); window.addEventListener('popstate',sync); sync();
    return () => { observer.disconnect(); window.removeEventListener('popstate',sync); };
  },[]);
  useEffect(() => { document.documentElement.classList.toggle('security-management-active', state.route === '/account/security' && Boolean(state.host)); return () => document.documentElement.classList.remove('security-management-active'); }, [state]);
  if (state.route !== '/account/security' || !state.host) return null;
  return createPortal(<AccountSecurityManagementSurface />, state.host);
}
