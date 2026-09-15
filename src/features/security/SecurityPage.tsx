import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useAppText } from '../../app-text';
import { ApiError, apiRequest, asArray, asRecord, recordText } from '../../platform/api-client';
import { previewWithoutAuth } from '../../platform/account-session';
import { authClient, authErrorCode, authErrorMessage } from '../../platform/auth-client';
import { BusyState, ErrorState, ResponsivePageShell } from '../../platform/ResponsivePageShell';
import type { RouteMatch } from '../../platform/route-registry';
import '../../platform/canonical-account-security-management.css';
import './security-page.css';

type PasskeyRecord = { id: string; name: string; deviceType: string; backedUp: boolean; createdAt: string };
type SessionItem = { id: string; token: string; current: boolean; userAgent: string; ipAddress: string; createdAt: string; updatedAt: string; expiresAt: string };
type AccountItem = { providerId: string; accountId: string };
type SecurityEvent = { id: string; eventType: string; actorIp: string; userAgent: string; correlationId: string; createdAt: string };
type Enrollment = { totpURI: string; backupCodes: string[] };
type Feedback = { type: 'idle' | 'working' | 'success' | 'error'; message?: string; code?: string };

function betterAuthResult<T>(value: { data?: T | null; error?: unknown }, fallback: string): T {
  if (value.error) throw new ApiError(authErrorMessage(value.error, fallback), 400, authErrorCode(value.error, 'AUTH_OPERATION_FAILED'), value.error);
  if (value.data == null) throw new ApiError(fallback, 502, 'AUTH_RESPONSE_EMPTY');
  return value.data;
}

function dateText(value: string): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function eventLabel(eventType: string): string {
  const labels: Record<string, string> = {
    sign_in_email: 'Email Login',
    sign_in_passkey: 'Passkey Login',
    sign_in_oauth: 'OAuth Login',
    sign_in_native_exchange: 'Native Session Exchange',
    sign_out: 'Sign out',
    password_change: 'Password変更',
    password_setup: 'Password設定',
    '2fa_enable': '2FA有効化',
    '2fa_disable': '2FA無効化',
    '2fa_verify': '2FA確認',
    passkey_add: 'Passkey追加',
    passkey_delete: 'Passkey削除',
    session_revoke: 'Session失効',
    session_revoke_others: '他Session失効',
    session_revoke_all: '全Session失効',
    oauth_link: 'OAuth連携',
    oauth_unlink: 'OAuth解除',
    exchange_rejected: 'Exchange拒否',
  };
  return labels[eventType] ?? eventType;
}

