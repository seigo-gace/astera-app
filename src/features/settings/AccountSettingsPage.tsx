import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useAppText } from '../../app-text';
import { apiRequest, asArray, asRecord, recordText } from '../../platform/api-client';
import { authClient, authErrorMessage } from '../../platform/auth-client';
import { nativeCallback, openExternalUrl } from '../../platform/external-navigation';
import type { RouteMatch } from '../../platform/route-registry';
import { BusyState, ResponsivePageShell } from '../../platform/ResponsivePageShell';
import { submitForm, useResource, type SubmitState } from '../../platform/pages/page-kit';
import './settings-dedicated.css';

type LinkedAccount = { id: string; provider: string };

type AccountSummary = {
  displayName: string;
  email: string;
  emailVerified: boolean;
  image: string;
};

type SecuritySummary = {
  passwordConfigured: boolean;
};

function accountRows(payload: unknown): LinkedAccount[] {
  return asArray(payload, ['data', 'accounts', 'items']).map((item) => {
    const record = asRecord(item);
    return {
      id: recordText(record, ['id', 'accountId', 'account_id']),
      provider: recordText(record, ['providerId', 'provider_id', 'provider']).toLowerCase(),
    };
  }).filter((item) => item.provider);
}

function accountSummary(payload: unknown): AccountSummary {
  const root = asRecord(payload);
  const account = asRecord(root.account ?? root.data ?? root);
  const email = recordText(account, ['email']);
  return {
    displayName: recordText(account, ['display_name', 'name', 'nickname'], email),
    email,
    emailVerified: account.email_verified === true || account.emailVerified === true,
    image: recordText(account, ['image']),
  };
}

