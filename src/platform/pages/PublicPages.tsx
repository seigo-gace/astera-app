import { useEffect, useState, type FormEvent } from 'react';
import { apiUrl, asArray, asRecord, recordText, textValue } from '../api-client';
import type { RouteMatch } from '../route-registry';
import { BusyState, EmptyState, ErrorState, PublicPageFrame, ResponsivePageShell } from '../ResponsivePageShell';
import { Field, FormResult, KeyValueGrid, Panel, RecordList, submitForm, useResource, type SubmitState } from './page-kit';

type PublicShareState =
  | { status: 'loading' }
  | { status: 'ready'; data: unknown }
  | { status: 'password-required'; message: string }
  | { status: 'error'; error: Error };

function PublicShareViewerPage({ route }: { route: RouteMatch }) {
  const token = route.params.token;
  const [state, setState] = useState<PublicShareState>({ status: 'loading' });
  const [password, setPassword] = useState('');
  const load = async (secret?: string) => {
    setState({ status: 'loading' });
    try {
      const response = await fetch(apiUrl(`/api/shares/public/${encodeURIComponent(token)}`), {
        method: secret === undefined ? 'GET' : 'POST',
        credentials: 'omit',
        headers: secret === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: secret === undefined ? undefined : JSON.stringify({ password: secret }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const error = asRecord(asRecord(payload).error);
        const code = recordText(error, ['code']);
        const message = recordText(error, ['message'], `SHARE_HTTP_${response.status}`);
        if (code === 'SHARE_PASSWORD_REQUIRED' || code === 'SHARE_PASSWORD_INVALID') {
          setState({ status: 'password-required', message });
          return;
        }
        throw new Error(message);
      }
      setState({ status: 'ready', data: payload });
    } catch (error) {
      setState({ status: 'error', error: error instanceof Error ? error : new Error('Shareを取得できませんでした。') });
    }
  };
  useEffect(() => { void load(); }, [token]);

  return <PublicPageFrame route={route} description="公開Snapshotを閲覧します。">
    {state.status === 'loading' && <BusyState />}
    {state.status === 'error' && <ErrorState error={state.error} onRetry={() => void load()} />}
    {state.status === 'password-required' && <Panel title="Password保護Share"><form className="platform-inline-form" onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void load(password); }}><Field label="Password" name="password" type="password" value={password} onChange={setPassword} required /><button className="platform-button is-primary" type="submit">表示</button></form><p>{state.message}</p></Panel>}
    {state.status === 'ready' && <><Panel title="共有Result"><KeyValueGrid value={asRecord(asRecord(state.data).share ?? asRecord(state.data).data ?? state.data)} /></Panel><RecordList items={asArray(asRecord(state.data).sections ?? asRecord(state.data).result, ['sections'])} titleKeys={['title', 'key']} subtitleKeys={['body', 'content']} /></>}
  </PublicPageFrame>;
}

function PrivateShareViewerPage({ route }: { route: RouteMatch }) {
  const identifier = route.params.id;
  const [resource, reload] = useResource(`/api/shares/${encodeURIComponent(identifier)}`);
  return <ResponsivePageShell route={route} description="指定AccountだけがPrivate Snapshotを閲覧できます。">{resource.status === 'loading' ? <BusyState /> : resource.status === 'error' ? <ErrorState error={resource.error} onRetry={reload} /> : <><Panel title="共有Result"><KeyValueGrid value={asRecord(resource.data).share ?? asRecord(resource.data).data ?? resource.data} /></Panel><RecordList items={asArray(asRecord(resource.data).sections ?? asRecord(resource.data).result, ['sections'])} titleKeys={['title', 'key']} subtitleKeys={['body', 'content']} /></>}</ResponsivePageShell>;
}