function normalizePasskeys(payload: unknown, defaultName: string, unknownDevice: string): PasskeyRecord[] {
  return asArray(payload, ['passkeys', 'items']).map((item) => {
    const source = asRecord(item);
    return {
      id: recordText(source, ['id']),
      name: recordText(source, ['name'], defaultName),
      deviceType: recordText(source, ['deviceType', 'device_type'], unknownDevice),
      backedUp: source.backedUp === true || source.backed_up === true,
      createdAt: recordText(source, ['createdAt', 'created_at']),
    };
  }).filter((item) => item.id);
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

function normalizeEvents(projection: unknown): SecurityEvent[] {
  return asArray(asRecord(asRecord(projection).security).events).map((item) => {
    const source = asRecord(item);
    return {
      id: recordText(source, ['id']),
      eventType: recordText(source, ['event_type', 'eventType']),
      actorIp: recordText(source, ['actor_ip', 'actorIp']),
      userAgent: recordText(source, ['user_agent', 'userAgent']),
      correlationId: recordText(source, ['correlation_id', 'correlationId']),
      createdAt: recordText(source, ['created_at', 'createdAt']),
    };
  }).filter((item) => item.id);
}

export default function SecurityPage({ route }: { route: RouteMatch }) {
  const { text } = useAppText();
  const previewMode = previewWithoutAuth();
  const [loading, setLoading] = useState(!previewMode);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);
  const [passkeys, setPasskeys] = useState<PasskeyRecord[]>([]);
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [accounts, setAccounts] = useState<AccountItem[]>([]);
  const [events, setEvents] = useState<SecurityEvent[]>([]);
  const [feedback, setFeedback] = useState<Feedback>({ type: 'idle' });
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [securityProjectionReady, setSecurityProjectionReady] = useState(false);

  const mutationsLocked = previewMode || !securityProjectionReady;

  const reload = useCallback(async () => {
    if (previewWithoutAuth()) {
      setTwoFactorEnabled(false);
      setPasskeys([]);
      setSessions([]);
      setAccounts([]);
      setEvents([]);
      setSecurityProjectionReady(false);
      setLoadError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const [projection, sessionResult, accountResult, passkeyPayload] = await Promise.all([
        apiRequest('/api/account/security'),
        authClient.listSessions(),
        authClient.listAccounts(),
        authClient.passkey.listUserPasskeys(),
      ]);
      const security = asRecord(asRecord(projection).security);
      setSecurityProjectionReady(true);
      setTwoFactorEnabled(security.two_factor_enabled === true || security.twoFactorEnabled === true);
      setEvents(normalizeEvents(projection));
      setSessions(normalizeSessions(betterAuthResult(sessionResult, 'Session一覧を取得できませんでした。'), projection));
      setAccounts(normalizeAccounts(betterAuthResult(accountResult, 'Login連携一覧を取得できませんでした。')));
      setPasskeys(normalizePasskeys(betterAuthResult(passkeyPayload, text('securityPasskeyListFailed')), text('securityPasskeyDefaultName'), text('securityUnknownDevice')));
    } catch (error) {
      setLoadError(error);
    } finally {
      setLoading(false);
    }
  }, [text]);

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
    if (mutationsLocked) return;
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
      betterAuthResult(await authClient.changePassword({ currentPassword, newPassword, revokeOtherSessions: true }), 'Passwordを変更できませんでした。');
    }, 'Passwordを変更し、他のSessionを失効しました。', 'PASSWORD_CHANGE_FAILED');
    form.reset();
  };

  const linkProvider = async (provider: 'google' | 'github') => {
    if (mutationsLocked) return;
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
    if (mutationsLocked) return;
    if (!window.confirm(`${account.providerId}連携を解除します。最後のLogin手段は解除できません。`)) return;
    await run(async () => {
      betterAuthResult(await authClient.unlinkAccount(account.accountId ? { providerId: account.providerId, accountId: account.accountId } : { providerId: account.providerId }), 'Login連携を解除できませんでした。');
    }, `${account.providerId}連携を解除しました。`, 'ACCOUNT_UNLINK_FAILED');
  };

  const addPasskey = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (mutationsLocked) return;
    const name = String(new FormData(event.currentTarget).get('name') ?? '').trim();
    await run(async () => {
      betterAuthResult(await authClient.passkey.addPasskey({ name: name || undefined, authenticatorAttachment: 'platform' }), text('securityPasskeyAddFailed'));
      event.currentTarget.reset();
    }, text('securityPasskeyAdded'), 'PASSKEY_ADD_FAILED');
  };

  const deletePasskey = async (id: string) => {
    if (mutationsLocked) return;
    await run(async () => {
      betterAuthResult(await authClient.passkey.deletePasskey({ id }), text('securityPasskeyDeleteFailed'));
    }, text('securityPasskeyDeleted'), 'PASSKEY_DELETE_FAILED');
  };

  const enableTwoFactor = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (mutationsLocked) return;
    const password = String(new FormData(event.currentTarget).get('password') ?? '');
    setFeedback({ type: 'working' });
    setBackupCodes([]);
    try {
      const payload = betterAuthResult(await authClient.twoFactor.enable({ password, issuer: 'Astera' }), text('securityTwoFactorStartFailed'));
      const source = asRecord(payload);
      const totpURI = recordText(source, ['totpURI', 'totpUri', 'totp_uri']);
      const codes = asArray(source.backupCodes ?? source.backup_codes).map(String);
      if (!totpURI || codes.length === 0) throw new ApiError(text('securityEnrollmentIncomplete'), 502, 'TWO_FACTOR_ENROLLMENT_INCOMPLETE', payload);
      setEnrollment({ totpURI, backupCodes: codes });
      setFeedback({ type: 'success', message: text('securityAuthenticatorReady') });
      event.currentTarget.reset();
    } catch (error) {
      setFeedback({ type: 'error', message: error instanceof Error ? error.message : text('securityTwoFactorStartFailed'), code: error instanceof ApiError ? error.code : 'TWO_FACTOR_ENABLE_FAILED' });
    }
  };

  const verifyTwoFactor = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (mutationsLocked) return;
    const code = String(new FormData(event.currentTarget).get('code') ?? '').replace(/\s/g, '');
    await run(async () => {
      betterAuthResult(await authClient.twoFactor.verifyTotp({ code, trustDevice: true }), text('securityTotpVerifyFailed'));
      setBackupCodes(enrollment?.backupCodes ?? []);
      setEnrollment(null);
      event.currentTarget.reset();
    }, text('securityTwoFactorEnabled'), 'TWO_FACTOR_VERIFY_FAILED');
  };

  const disableTwoFactor = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (mutationsLocked) return;
    const password = String(new FormData(event.currentTarget).get('password') ?? '');
    await run(async () => {
      betterAuthResult(await authClient.twoFactor.disable({ password }), text('securityTwoFactorDisableFailed'));
      setEnrollment(null);
      setBackupCodes([]);
      event.currentTarget.reset();
    }, text('securityTwoFactorDisabled'), 'TWO_FACTOR_DISABLE_FAILED');
  };

  const regenerateBackupCodes = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (mutationsLocked) return;
    const password = String(new FormData(event.currentTarget).get('password') ?? '');
    setFeedback({ type: 'working' });
    try {
      const payload = betterAuthResult(await authClient.twoFactor.generateBackupCodes({ password }), text('securityBackupGenerateFailed'));
      const source = asRecord(payload);
      const codes = asArray(source.backupCodes ?? source.backup_codes).map(String);
      if (codes.length === 0) throw new ApiError(text('securityBackupMissing'), 502, 'BACKUP_CODES_MISSING', payload);
      setBackupCodes(codes);
      setFeedback({ type: 'success', message: text('securityBackupRegenerated') });
      event.currentTarget.reset();
    } catch (error) {
      setFeedback({ type: 'error', message: error instanceof Error ? error.message : text('securityBackupGenerateFailed'), code: error instanceof ApiError ? error.code : 'BACKUP_CODES_GENERATE_FAILED' });
    }
  };

  const copySecret = async (value: string, success: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setFeedback({ type: 'success', message: success });
    } catch {
      setFeedback({ type: 'error', message: text('securityClipboardFailed'), code: 'CLIPBOARD_WRITE_FAILED' });
    }
  };

  const linked = new Map(accounts.map((item) => [item.providerId, item]));

  if (loading) return <BusyState label={text('securityLoading')} />;
  if (loadError) return <ErrorState error={loadError} onRetry={() => void reload()} />;

  return (
    <ResponsivePageShell route={route} description={text('securityPageDescription')}>
      <section className="security-management" data-account-security-page="true">
        <header>
          <div>
            <h2>Account・Security</h2>
            <p>Password、OAuth、Session、Passkey、2FA、Security Eventをこの画面で管理します。</p>
          </div>
          <button type="button" className="platform-button" onClick={() => void reload()} disabled={feedback.type === 'working' || previewMode}>再読込</button>
        </header>

        {feedback.type !== 'idle' && <div className={`security-management-feedback is-${feedback.type}`} role={feedback.type === 'error' ? 'alert' : 'status'}><strong>{feedback.type === 'working' ? text('securityWorking') : feedback.message}</strong>{feedback.code && <code>{feedback.code}</code>}</div>}

        {mutationsLocked && (
          <p className="security-honesty-notice" role="note">
            成功したように見せる空POSTは行いません。Passkey / 2FA / Backup CodeはSecurity Projectionが揃うまでMutationを送りません。
          </p>
        )}

        <div className="security-management-grid">
          <section className="security-management-card">
            <h3>Password変更</h3>
            <p>変更時は他のSessionも失効します。12〜128文字。</p>
            <form className="security-management-form" onSubmit={changePassword}>
              <label><span>現在のPassword</span><input name="current_password" type="password" autoComplete="current-password" required disabled={previewMode} /></label>
              <label><span>新しいPassword</span><input name="new_password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required disabled={previewMode} /></label>
              <label><span>新しいPassword（確認）</span><input name="confirm_password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required disabled={previewMode} /></label>
              <button className="platform-button is-primary" type="submit" disabled={feedback.type === 'working' || previewMode}>Passwordを変更</button>
            </form>
          </section>

          <section className="security-management-card">
            <h3>Login連携</h3>
            <p>Google / GitHubを追加・解除します。</p>
            <div className="security-provider-list">
              {(['google', 'github'] as const).map((provider) => {
                const account = linked.get(provider);
                return (
                  <div key={provider}>
                    <div><strong>{provider === 'google' ? 'Google' : 'GitHub'}</strong><small>{account ? '連携済み' : '未連携'}</small></div>
                    {account
                      ? <button type="button" className="platform-button" onClick={() => void unlinkProvider(account)} disabled={feedback.type === 'working' || previewMode}>解除</button>
                      : <button type="button" className="platform-button" onClick={() => void linkProvider(provider)} disabled={feedback.type === 'working' || previewMode}>連携</button>}
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        <section className="security-management-card">
          <div className="security-management-card-head"><div><h3>Session一覧</h3><p>端末情報と期限を表示します。</p></div><span>{sessions.length}件</span></div>
          {sessions.length === 0 ? <p>有効なSessionを確認できませんでした。</p> : (
            <ul className="security-session-list">
              {sessions.map((session) => (
                <li key={session.id}>
                  <div><strong>{session.current ? 'この端末' : session.userAgent}</strong><span>{session.ipAddress || 'IP非表示'} · 更新 {dateText(session.updatedAt)}</span><small>有効期限 {dateText(session.expiresAt)} / ID {session.id.slice(0, 8)}…</small></div>
                  <button className="platform-button" type="button" disabled={session.current || feedback.type === 'working' || previewMode} onClick={() => void run(async () => { betterAuthResult(await authClient.revokeSession({ token: session.token }), 'Sessionを失効できませんでした。'); }, 'Sessionを失効しました。', 'SESSION_REVOKE_FAILED')}>{session.current ? '現在使用中' : '失効'}</button>
                </li>
              ))}
            </ul>
          )}
          <div className="security-session-actions">
            <button type="button" className="platform-button" disabled={feedback.type === 'working' || previewMode} onClick={() => void run(async () => { betterAuthResult(await authClient.revokeOtherSessions(), '他のSessionを失効できませんでした。'); }, 'この端末以外のSessionを失効しました。', 'OTHER_SESSIONS_REVOKE_FAILED')}>他のSessionを全て失効</button>
            <button type="button" className="platform-button is-danger" disabled={feedback.type === 'working' || previewMode} onClick={() => { if (window.confirm('全Sessionを失効してLogin画面へ戻ります。')) void run(async () => { betterAuthResult(await authClient.revokeSessions(), '全Sessionを失効できませんでした。'); window.location.assign('/login'); }, '全Sessionを失効しました。', 'ALL_SESSIONS_REVOKE_FAILED', false); }}>全Sessionを失効</button>
          </div>
        </section>

        <section className="security-panel">
          <div className="security-panel-head"><div><h2>{text('securityPasskey')}</h2><p>{text('securityPasskeyDescription')}</p></div><span>{passkeys.length}{text('securityCountSuffix')}</span></div>
          <form className="security-inline-form" onSubmit={addPasskey}><label><span>{text('securityDisplayNameOptional')}</span><input name="name" maxLength={80} placeholder={text('securityDisplayNamePlaceholder')} disabled={mutationsLocked} /></label><button className="platform-button is-primary" type="submit" disabled={feedback.type === 'working' || mutationsLocked} aria-label="Passkeyを追加">{text('securityAddThisDevice')}</button></form>
          {passkeys.length === 0 ? <p className="security-empty">{text('securityNoPasskeys')}</p> : <ul className="security-list">{passkeys.map((passkey) => <li key={passkey.id}><div><strong>{passkey.name}</strong><span>{passkey.deviceType} / {passkey.backedUp ? text('securitySynced') : text('securityDeviceStored')}</span><small>{passkey.createdAt || passkey.id}</small></div><button className="platform-button" type="button" onClick={() => void deletePasskey(passkey.id)} disabled={feedback.type === 'working' || mutationsLocked}>{text('securityDelete')}</button></li>)}</ul>}
        </section>

        <section className="security-panel">
          <div className="security-panel-head"><div><h2>{text('securityTwoFactor')}</h2><p>{text('securityTwoFactorDescription')}</p></div><span className={twoFactorEnabled ? 'is-enabled' : ''}>{twoFactorEnabled ? text('securityEnabled') : text('securityDisabled')}</span></div>
          {!twoFactorEnabled && !enrollment && <form className="security-inline-form" onSubmit={enableTwoFactor}><label><span>{text('securityCurrentPassword')}</span><input name="password" type="password" autoComplete="current-password" required disabled={mutationsLocked} /></label><button className="platform-button is-primary" type="submit" disabled={feedback.type === 'working' || mutationsLocked} aria-label="2FAを有効化">{text('securityStartTwoFactor')}</button></form>}
          {enrollment && <div className="security-enrollment"><h3>{text('securityAuthenticatorEnrollment')}</h3><p>{text('securityAuthenticatorInstruction')}</p><code>{enrollment.totpURI}</code><button type="button" className="platform-button" onClick={() => void copySecret(enrollment.totpURI, text('securityTotpCopied'))}>{text('securityCopyUri')}</button><form className="security-inline-form" onSubmit={verifyTwoFactor}><label><span>{text('securitySixDigitCode')}</span><input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,8}" required disabled={previewMode} /></label><button className="platform-button is-primary" type="submit" disabled={feedback.type === 'working' || previewMode}>{text('securityVerifyEnable')}</button></form></div>}
          {twoFactorEnabled && <div className="security-two-factor-actions"><form className="security-inline-form" onSubmit={regenerateBackupCodes}><label><span>{text('securityBackupPassword')}</span><input name="password" type="password" autoComplete="current-password" required disabled={mutationsLocked} /></label><button className="platform-button" type="submit" disabled={feedback.type === 'working' || mutationsLocked} aria-label="Backup Code再生成">{text('securityRegenerateBackup')}</button></form><form className="security-inline-form is-danger" onSubmit={disableTwoFactor}><label><span>{text('securityDisablePassword')}</span><input name="password" type="password" autoComplete="current-password" required disabled={previewMode} /></label><button className="platform-button" type="submit" disabled={feedback.type === 'working' || previewMode}>{text('securityDisableTwoFactor')}</button></form></div>}
        </section>

        {backupCodes.length > 0 && <section className="security-panel security-backup-codes"><div className="security-panel-head"><div><h2>{text('securityBackupCodes')}</h2><p>{text('securityBackupCodesDescription')}</p></div><button type="button" className="platform-button" onClick={() => void copySecret(backupCodes.join('\n'), text('securityBackupCopied'))}>{text('securityCopyAll')}</button></div><ol>{backupCodes.map((code) => <li key={code}><code>{code}</code></li>)}</ol><button type="button" className="platform-button" onClick={() => setBackupCodes([])}>{text('securityCloseAfterSave')}</button></section>}

        <section className="security-management-card">
          <div className="security-management-card-head"><div><h3>Security Event履歴</h3><p>直近100件を表示します。</p></div><span>{events.length}件</span></div>
          {events.length === 0 ? <p>Security Eventはまだ記録されていません。</p> : (
            <ul className="security-session-list">
              {events.map((event) => (
                <li key={event.id}>
                  <div>
                    <strong>{eventLabel(event.eventType)}</strong>
                    <span>{dateText(event.createdAt)} · {event.actorIp || 'IP非表示'}</span>
                    <small>{event.userAgent || '—'} / {event.correlationId.slice(0, 8)}…</small>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </section>
    </ResponsivePageShell>
  );
}