export default function AccountSettingsPage({ route }: { route: RouteMatch }) {
  const { language, text } = useAppText();
  const [account] = useResource('/api/account');
  const [connections, setConnections] = useState<LinkedAccount[]>([]);
  const [connectionLoading, setConnectionLoading] = useState(true);
  const [securitySummary, setSecuritySummary] = useState<SecuritySummary | null>(null);
  const [state, setState] = useState<SubmitState>({ type: 'idle' });
  const local = language === 'en'
    ? {
      loadFailed: 'Account information could not be loaded.',
      profile: 'Profile',
      emailTitle: 'Email address',
      emailDescription: 'This email is used for account verification and email two-factor codes.',
      verified: 'Verified',
      unverified: 'Not verified',
      newEmail: 'New email address',
      changeEmail: 'Change email',
      emailChangeSent: 'A verification link was sent to the new email address. The account email changes after verification.',
      passwordTitle: 'Password',
      passwordDescription: 'Change the Astera password registered with this account.',
      currentPassword: 'Current password',
      newPassword: 'New password',
      confirmPassword: 'Confirm new password',
      changePassword: 'Change password',
      passwordChanged: 'Password changed. Other signed-in devices were signed out.',
      passwordMismatch: 'The new passwords do not match.',
      passwordUnavailable: 'The password credential for this account could not be confirmed. Use the registered email to reset it from Account settings.',
      resetPassword: 'Reset password by email',
      securityDescription: 'Passkeys, two-factor authentication, and signed-in devices.',
      privacyDescription: 'Review privacy and data settings.',
      lastMethod: 'At least one login method must remain connected.',
    }
    : {
      loadFailed: 'アカウント情報を取得できませんでした。',
      profile: 'プロフィール',
      emailTitle: 'メールアドレス',
      emailDescription: 'Account確認と2段階認証のメールコードに使用します。',
      verified: '確認済み',
      unverified: '未確認',
      newEmail: '新しいメールアドレス',
      changeEmail: 'メールアドレスを変更',
      emailChangeSent: '新しいメールアドレスへ確認リンクを送信しました。確認完了後にAccountのメールが切り替わります。',
      passwordTitle: 'Password',
      passwordDescription: 'Account登録時に設定したAstera用Passwordを変更します。',
      currentPassword: '現在のPassword',
      newPassword: '新しいPassword',
      confirmPassword: '新しいPasswordを確認',
      changePassword: 'Passwordを変更',
      passwordChanged: 'Passwordを変更しました。他のログイン中端末はログアウトしました。',
      passwordMismatch: '新しいPasswordが一致しません。',
      passwordUnavailable: 'このAccountのPassword情報を確認できません。Accountの登録メールからPasswordを再設定してください。',
      resetPassword: '登録メールからPasswordを再設定',
      securityDescription: 'Passkey、2段階認証、ログイン中の端末を管理します。',
      privacyDescription: 'プライバシーとデータの設定を確認します。',
      lastMethod: 'ログイン方法は最低1つ残す必要があります。',
    };

  const summary = useMemo(
    () => account.status === 'ready' ? accountSummary(account.data) : { displayName: '', email: '', emailVerified: false, image: '' },
    [account],
  );

  const loadConnections = async () => {
    setConnectionLoading(true);
    try { setConnections(accountRows(await apiRequest('/api/auth/list-accounts'))); }
    catch { setConnections([]); }
    finally { setConnectionLoading(false); }
  };

  const loadSecuritySummary = async () => {
    try {
      const payload = await apiRequest('/api/account/security');
      const source = asRecord(asRecord(payload).security ?? payload);
      setSecuritySummary({ passwordConfigured: source.password_configured === true || source.passwordConfigured === true });
    } catch {
      setSecuritySummary(null);
    }
  };

  useEffect(() => {
    void loadConnections();
    void loadSecuritySummary();
  }, []);

  const changeEmail = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const newEmail = String(new FormData(form).get('new_email') ?? '').trim();
    if (!newEmail) return;
    setState({ type: 'working' });
    try {
      const response = await authClient.changeEmail({ newEmail, callbackURL: `${window.location.origin}/account` });
      if (response.error) throw new Error(authErrorMessage(response.error, 'メールアドレスを変更できませんでした。'));
      form.reset();
      setState({ type: 'success', message: local.emailChangeSent });
    } catch (error) {
      setState({ type: 'error', message: error instanceof Error ? error.message : 'メールアドレスを変更できませんでした。' });
    }
  };

  const changePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const currentPassword = String(data.get('current_password') ?? '');
    const newPassword = String(data.get('new_password') ?? '');
    const confirmation = String(data.get('new_password_confirmation') ?? '');
    if (newPassword !== confirmation) {
      setState({ type: 'error', message: local.passwordMismatch });
      return;
    }
    setState({ type: 'working' });
    try {
      const response = await authClient.changePassword({ currentPassword, newPassword, revokeOtherSessions: true });
      if (response.error) throw new Error(authErrorMessage(response.error, 'Passwordを変更できませんでした。'));
      form.reset();
      setState({ type: 'success', message: local.passwordChanged });
      await loadSecuritySummary();
    } catch (error) {
      setState({ type: 'error', message: error instanceof Error ? error.message : 'Passwordを変更できませんでした。' });
    }
  };

  const connect = async (provider: 'google' | 'github') => {
    const callbackURL = nativeCallback('/account') || window.location.href;
    const payload = await submitForm('/api/auth/link-social', { provider, callbackURL, disableRedirect: true }, setState, { idempotent: true });
    if (!payload) return;
    const source = asRecord(asRecord(payload).data ?? payload);
    const url = recordText(source, ['url', 'redirect', 'redirectURL']);
    if (url) { await openExternalUrl(url); return; }
    await loadConnections();
  };

  const disconnect = async (provider: 'google' | 'github') => {
    const linked = connections.find((item) => item.provider === provider);
    if (!linked || connections.length <= 1) return;
    const result = await submitForm('/api/auth/unlink-account', { providerId: provider, accountId: linked.id || undefined }, setState, { idempotent: true });
    if (result) await loadConnections();
  };

  const logout = async () => {
    const result = await submitForm('/api/auth/sign-out', {}, setState, { idempotent: true });
    if (result) window.location.replace('/login');
  };

  const connected = (provider: string) => connections.some((item) => item.provider === provider);
  const fallbackInitial = (summary.displayName || summary.email || 'A').trim().slice(0, 1).toUpperCase();

  return (
    <ResponsivePageShell route={route} description={text('accountDescription')}>
      <div className="settings-account-page">
        <section className="settings-account-profile" aria-label={local.profile}>
          {account.status === 'loading' && <BusyState />}
          {account.status === 'error' && <div className="settings-inline-message is-error" role="alert">{local.loadFailed}</div>}
          {account.status === 'ready' && (
            <>
              <div className="settings-account-avatar" aria-hidden="true">
                {summary.image ? <img src={summary.image} alt="" /> : <span>{fallbackInitial}</span>}
              </div>
              <div className="settings-account-profile-copy">
                <strong>{summary.displayName || summary.email}</strong>
                <span>{summary.email}</span>
              </div>
            </>
          )}
        </section>

        <section className="settings-account-section">
          <h2>{local.emailTitle}</h2>
          <p className="settings-note">{local.emailDescription}</p>
          <div className="settings-account-current-value">
            <div>
              <strong>{summary.email || '—'}</strong>
              <span>{summary.emailVerified ? local.verified : local.unverified}</span>
            </div>
          </div>
          <form className="settings-account-form" onSubmit={changeEmail}>
            <label>
              <span>{local.newEmail}</span>
              <input name="new_email" type="email" autoComplete="email" required disabled={state.type === 'working'} />
            </label>
            <button className="platform-button" type="submit" disabled={state.type === 'working'}>{local.changeEmail}</button>
          </form>
        </section>

        <section className="settings-account-section">
          <h2>{local.passwordTitle}</h2>
          <p className="settings-note">{local.passwordDescription}</p>
          {securitySummary?.passwordConfigured === false ? (
            <div className="settings-account-recovery">
              <p>{local.passwordUnavailable}</p>
              <a className="platform-button" href="/forgot-password?return_to=%2Faccount">{local.resetPassword}</a>
            </div>
          ) : (
            <form className="settings-account-form" onSubmit={changePassword}>
              <label>
                <span>{local.currentPassword}</span>
                <input name="current_password" type="password" autoComplete="current-password" required minLength={6} maxLength={128} disabled={state.type === 'working'} />
              </label>
              <label>
                <span>{local.newPassword}</span>
                <input name="new_password" type="password" autoComplete="new-password" required minLength={6} maxLength={128} disabled={state.type === 'working'} />
              </label>
              <label>
                <span>{local.confirmPassword}</span>
                <input name="new_password_confirmation" type="password" autoComplete="new-password" required minLength={6} maxLength={128} disabled={state.type === 'working'} />
              </label>
              <button className="platform-button" type="submit" disabled={state.type === 'working'}>{local.changePassword}</button>
            </form>
          )}
        </section>

        <section className="settings-account-section">
          <h2>{text('loginConnections')}</h2>
          {connectionLoading ? <BusyState /> : (
            <div className="settings-account-rows">
              {(['google', 'github'] as const).map((provider) => {
                const isConnected = connected(provider);
                const isLastMethod = isConnected && connections.length <= 1;
                return (
                  <div className="settings-account-row" key={provider}>
                    <div>
                      <strong>{text(provider)}</strong>
                      <span>{isConnected ? text('connected') : text('notConnected')}</span>
                      {isLastMethod && <small>{local.lastMethod}</small>}
                    </div>
                    <button className="platform-button" type="button" onClick={() => void (isConnected ? disconnect(provider) : connect(provider))} disabled={state.type === 'working' || isLastMethod}>
                      {isConnected ? text('unlink') : text('link')}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="settings-account-section">
          <a className="settings-account-nav-row" href="/account/security">
            <span><strong>{text('securityTitle')}</strong><small>{local.securityDescription}</small></span>
            <b aria-hidden="true">›</b>
          </a>
          <a className="settings-account-nav-row" href="/app/settings/data-privacy">
            <span><strong>{text('privacyTitle')}</strong><small>{local.privacyDescription}</small></span>
            <b aria-hidden="true">›</b>
          </a>
        </section>

        <section className="settings-account-section is-actions">
          <button className="platform-button" type="button" onClick={() => void logout()} disabled={state.type === 'working'}>{text('logout')}</button>
          {state.type === 'error' && <div className="settings-inline-message is-error" role="alert">{state.message}</div>}
          {state.type === 'success' && <div className="settings-inline-message is-success" role="status">{state.message}</div>}
        </section>
      </div>
    </ResponsivePageShell>
  );
}
