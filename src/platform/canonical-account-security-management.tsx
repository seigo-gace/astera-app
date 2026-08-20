import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, apiRequest, asArray, asRecord, recordText } from './api-client';
import { authClient, authErrorMessage } from './auth-client';
import './canonical-account-security-management.css';

type Feedback = { type: 'idle' | 'working' | 'success' | 'error'; message?: string; code?: string };
type SessionItem = { id: string; token: string; current: boolean; userAgent: string; ipAddress: string; createdAt: string; updatedAt: string; expiresAt: string };
type AccountItem = { providerId: string; accountId: string };

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
  const currentIds = new Set(asArray(asRecord(asRecord(projection).security).sessions)
    .filter((item) => asRecord(item).current === true)
    .map((item) => recordText(asRecord(item), ['id'])));
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

export function AccountSecurityManagementSurface({ disabled = false }: { disabled?: boolean }) {
  const [feedback, setFeedback] = useState<Feedback>({ type: 'idle' });
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [accounts, setAccounts] = useState<AccountItem[]>([]);
  const [loading, setLoading] = useState(!disabled);

  const reload = useCallback(async () => {
    if (disabled) {
      setSessions([]);
      setAccounts([]);
      setLoading(false);
      return;
    }
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
  }, [disabled]);

  useEffect(() => { void reload(); }, [reload]);

  const run = async (action: () => Promise<unknown>, success: string, code: string, after = true) => {
    if (disabled) return;
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
    if (disabled) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const currentPassword = String(data.get('current_password') ?? '');
    const newPassword = String(data.get('new_password') ?? '');
    const confirm = String(data.get('confirm_password') ?? '');
    if (newPassword !== confirm) {
      setFeedback({ type: 'error', message: '新しいPasswordの確認入力が一致しません。', code: 'PASSWORD_CONFIRMATION_MISMATCH' });
      return;
    }
    await run(async () => {
      authResult(await authClient.changePassword({ currentPassword, newPassword, revokeOtherSessions: true }), 'Passwordを変更できませんでした。');
    }, 'Passwordを変更し、他のSessionを失効しました。', 'PASSWORD_CHANGE_FAILED');
    form.reset();
  };

  const linkProvider = async (provider: 'google' | 'github') => {
    if (disabled) return;
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
    if (disabled || !window.confirm(`${account.providerId}連携を解除します。最後のLogin手段は解除できません。`)) return;
    await run(async () => {
      authResult(await authClient.unlinkAccount(account.accountId ? { providerId: account.providerId, accountId: account.accountId } : { providerId: account.providerId }), 'Login連携を解除できませんでした。');
    }, `${account.providerId}連携を解除しました。`, 'ACCOUNT_UNLINK_FAILED');
  };

  const linked = new Map(accounts.map((item) => [item.providerId, item]));

  return <section className="security-management" data-canon-account-security-management="true">
    <header><div><h2>ログイン・パスワード・端末</h2><p>Password、Google/GitHub Login連携、Sessionをここで管理します。</p></div><button type="button" className="platform-button" onClick={() => void reload()} disabled={loading || disabled}>再読込</button></header>

    {feedback.type !== 'idle' && <div className={`security-management-feedback is-${feedback.type}`} role={feedback.type === 'error' ? 'alert' : 'status'}><strong>{feedback.type === 'working' ? '処理しています…' : feedback.message}</strong>{feedback.code && <code>{feedback.code}</code>}</div>}

    <div className="security-management-grid">
      <section className="security-management-card"><h3>Password変更</h3><p>変更時は他のSessionも失効します。12〜128文字。</p><form className="security-management-form" onSubmit={changePassword}><label><span>現在のPassword</span><input name="current_password" type="password" autoComplete="current-password" required disabled={disabled} /></label><label><span>新しいPassword</span><input name="new_password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required disabled={disabled} /></label><label><span>新しいPassword（確認）</span><input name="confirm_password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required disabled={disabled} /></label><button className="platform-button is-primary" type="submit" disabled={feedback.type === 'working' || disabled}>Passwordを変更</button></form></section>

      <section className="security-management-card"><h3>Login連携</h3><p>Google / GitHubをLogin手段として追加・解除します。外部Storage転送の接続とは別管理です。</p><div className="security-provider-list">{(['google','github'] as const).map((provider) => { const account = linked.get(provider); return <div key={provider}><div><strong>{provider === 'google' ? 'Google' : 'GitHub'}</strong><small>{account ? '連携済み' : '未連携'}</small></div>{account ? <button type="button" className="platform-button" onClick={() => void unlinkProvider(account)} disabled={feedback.type === 'working' || disabled}>解除</button> : <button type="button" className="platform-button" onClick={() => void linkProvider(provider)} disabled={feedback.type === 'working' || disabled}>連携</button>}</div>; })}</div></section>
    </div>

    <section className="security-management-card"><div className="security-management-card-head"><div><h3>ログイン中の端末</h3><p>Token本文は表示せず、端末情報と期限だけ表示します。</p></div><span>{sessions.length}件</span></div>{loading ? <p>Sessionを確認しています…</p> : sessions.length === 0 ? <p>有効なSessionを確認できませんでした。</p> : <ul className="security-session-list">{sessions.map((session) => <li key={session.id}><div><strong>{session.current ? 'この端末' : session.userAgent}</strong><span>{session.ipAddress || 'IP非表示'} · 更新 {dateText(session.updatedAt)}</span><small>有効期限 {dateText(session.expiresAt)} / ID {session.id.slice(0, 8)}…</small></div><button className="platform-button" type="button" disabled={session.current || feedback.type === 'working' || disabled} onClick={() => void run(async () => { authResult(await authClient.revokeSession({ token: session.token }), 'Sessionを失効できませんでした。'); }, 'Sessionを失効しました。', 'SESSION_REVOKE_FAILED')}>{session.current ? '現在使用中' : 'ログアウト'}</button></li>)}</ul>}<div className="security-session-actions"><button type="button" className="platform-button" disabled={feedback.type === 'working' || disabled} onClick={() => void run(async () => { authResult(await authClient.revokeOtherSessions(), '他のSessionを失効できませんでした。'); }, 'この端末以外をログアウトしました。', 'OTHER_SESSIONS_REVOKE_FAILED')}>他の端末をログアウト</button><button type="button" className="platform-button is-danger" disabled={feedback.type === 'working' || disabled} onClick={() => { if (window.confirm('全端末からログアウトしてLogin画面へ戻ります。')) void run(async () => { authResult(await authClient.revokeSessions(), '全Sessionを失効できませんでした。'); window.location.assign('/login'); }, '全端末からログアウトしました。', 'ALL_SESSIONS_REVOKE_FAILED', false); }}>全端末からログアウト</button></div></section>

    <section className="security-management-card is-muted"><h3>Security Event</h3><p>Security Event履歴Backendは現Repositoryで未接続です。未実施を履歴表示として偽装しません。</p><button type="button" className="platform-button" disabled aria-disabled="true">Security Event（未接続）</button></section>
  </section>;
}