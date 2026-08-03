import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { apiUrl, asArray, asRecord, recordText, textValue } from '../api-client';
import { openExternalUrl } from '../external-navigation';
import type { RouteMatch } from '../route-registry';
import { BusyState, ErrorState, ResponsivePageShell } from '../ResponsivePageShell';
import { Field, FormResult, KeyValueGrid, Panel, RecordList, ResourceShell, submitForm, useResource, type SubmitState } from './page-kit';

function ResultActions({ id, title }: { id: string; title: string }) {
  const [state, setState] = useState<SubmitState>({ type: 'idle' });

  const download = async () => {
    setState({ type: 'working' });
    try {
      const response = await fetch(apiUrl(`/api/results/${encodeURIComponent(id)}/download`), {
        method: 'POST',
        credentials: 'include',
        headers: { Accept: 'text/markdown,application/octet-stream' },
      });
      if (!response.ok) throw new Error(`RESULT_DOWNLOAD_HTTP_${response.status}`);
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = `${title.replace(/[\\/:*?"<>|]/g, '_') || 'Astera-result'}.md`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
      setState({ type: 'success', message: '保存・共有画面へ渡しました。' });
    } catch (error) {
      setState({ type: 'error', message: error instanceof Error ? error.message : 'Downloadに失敗しました。', code: 'RESULT_DOWNLOAD_FAILED' });
    }
  };

  return <><div className="platform-action-row"><button className="platform-button" type="button" disabled={state.type === 'working'} onClick={() => void download()}>Download</button><a className="platform-button" href={`/app/shares?result=${encodeURIComponent(id)}`}>共有設定</a></div><FormResult state={state} /></>;
}

function ResultDetailPage({ route }: { route: RouteMatch }) {
  const id = route.params.id;
  return (
    <ResourceShell route={route} endpoint={`/api/results/${encodeURIComponent(id)}`} description="保存済みResult、8項目、Revision、共有状態を確認します。">
      {(payload) => {
        const root = asRecord(payload);
        const result = asRecord(root.result ?? root.data ?? root);
        const sections = asArray(result.sections ?? root.sections);
        const title = recordText(result, ['title', 'name'], 'Astera Result');
        return <>
          <Panel title={title}><KeyValueGrid value={result} /></Panel>
          <Panel title="判断材料 8項目"><RecordList items={sections} titleKeys={['title', 'key']} subtitleKeys={['body', 'content']} empty="Result項目が不足しています。" /></Panel>
          <ResultActions id={id} title={title} />
        </>;
      }}
    </ResourceShell>
  );
}

function ProjectsPage({ route }: { route: RouteMatch }) {
  const [state, reload] = useResource('/api/projects');
  const [submit, setSubmit] = useState<SubmitState>({ type: 'idle' });
  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const result = await submitForm('/api/projects', { name: textValue(data.get('name')) }, setSubmit, { success: 'Projectを作成しました。', idempotent: true });
    if (result) { event.currentTarget.reset(); reload(); }
  };
  return (
    <ResponsivePageShell route={route} description="単階層Projectを作成し、Resultを整理します。">
      <Panel title="新規Project"><form className="platform-inline-form" onSubmit={create}><Field label="Project名" name="name" required /><button className="platform-button is-primary" type="submit" disabled={submit.type === 'working'}>作成</button></form><FormResult state={submit} /></Panel>
      <Panel title="Project一覧">
        {state.status === 'loading' && <BusyState />}
        {state.status === 'error' && <ErrorState error={state.error} onRetry={reload} />}
        {state.status === 'ready' && <RecordList items={asArray(state.data, ['projects', 'items'])} titleKeys={['name', 'title', 'project_id', 'id']} subtitleKeys={['description', 'updated_at', 'status']} />}
      </Panel>
    </ResponsivePageShell>
  );
}

