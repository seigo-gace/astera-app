import { useEffect, useMemo, useState } from 'react';
import { useAppText } from '../../app-text';
import { apiRequest, asArray, asRecord, recordText } from '../../platform/api-client';
import { nativeCallback, openExternalUrl } from '../../platform/external-navigation';
import type { RouteMatch } from '../../platform/route-registry';
import { BusyState, ResponsivePageShell } from '../../platform/ResponsivePageShell';
import { submitForm, useResource, type SubmitState } from '../../platform/pages/page-kit';
import './settings-dedicated.css';

type LinkedAccount = { id: string; provider: string };

type AccountSummary = {
  displayName: string;
  email: string;
  image: string;
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
    image: recordText(account, ['image']),
  };
}

export default function AccountSettingsPage({ route }: { route: RouteMatch }) {
  const { language, text } = useAppText();
  const [account] = useResource('/api/account');
  const [connections, setConnections] = useState<LinkedAccount[]>([]);
  const [connectionLoading, setConnectionLoading] = useState(true);
  const [state, setState] = useState<SubmitState>({ type: 'idle' });
  const local = language === 'en'
    ? {
      loadFailed: 'Account information could not be loaded.',
      profile: 'Profile',
      securityDescription: 'Passkeys, two-factor authentication, and signed-in devices.',
      privacyDescription: 'Review privacy and data settings.',
      lastMethod: 'At least one login method must remain connected.',
    }
    : {
      loadFailed: 'アカウント情報を取得できませんでした。',
      profile: 'プロフィール',
      securityDescription: 'Passkey、2段階認証、ログイン中の端末を管理します。',
      privacyDescription: 'プライバシーとデータの設定を確認します。',
      lastMethod: 'ログイン方法は最低1つ残す必要があります。',
    };

  const summary = useMemo(
    () => account.status === 'ready' ? accountSummary(account.data) : { displayName: '', email: '', image: '' },
    [account],
  );

  const loadConnections = async () => {
    setConnectionLoading(true);
    try { setConnections(accountRows(await apiRequest('/api/auth/list-accounts'))); }
    catch { setConnections([]); }
    finally { setConnectionLoading(false); }
  };

  useEffect(() => { void loadConnections(); }, []);

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
                    <button
                      className="platform-button"
                      type="button"
                      onClick={() => void (isConnected ? disconnect(provider) : connect(provider))}
                      disabled={state.type === 'working' || isLastMethod}
                    >
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
            <span>
              <strong>{text('securityTitle')}</strong>
              <small>{local.securityDescription}</small>
            </span>
            <b aria-hidden="true">›</b>
          </a>
          <a className="settings-account-nav-row" href="/app/settings/data-privacy">
            <span>
              <strong>{text('privacyTitle')}</strong>
              <small>{local.privacyDescription}</small>
            </span>
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