function SharesPage({ route }: { route: RouteMatch }) {
  const [resource, reload] = useResource('/api/shares');
  const resultId = new URLSearchParams(window.location.search).get('result')?.trim() || '';
  const [submit, setSubmit] = useState<SubmitState>({ type: 'idle' });
  const [createdUrl, setCreatedUrl] = useState('');
  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const visibility = textValue(data.get('visibility')) || 'public';
    const payload: Record<string, unknown> = {
      result_id: resultId,
      visibility,
      download_allowed: data.get('download_allowed') === 'on',
    };
    const password = textValue(data.get('password'));
    const recipient = textValue(data.get('recipient_user_id'));
    const expiresAt = textValue(data.get('expires_at'));
    if (password) payload.password = password;
    if (recipient) payload.recipient_user_id = recipient;
    if (expiresAt) payload.expires_at = new Date(expiresAt).toISOString();
    const response = await submitForm('/api/shares', payload, setSubmit, { success: 'Shareを作成しました。', idempotent: true });
    const root = asRecord(response);
    const share = asRecord(root.share ?? root.data ?? root);
    const url = recordText(share, ['url']);
    setCreatedUrl(url ? new URL(url, window.location.origin).toString() : '');
    if (response) reload();
  };
  const revoke = async (shareId: string) => {
    setSubmit({ type: 'working' });
    try {
      const response = await fetch(apiUrl(`/api/shares/${encodeURIComponent(shareId)}`), { method: 'DELETE', credentials: 'include', headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`SHARE_REVOKE_HTTP_${response.status}`);
      setSubmit({ type: 'success', message: 'Shareを失効しました。' });
      reload();
    } catch (error) {
      setSubmit({ type: 'error', code: 'SHARE_REVOKE_FAILED', message: error instanceof Error ? error.message : 'Shareを失効できませんでした。' });
    }
  };
  const shares = resource.status === 'ready' ? asArray(resource.data, ['shares', 'items']) : [];
  return <ResponsivePageShell route={route} description="Public／Private Share、期限、Revokeを管理します。">
    {resultId && <Panel title="新しいShare"><form className="platform-form" onSubmit={create}><label className="platform-field"><span>共有方式</span><select name="visibility" defaultValue="public"><option value="public">Public</option><option value="private">Private</option></select></label><Field label="Public Password（任意・8文字以上）" name="password" type="password" /><Field label="Private共有先 Account ID" name="recipient_user_id" /><Field label="Private期限" name="expires_at" type="datetime-local" /><label className="platform-toggle-row"><span><strong>Downloadを許可</strong></span><input type="checkbox" name="download_allowed" /></label><button className="platform-button is-primary" type="submit" disabled={submit.type === 'working'}>Share作成</button></form><FormResult state={submit} />{createdUrl && <div className="platform-action-row"><input className="platform-input" value={createdUrl} readOnly aria-label="今回作成したShare URL" /><button className="platform-button" type="button" onClick={() => void navigator.clipboard.writeText(createdUrl)}>URLをコピー</button></div>}</Panel>}
    <Panel title="共有中のResult">
      {resource.status === 'loading' && <BusyState />}
      {resource.status === 'error' && <ErrorState error={resource.error} onRetry={reload} />}
      {resource.status === 'ready' && (shares.length ? <div className="platform-card-grid">{shares.map((item) => { const record = asRecord(item); const id = recordText(record, ['share_id', 'id']); const visibility = recordText(record, ['visibility']); const status = recordText(record, ['status']); return <article className="platform-link-card" key={id}><strong>{visibility === 'public' ? `Public ${recordText(record, ['token_prefix'], id)}` : `Private ${id}`}</strong><span>{status} / {recordText(record, ['expires_at'])}</span>{visibility === 'private' && <button className="platform-button" type="button" onClick={() => void navigator.clipboard.writeText(new URL(`/share/${encodeURIComponent(id)}`, window.location.origin).toString())}>Private URLをコピー</button>}<button className="platform-button" type="button" disabled={status === 'revoked'} onClick={() => void revoke(id)}>Revoke</button></article>; })}</div> : <EmptyState>作成済みShareはありません。</EmptyState>)}
    </Panel>
  </ResponsivePageShell>;
}

function AboutPage({ route }: { route: RouteMatch }) {
  const hp = (import.meta.env.VITE_ASTERA_HP_URL as string | undefined) ?? 'https://asterav8.jp/';
  return <ResponsivePageShell route={route} description="製品説明は公式HP正本を参照し、AppではVersionと接続情報を表示します。"><Panel title="Astera App"><dl className="platform-kv-grid"><div><dt>Frontend</dt><dd>React / TypeScript / Vite</dd></div><div><dt>Platforms</dt><dd>Web / Android / iOS</dd></div><div><dt>Application ID</dt><dd>jp.asterav8.app</dd></div></dl></Panel><a className="platform-button" href={hp}>公式HPを開く</a></ResponsivePageShell>;
}