function HistoryPage({ route }: { route: RouteMatch }) {
  const [search, setSearch] = useState('');
  const endpoint = `/api/history${search ? `?q=${encodeURIComponent(search)}` : ''}`;
  const [state, reload] = useResource(endpoint);
  return (
    <ResponsivePageShell route={route} description="Server保存済みHistoryを検索し、Resultへ移動します。">
      <Panel title="検索"><form className="platform-inline-form" onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); reload(); }}><Field label="Keyword" name="q" value={search} onChange={setSearch} /><button className="platform-button" type="submit">検索</button></form></Panel>
      <Panel title="History">
        {state.status === 'loading' && <BusyState />}
        {state.status === 'error' && <ErrorState error={state.error} onRetry={reload} />}
        {state.status === 'ready' && <RecordList items={asArray(state.data, ['history', 'items', 'results'])} titleKeys={['title', 'prompt', 'name', 'result_id', 'id']} subtitleKeys={['created_at', 'updated_at', 'status']} link={(record) => { const id = recordText(record, ['result_id', 'id']); return id ? `/app/results/${encodeURIComponent(id)}` : null; }} />}
      </Panel>
    </ResponsivePageShell>
  );
}

const settingsCards = [
  ['/app/settings/options', 'Option設定', '実行候補とPrivate関連設定'],
  ['/app/settings/language', '表示・言語', 'Theme、言語、Motion'],
  ['/app/settings/templates', '個別Template管理', '個人Templateの作成・更新'],
  ['/app/settings/storage-destinations', '外部Storage接続', 'OAuth接続と転送先'],
  ['/app/settings/astera-storage', 'Astera Storage', '容量、利用量、Grace'],
  ['/app/settings/data-privacy', 'Data・Privacy', '保存、Export、退会'],
  ['/app/settings/notifications', '通知・Credit警告', 'App内通知、Email、Push'],
] as const;

function SettingsIndexPage({ route }: { route: RouteMatch }) {
  return <ResponsivePageShell route={route} description="設定Categoryを選択します。"><div className="platform-card-grid">{settingsCards.map(([href, title, description]) => <a className="platform-link-card" href={href} key={href}><strong>{title}</strong><span>{description}</span><b>›</b></a>)}</div></ResponsivePageShell>;
}

function PreferencePage({ route, kind }: { route: RouteMatch; kind: 'options' | 'language' | 'privacy' | 'notifications' }) {
  const endpoint = kind === 'notifications' ? '/api/credit/notification-preferences' : '/api/preferences';
  const [resource, reload] = useResource(endpoint);
  const [state, setState] = useState<SubmitState>({ type: 'idle' });
  const defaults = useMemo<Record<string, string | boolean>>(() => {
    const allDefaults: Record<'options' | 'language' | 'privacy' | 'notifications', Record<string, string | boolean>> = {
      options: { translation: true, agent_mode: true, document: true, storage_transfer: true, private_mode_default: true },
      language: { ui_language: document.documentElement.lang || 'ja', theme: document.documentElement.dataset.theme || 'system', reduced_motion: false },
      privacy: { history_enabled: true, analytics_enabled: false, private_mode_default: true },
      notifications: { in_app_enabled: true, email_enabled: false, push_enabled: false, low_credit_threshold: '20', quiet_hours_start: '22:00', quiet_hours_end: '08:00' },
    };
    return { ...allDefaults[kind] };
  }, [kind]);
  const [values, setValues] = useState<Record<string, string | boolean>>(defaults);

  useEffect(() => {
    if (resource.status !== 'ready') return;
    const root = asRecord(resource.data);
    const data = asRecord(root.preferences ?? root.data ?? root);
    const merged: Record<string, string | boolean> = { ...defaults };
    for (const [key, value] of Object.entries(data)) {
      if (typeof value === 'boolean' || typeof value === 'string' || typeof value === 'number') merged[key] = typeof value === 'number' ? String(value) : value;
    }
    setValues(merged);
  }, [defaults, resource]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    await submitForm(endpoint, values, setState, { method: 'PATCH', success: '設定を保存しました。', idempotent: true });
    reload();
  };

  const labels: Record<string, string> = {
    translation: '高精度翻訳を候補へ表示', agent_mode: 'Agent Modeを候補へ表示', document: '書類作成を候補へ表示', storage_transfer: '外部Storage転送を候補へ表示', private_mode_default: 'Private Modeを既定ON',
    ui_language: 'システム言語', theme: 'Appearance', reduced_motion: 'Motionを抑制', history_enabled: '通常ModeのHistory保存', analytics_enabled: '任意Analytics',
    in_app_enabled: 'App内安全通知（必須）', email_enabled: 'Email通知', push_enabled: 'Push通知', low_credit_threshold: 'Credit警告閾値', quiet_hours_start: 'Quiet Hours開始', quiet_hours_end: 'Quiet Hours終了',
  };

  return (
    <ResponsivePageShell route={route} description="Account Preferenceを端末種別に依存せず保存します。">
      {resource.status === 'loading' && <BusyState />}
      {resource.status === 'error' && <ErrorState error={resource.error} onRetry={reload} />}
      <form className="platform-settings-form" onSubmit={save}>
        {Object.entries(values).map(([key, value]) => typeof value === 'boolean' ? (
          <label className="platform-toggle-row" key={key}><span><strong>{labels[key] ?? key}</strong></span><input type="checkbox" checked={value} disabled={key === 'in_app_enabled'} onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.checked }))} /></label>
        ) : <Field key={key} label={labels[key] ?? key} name={key} value={String(value)} onChange={(next) => setValues((current) => ({ ...current, [key]: next }))} />)}
        <button className="platform-button is-primary" type="submit" disabled={state.type === 'working'}>保存</button><FormResult state={state} />
      </form>
    </ResponsivePageShell>
  );
}

