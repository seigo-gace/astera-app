import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { asArray, asRecord, recordText, textValue, type JsonObject } from '../../platform/api-client';
import type { RouteMatch } from '../../platform/route-registry';
import { BusyState, EmptyState, ErrorState, ResponsivePageShell } from '../../platform/ResponsivePageShell';
import { FormResult, Panel, submitForm, useResource, type SubmitState } from '../../platform/pages/page-kit';
import './template-settings-page.css';

function list(value: string): string[] {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}
function join(value: unknown): string {
  return Array.isArray(value) ? value.map(String).join(', ') : '';
}

export default function TemplateSettingsPage({ route }: { route: RouteMatch }) {
  const [resource, reload] = useResource('/api/templates');
  const templates = useMemo(() => resource.status === 'ready' ? asArray(resource.data, ['templates', 'items']).map(asRecord) : [], [resource]);
  const [selectedId, setSelectedId] = useState('');
  const selected = templates.find((item) => recordText(item, ['template_id', 'id']) === selectedId) ?? null;
  const [versions] = useResource(selectedId ? `/api/templates/${encodeURIComponent(selectedId)}/versions` : null);
  const versionItems = versions.status === 'ready' ? asArray(versions.data, ['versions', 'items']).map(asRecord) : [];
  const [state, setState] = useState<SubmitState>({ type: 'idle' });
  const [title, setTitle] = useState('');
  const [fileId, setFileId] = useState('');
  const [locale, setLocale] = useState('ja-JP');
  const [timeZone, setTimeZone] = useState('Asia/Tokyo');
  const [allowedSheets, setAllowedSheets] = useState('');
  const [allowedRanges, setAllowedRanges] = useState('');
  const [prohibited, setProhibited] = useState('');
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    document.documentElement.dataset.templateDedicatedOwner = 'true';
    return () => { delete document.documentElement.dataset.templateDedicatedOwner; };
  }, []);
  useEffect(() => {
    if (templates.length === 0) { setSelectedId(''); return; }
    if (!templates.some((item) => recordText(item, ['template_id', 'id']) === selectedId)) {
      setSelectedId(recordText(templates[0], ['template_id', 'id']));
    }
  }, [selectedId, templates]);
  useEffect(() => {
    if (!selected) return;
    setTitle(recordText(selected, ['title']));
    setFileId(recordText(selected, ['google_file_id']));
    setLocale(recordText(selected, ['locale'], 'ja-JP'));
    setTimeZone(recordText(selected, ['time_zone'], 'Asia/Tokyo'));
    setAllowedSheets(join(selected.allowed_sheets));
    setAllowedRanges(join(selected.allowed_ranges));
    setProhibited(recordText(selected, ['prohibited_elements']));
    setEnabled(selected.enabled !== false);
  }, [selectedId, selected]);

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const response = await submitForm('/api/templates', {
      title: textValue(data.get('title')),
      provider: 'google-sheets',
      google_file_id: textValue(data.get('google_file_id')),
      locale: textValue(data.get('locale')) || 'ja-JP',
      time_zone: textValue(data.get('time_zone')) || 'Asia/Tokyo',
      allowed_sheets: list(textValue(data.get('allowed_sheets'))),
      allowed_ranges: list(textValue(data.get('allowed_ranges'))),
      prohibited_elements: textValue(data.get('prohibited_elements')),
      enabled: true,
    }, setState, { success: '個別Templateを登録しました。', idempotent: true });
    if (!response) return;
    event.currentTarget.reset();
    reload();
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedId || !selected) return;
    const response = await submitForm(`/api/templates/${encodeURIComponent(selectedId)}`, {
      expected_version: Number(selected.version || 0),
      title,
      google_file_id: fileId,
      locale,
      time_zone: timeZone,
      allowed_sheets: list(allowedSheets),
      allowed_ranges: list(allowedRanges),
      prohibited_elements: prohibited,
      enabled,
    }, setState, { method: 'PATCH', success: 'Templateを新Versionとして保存しました。', idempotent: true });
    if (response) reload();
  };

  const duplicate = async () => {
    if (!selectedId || !selected) return;
    const response = await submitForm(`/api/templates/${encodeURIComponent(selectedId)}/duplicate`, {
      title: `${recordText(selected, ['title'], 'Template')} コピー`,
    }, setState, { success: 'Templateを複製しました。', idempotent: true });
    if (response) reload();
  };

  const remove = async () => {
    if (!selectedId || !window.confirm('個別Templateを削除します。Version履歴用Snapshotは保持されます。')) return;
    const response = await submitForm(`/api/templates/${encodeURIComponent(selectedId)}`, {}, setState, {
      method: 'DELETE', success: 'Templateを削除しました。', idempotent: true,
    });
    if (response) { setSelectedId(''); reload(); }
  };

  return <ResponsivePageShell route={route} description="Google Sheets固定書式の個別Templateを作成・編集・複製・有効化・Version管理します。">
    <Panel title="Astera公式Template">
      <div className="template-official-callout"><strong>公式TemplateはAstera側で用意・管理します。</strong><p>利用者は編集せず、Composerの書類作成 → @ から「Astera公式テンプレート／個別テンプレート」を選びます。公式Catalogの実IDをこの画面で作成しません。</p></div>
    </Panel>

    <Panel title="個別Templateを追加">
      <form className="template-create-grid" onSubmit={create}>
        <label className="platform-field"><span>名称</span><input name="title" required maxLength={120} /></label>
        <label className="platform-field"><span>Google Sheets File ID</span><input name="google_file_id" required /></label>
        <label className="platform-field"><span>Locale</span><input name="locale" defaultValue="ja-JP" /></label>
        <label className="platform-field"><span>Time zone</span><input name="time_zone" defaultValue="Asia/Tokyo" /></label>
        <label className="platform-field"><span>許可Sheet</span><input name="allowed_sheets" placeholder="Sheet1, Invoice" /></label>
        <label className="platform-field"><span>許可Range / Named Range</span><input name="allowed_ranges" placeholder="B4:F20, invoice_items" /></label>
        <label className="platform-field template-wide"><span>禁止要素 / 注意事項</span><textarea name="prohibited_elements" rows={3} placeholder="Apps Script / Macro / Connected Sheets 等" /></label>
        <div className="platform-action-row template-wide"><a className="platform-button" href="/app/settings/storage-destinations">Google接続を管理</a><button className="platform-button" type="button" disabled title="Google Sheets実検査Backendが接続されるまで実行しません。">検査</button><button className="platform-button" type="button" disabled title="Diff Preview Backendが接続されるまで実行しません。">Preview</button><button className="platform-button is-primary" type="submit" disabled={state.type === 'working'}>登録</button></div>
      </form>
      <FormResult state={state} />
    </Panel>

    <div className="template-workspace-grid">
      <Panel title="個別Template一覧">
        {resource.status === 'loading' && <BusyState />}
        {resource.status === 'error' && <ErrorState error={resource.error} onRetry={reload} />}
        {resource.status === 'ready' && templates.length === 0 && <EmptyState>個別Templateはありません。</EmptyState>}
        {resource.status === 'ready' && templates.length > 0 && <div className="template-list">{templates.map((item) => {
          const id = recordText(item, ['template_id', 'id']);
          return <button className={`template-list-item${id === selectedId ? ' is-selected' : ''}`} type="button" key={id} aria-pressed={id === selectedId} onClick={() => setSelectedId(id)}><span><strong>{recordText(item, ['title'], id)}</strong><small>{recordText(item, ['provider'], 'legacy')} · v{textValue(item.version, '1')}</small></span><b>{recordText(item, ['lifecycle_state'], 'draft')}</b></button>;
        })}</div>}
      </Panel>

      <Panel title="Template詳細">
        {!selected && <EmptyState>Templateを選択してください。</EmptyState>}
        {selected && <form className="template-detail-form" onSubmit={save}>
          <label className="platform-field"><span>名称</span><input value={title} onChange={(event) => setTitle(event.target.value)} required /></label>
          <label className="platform-field"><span>Google Sheets File ID</span><input value={fileId} onChange={(event) => setFileId(event.target.value)} disabled={recordText(selected, ['provider']) !== 'google-sheets'} required={recordText(selected, ['provider']) === 'google-sheets'} /></label>
          <div className="template-two"><label className="platform-field"><span>Locale</span><input value={locale} onChange={(event) => setLocale(event.target.value)} /></label><label className="platform-field"><span>Time zone</span><input value={timeZone} onChange={(event) => setTimeZone(event.target.value)} /></label></div>
          <label className="platform-field"><span>許可Sheet</span><input value={allowedSheets} onChange={(event) => setAllowedSheets(event.target.value)} /></label>
          <label className="platform-field"><span>許可Range / Named Range</span><input value={allowedRanges} onChange={(event) => setAllowedRanges(event.target.value)} /></label>
          <label className="platform-field"><span>禁止要素 / 注意事項</span><textarea rows={3} value={prohibited} onChange={(event) => setProhibited(event.target.value)} /></label>
          <label className="platform-toggle-row"><span><strong>有効</strong><small>OFF時はComposerの個別Template候補から除外するための状態です。</small></span><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /></label>
          <dl className="template-facts"><div><dt>Lifecycle</dt><dd>{recordText(selected, ['lifecycle_state'], 'draft')}</dd></div><div><dt>Version</dt><dd>v{textValue(selected.version, '1')}</dd></div><div><dt>Provider</dt><dd>{recordText(selected, ['provider'], 'legacy')}</dd></div></dl>
          <div className="platform-action-row"><button className="platform-button is-primary" type="submit" disabled={state.type === 'working'}>新Versionで保存</button><button className="platform-button" type="button" onClick={() => void duplicate()}>複製</button><button className="platform-button" type="button" onClick={() => void remove()}>削除</button></div>
        </form>}
        {selected && <section className="template-version-section"><h3>Version履歴</h3>{versions.status === 'loading' && <BusyState />}{versions.status === 'error' && <ErrorState error={versions.error} />}{versions.status === 'ready' && versionItems.length === 0 && <EmptyState>Version履歴はありません。</EmptyState>}{versions.status === 'ready' && versionItems.length > 0 && <ol>{versionItems.map((item) => <li key={String(item.version)}><strong>v{textValue(item.version, '—')}</strong><span>{recordText(item, ['change_kind'], 'update')} · {recordText(item, ['created_at'])}</span></li>)}</ol>}</section>}
      </Panel>
    </div>
    <Panel title="未接続の検査境界"><p className="template-boundary-note">Google Sheets原本の権限検査、禁止要素検査、Diff Previewの実Backendは現行API Treeに存在しません。見た目だけ成功させず、接続されるまで検査／Previewは無効にします。</p></Panel>
  </ResponsivePageShell>;
}