const legalDocuments: Record<string, { endpoint: string; description: string }> = {
  legal: { endpoint: '/api/legal', description: '現在有効な法務文書のVersionと公開状態を確認します。' },
  'legal-terms': { endpoint: '/api/legal/terms', description: 'Astera App利用規約の現在Versionです。' },
  'legal-privacy': { endpoint: '/api/legal/privacy', description: '個人情報と利用Dataの取扱いを確認します。' },
  'legal-commercial': { endpoint: '/api/legal/commercial', description: '販売条件と事業者情報を確認します。' },
  'legal-api-terms': { endpoint: '/api/legal/api-terms', description: 'Developer API利用条件を確認します。' },
};

function LegalPage({ route }: { route: RouteMatch }) {
  const document = legalDocuments[route.id] ?? legalDocuments.legal;
  const [resource, reload] = useResource(document.endpoint);
  return <PublicPageFrame route={route} description={document.description}>{resource.status === 'loading' ? <BusyState /> : resource.status === 'error' ? <ErrorState error={resource.error} onRetry={reload} /> : <article className="platform-legal-document"><KeyValueGrid value={resource.data} /></article>}</PublicPageFrame>;
}

function StatusPage({ route }: { route: RouteMatch }) {
  const [resource, reload] = useResource('/api/status');
  const offline = route.id === 'offline' || !navigator.onLine;
  return <PublicPageFrame route={route} description="Web、Android、iOSで同じSystem状態を表示します。"><Panel title="接続状態"><dl className="platform-kv-grid"><div><dt>Browser / WebView</dt><dd>{navigator.onLine ? 'Online' : 'Offline'}</dd></div><div><dt>Route</dt><dd>{route.id}</dd></div></dl></Panel>{offline ? <EmptyState>Networkへ接続後、再確認してください。入力中Dataは自動送信しません。</EmptyState> : resource.status === 'loading' ? <BusyState /> : resource.status === 'error' ? <ErrorState error={resource.error} onRetry={reload} /> : <Panel title="Astera System"><KeyValueGrid value={resource.data} /></Panel>}</PublicPageFrame>;
}

function SupportPage({ route }: { route: RouteMatch }) {
  const hp = (import.meta.env.VITE_ASTERA_HP_URL as string | undefined) ?? 'https://asterav8.jp/';
  return <PublicPageFrame route={route} description="Customer AIと正式な問い合わせ導線を使用します。"><div className="platform-card-grid"><a className="platform-link-card" href={`${hp.replace(/\/$/, '')}/support`}><strong>Support Center</strong><span>操作説明・問い合わせ</span><b>↗</b></a><a className="platform-link-card" href="/status"><strong>System Status</strong><span>障害・Maintenance確認</span><b>›</b></a></div></PublicPageFrame>;
}

function NotFoundPage({ route }: { route: RouteMatch }) {
  return <PublicPageFrame route={route} description="指定されたPageはCanonical Route Registryにありません。"><EmptyState><p>{window.location.pathname}</p><a className="platform-button is-primary" href="/app/new">Astera Appへ戻る</a></EmptyState></PublicPageFrame>;
}

export function PublicPlatformPage({ route }: { route: RouteMatch }) {
  switch (route.id) {
    case 'public-share': return <PublicShareViewerPage route={route} />;
    case 'private-share': return <PrivateShareViewerPage route={route} />;
    case 'shares': return <SharesPage route={route} />;
    case 'about': return <AboutPage route={route} />;
    case 'legal': case 'legal-terms': case 'legal-privacy': case 'legal-commercial': case 'legal-api-terms': return <LegalPage route={route} />;
    case 'status': case 'offline': case 'maintenance': return <StatusPage route={route} />;
    case 'support': return <SupportPage route={route} />;
    default: return <NotFoundPage route={route} />;
  }
}