function TemplatesPage({ route }: { route: RouteMatch }) {
  const [resource, reload] = useResource('/api/templates');
  const [state, setState] = useState<SubmitState>({ type: 'idle' });
  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    const result = await submitForm('/api/templates', { title: textValue(data.get('title')), content: textValue(data.get('content')) }, setState, { success: 'Templateを保存しました。', idempotent: true });
    if (result) { event.currentTarget.reset(); reload(); }
  };
  return <ResponsivePageShell route={route} description="個人Templateを管理し、Composerの書類作成Pickerから選択します。"><Panel title="Template追加"><form className="platform-form" onSubmit={create}><Field label="名称" name="title" required /><label className="platform-field"><span>本文</span><textarea name="content" required rows={7} /></label><button className="platform-button is-primary" type="submit">保存</button></form><FormResult state={state} /></Panel><Panel title="保存済みTemplate">{resource.status === 'loading' ? <BusyState /> : resource.status === 'error' ? <ErrorState error={resource.error} onRetry={reload} /> : <RecordList items={asArray(resource.data, ['templates', 'items'])} titleKeys={['title', 'name', 'id']} subtitleKeys={['updated_at', 'description']} />}</Panel></ResponsivePageShell>;
}

function StorageDestinationsPage({ route }: { route: RouteMatch }) {
  const [resource, reload] = useResource('/api/storage/destinations');
  const [state, setState] = useState<SubmitState>({ type: 'idle' });
  const authorize = async (provider: string) => {
    const payload = await submitForm('/api/storage/destinations/authorize', { provider, return_to: window.location.pathname, native_callback: 'jp.asterav8.app://open/app/settings/storage-destinations' }, setState, { success: '認証画面を開きます。', idempotent: true });
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
    case 'result-detail': return <ResultDetailPage route={route} />;
    case 'projects': return <ProjectsPage route={route} />;
    case 'history': return <HistoryPage route={route} />;
    case 'settings': return <SettingsIndexPage route={route} />;
    case 'settings-options': return <PreferencePage route={route} kind="options" />;
    case 'settings-language': return <PreferencePage route={route} kind="language" />;
    case 'settings-data-privacy': return <PreferencePage route={route} kind="privacy" />;
    case 'settings-notifications': return <PreferencePage route={route} kind="notifications" />;
    case 'settings-templates': return <TemplatesPage route={route} />;
    case 'settings-storage-destinations': return <StorageDestinationsPage route={route} />;
    case 'settings-astera-storage': return <AsteraStoragePage route={route} />;
    default: return null;
  }
}
