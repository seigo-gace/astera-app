import { useState } from 'react';
import { asArray, asRecord, recordText } from '../api-client';
import { nativeCallback, openExternalUrl } from '../external-navigation';
import type { RouteMatch } from '../route-registry';
import { BusyState, ErrorState, ResponsivePageShell } from '../ResponsivePageShell';
import { FormResult, KeyValueGrid, Panel, RecordList, ResourceShell, submitForm, useResource, type SubmitState } from './page-kit';

function StorageDestinationsPage({ route }: { route: RouteMatch }) {
  const [resource, reload] = useResource('/api/storage/destinations');
  const [state, setState] = useState<SubmitState>({ type: 'idle' });
  const authorize = async (provider: string) => {
    const payload = await submitForm('/api/storage/destinations/authorize', {
      provider,
      return_to: window.location.pathname,
      native_callback: nativeCallback('/app/settings/storage-destinations'),
    }, setState, { success: '認証画面を開きます。', idempotent: true });
    const url = recordText(asRecord(payload), ['authorization_url', 'url', 'redirect_url']);
    if (!url) {
      setState({ type: 'error', message: 'Authorization URLがありません。', code: 'STORAGE_AUTH_URL_MISSING' });
      return;
    }
    try {
      await openExternalUrl(url);
      setState({ type: 'idle' });
    } catch (error) {
      setState({ type: 'error', message: error instanceof Error ? error.message : '認証画面を開けませんでした。', code: 'STORAGE_AUTH_OPEN_FAILED' });
    }
  };
  return <ResponsivePageShell route={route} description="Google Drive等の外部StorageをAccount単位で接続します。"><Panel title="接続先追加"><div className="platform-action-row"><button className="platform-button" type="button" onClick={() => void authorize('google-drive')}>Google Driveを接続</button><button className="platform-button" type="button" onClick={() => void authorize('google-sheets')}>Google Sheetsを接続</button></div><FormResult state={state} /></Panel><Panel title="接続済みStorage">{resource.status === 'loading' ? <BusyState /> : resource.status === 'error' ? <ErrorState error={resource.error} onRetry={reload} /> : <RecordList items={asArray(resource.data, ['destinations', 'items'])} titleKeys={['display_name', 'provider', 'name', 'id']} subtitleKeys={['status', 'updated_at']} />}</Panel></ResponsivePageShell>;
}

function AsteraStoragePage({ route }: { route: RouteMatch }) {
  return <ResourceShell route={route} endpoint="/api/account/catalog" description="Plan EntitlementからAstera Storage容量・利用状態を表示します。">{(payload) => { const root = asRecord(payload); const account = asRecord(root.account ?? root.data ?? root); return <><Panel title="Storage Entitlement"><KeyValueGrid value={account.storage ?? account} /></Panel><Panel title="運用原則"><ul className="platform-list"><li>Private Mode本文はAstera Storageへ保存しません。</li><li>Downgrade時はGrace期間と削除予定を表示します。</li><li>容量不足時はUpload前に安全停止します。</li></ul></Panel></>; }}</ResourceShell>;
}

export function WorkspacePage({ route }: { route: RouteMatch }) {
  switch (route.id) {
    case 'settings-storage-destinations': return <StorageDestinationsPage route={route} />;
    case 'settings-astera-storage': return <AsteraStoragePage route={route} />;
    default: return null;
  }
}
