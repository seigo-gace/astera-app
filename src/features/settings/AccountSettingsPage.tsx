import { useEffect, useState } from 'react';
import { useAppText } from '../../app-text';
import { apiRequest, asArray, asRecord, recordText } from '../../platform/api-client';
import { nativeCallback, openExternalUrl } from '../../platform/external-navigation';
import type { RouteMatch } from '../../platform/route-registry';
import { BusyState, ErrorState, ResponsivePageShell } from '../../platform/ResponsivePageShell';
import { FormResult, KeyValueGrid, Panel, submitForm, useResource, type SubmitState } from '../../platform/pages/page-kit';

type LinkedAccount = { id: string; provider: string };

function accountRows(payload: unknown): LinkedAccount[] {
  return asArray(payload, ['data', 'accounts', 'items']).map((item) => {
    const record = asRecord(item);
    return { id: recordText(record, ['id', 'accountId', 'account_id']), provider: recordText(record, ['providerId', 'provider_id', 'provider']).toLowerCase() };
  }).filter((item) => item.provider);
}

export default function AccountSettingsPage({ route }: { route: RouteMatch }) {
  const { text } = useAppText();
  const [account] = useResource('/api/account');
  const [connections, setConnections] = useState<LinkedAccount[]>([]);
  const [connectionLoading, setConnectionLoading] = useState(true);
  const [state, setState] = useState<SubmitState>({ type: 'idle' });

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

  return (
    <ResponsivePageShell route={route} description={text('accountDescription')}>
      <Panel title={text('accountTitle')}>
        {account.status === 'loading' && <BusyState />}
        {account.status === 'error' && <ErrorState error={account.error} />}
        {account.status === 'ready' && <KeyValueGrid value={asRecord(account.data).account ?? asRecord(account.data).data ?? account.data} />}
      </Panel>
      <Panel title={text('loginConnections')}>
        {connectionLoading ? <BusyState /> : <div className="platform-card-grid">
          {(['google','github'] as const).map((provider) => <div className="platform-link-card" key={provider}>
            <strong>{text(provider)}</strong><span>{connected(provider) ? text('connected') : text('notConnected')}</span>
            <button className="platform-button" type="button" onClick={() => void (connected(provider) ? disconnect(provider) : connect(provider))} disabled={state.type === 'working' || (connected(provider) && connections.length <= 1)}>{connected(provider) ? text('unlink') : text('link')}</button>
          </div>)}
        </div>}
      </Panel>
      <Panel title={text('securityTitle')}><a className="platform-button" href="/account/security">{text('manageSecurity')}</a></Panel>
      <Panel title={text('accountDanger')}><div className="platform-action-row"><button className="platform-button" type="button" onClick={() => void logout()} disabled={state.type === 'working'}>{text('logout')}</button><a className="platform-button" href="/app/settings/data-privacy">{text('deleteAccount')}</a></div><FormResult state={state} /></Panel>
    </ResponsivePageShell>
  );
}
