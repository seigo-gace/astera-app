import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { asArray, asRecord, recordText, textValue, type JsonObject } from '../../platform/api-client';
import type { RouteMatch } from '../../platform/route-registry';
import { BusyState, EmptyState, ErrorState, ResponsivePageShell } from '../../platform/ResponsivePageShell';
import { Field, FormResult, Panel, submitForm, useResource, type SubmitState } from '../../platform/pages/page-kit';
import './share-management-page.css';

type Visibility = 'public' | 'private';

function localDateTime(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '';
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function ManagedShareCard({ value, reload }: { value: JsonObject; reload: () => void }) {
  const id = recordText(value, ['share_id', 'id']);
  const visibility = recordText(value, ['visibility']) as Visibility;
  const status = recordText(value, ['status']);
  const revoked = status === 'revoked';
  const [expiresAt, setExpiresAt] = useState(localDateTime(recordText(value, ['expires_at'])));
  const [downloadAllowed, setDownloadAllowed] = useState(value.download_allowed === true);
  const [recipient, setRecipient] = useState(recordText(value, ['recipient_user_id']));
  const [password, setPassword] = useState('');
  const [clearPassword, setClearPassword] = useState(false);
  const [state, setState] = useState<SubmitState>({ type: 'idle' });

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const payload: JsonObject = {
      expires_at: new Date(expiresAt).toISOString(),
      download_allowed: downloadAllowed,
    };
    if (visibility === 'public') {
      if (password.trim()) payload.password = password.trim();
      if (clearPassword) payload.clear_password = true;
    } else {
      payload.recipient_user_id = recipient.trim();
    }
    const response = await submitForm(`/api/shares/${encodeURIComponent(id)}`, payload, setState, {
      method: 'PATCH',
      success: 'Share設定を更新しました。',
      idempotent: true,
    });
    if (!response) return;
    setPassword('');
    setClearPassword(false);
    reload();
  };

  const revoke = async () => {
    if (!window.confirm('このShareを失効します。元に戻せません。')) return;
    const response = await submitForm(`/api/shares/${encodeURIComponent(id)}`, {}, setState, {
      method: 'DELETE',
      success: 'Shareを失効しました。',
      idempotent: true,
    });
    if (response) reload();
  };

  return (
    <article className={`share-management-card is-${status || 'unknown'}`}>
      <header>
        <div><span>{visibility === 'public' ? 'Public' : 'Private'}</span><strong>{visibility === 'public' ? `Prefix ${recordText(value, ['token_prefix'], '—')}` : id}</strong></div>
        <b>{status || 'unknown'}</b>
      </header>
      <dl>
        <div><dt>Result</dt><dd>{recordText(value, ['result_id'], '—')}</dd></div>
        <div><dt>Revision</dt><dd>r{textValue(value.revision_number, '1')}</dd></div>
        <div><dt>Download</dt><dd>{downloadAllowed ? '許可' : '不可'}</dd></div>
        {visibility === 'public' && <div><dt>Password</dt><dd>{value.password_protected === true ? '設定済み' : 'なし'}</dd></div>}
      </dl>
      <form className="share-management-edit" onSubmit={save}>
        <Field label="期限" name={`expires-${id}`} type="datetime-local" value={expiresAt} onChange={setExpiresAt} required />
        <label className="platform-toggle-row"><span><strong>Downloadを許可</strong></span><input type="checkbox" checked={downloadAllowed} disabled={revoked} onChange={(event) => setDownloadAllowed(event.target.checked)} /></label>
        {visibility === 'public' ? <>
          <Field label="新しいPassword（変更時のみ・8文字以上）" name={`password-${id}`} type="password" value={password} onChange={setPassword} />
          <label className="platform-toggle-row"><span><strong>Passwordを解除</strong></span><input type="checkbox" checked={clearPassword} disabled={revoked || !value.password_protected} onChange={(event) => setClearPassword(event.target.checked)} /></label>
        </> : <Field label="Recipient Account ID" name={`recipient-${id}`} value={recipient} onChange={setRecipient} required />}
        <div className="platform-action-row">
          <button className="platform-button is-primary" type="submit" disabled={revoked || state.type === 'working'}>設定を保存</button>
          <button className="platform-button" type="button" disabled={revoked || state.type === 'working'} onClick={() => void revoke()}>Revoke</button>
          {visibility === 'private' && <button className="platform-button" type="button" onClick={() => void navigator.clipboard.writeText(new URL(`/share/${encodeURIComponent(id)}`, window.location.origin).toString())}>Private URLをCopy</button>}
        </div>
      </form>
      <FormResult state={state} />
    </article>
  );
}

export default function ShareManagementPage({ route }: { route: RouteMatch }) {
  const initialResult = new URLSearchParams(window.location.search).get('result')?.trim() || '';
  const [resource, reload] = useResource('/api/shares');
  const [history] = useResource('/api/history?limit=100');
  const historyItems = history.status === 'ready' ? asArray(history.data, ['history', 'items', 'results']).map(asRecord) : [];
  const [resultId, setResultId] = useState(initialResult);
  const [visibility, setVisibility] = useState<Visibility>('public');
  const [revision, setRevision] = useState(0);
  const revisionsEndpoint = resultId ? `/api/results/${encodeURIComponent(resultId)}/revisions` : null;
  const [revisions] = useResource(revisionsEndpoint);
  const revisionRoot = revisions.status === 'ready' ? asRecord(revisions.data) : {};
  const revisionItems = revisions.status === 'ready' ? asArray(revisionRoot.revisions ?? revisionRoot.items) : [];
  const currentRevision = Number(revisionRoot.current_revision || 0);
  const [createState, setCreateState] = useState<SubmitState>({ type: 'idle' });
  const [createdUrl, setCreatedUrl] = useState('');

  useEffect(() => {
    if (currentRevision > 0) setRevision(currentRevision);
    else setRevision(0);
  }, [currentRevision, resultId]);

  const resultOptions = useMemo(() => {
    const items = historyItems.map((item) => ({ id: recordText(item, ['result_id', 'id']), title: recordText(item, ['title'], 'Astera Result') })).filter((item) => item.id);
    if (initialResult && !items.some((item) => item.id === initialResult)) items.unshift({ id: initialResult, title: `Result ${initialResult}` });
    return items;
  }, [historyItems, initialResult]);

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const payload: JsonObject = {
      result_id: resultId,
      visibility,
      revision: revision || undefined,
      download_allowed: data.get('download_allowed') === 'on',
    };
    const expiresAt = textValue(data.get('expires_at'));
    if (expiresAt) payload.expires_at = new Date(expiresAt).toISOString();
    if (visibility === 'public') {
      const password = textValue(data.get('password'));
      if (password) payload.password = password;
    } else {
      payload.recipient_user_id = textValue(data.get('recipient_user_id'));
    }
    const response = await submitForm('/api/shares', payload, setCreateState, { success: 'Shareを作成しました。', idempotent: true });
    if (!response) return;
    const root = asRecord(response);
    const share = asRecord(root.share ?? root.data ?? root);
    const relativeUrl = recordText(root, ['url']) || recordText(share, ['url']);
    setCreatedUrl(relativeUrl ? new URL(relativeUrl, window.location.origin).toString() : '');
    reload();
  };

  const shares = resource.status === 'ready' ? asArray(resource.data, ['shares', 'items']).map(asRecord) : [];
  return (
    <ResponsivePageShell route={route} description="Public／Private ShareをResult Revision単位で作成し、期限・Download・Password／Recipient・Revokeを管理します。">
      <Panel title="新しいShare">
        <form className="share-create-form" onSubmit={create}>
          <label className="platform-field"><span>共有するResult</span><select value={resultId} required onChange={(event) => { setResultId(event.target.value); setCreatedUrl(''); }}><option value="">Resultを選択</option>{resultOptions.map((item) => <option value={item.id} key={item.id}>{item.title} · {item.id}</option>)}</select></label>
          <label className="platform-field"><span>Revision</span><select value={revision || ''} required disabled={!resultId || revisions.status !== 'ready'} onChange={(event) => setRevision(Number(event.target.value))}><option value="">Revisionを選択</option>{revisionItems.map((item) => { const record = asRecord(item); const number = Number(record.revision_number || 0); return number > 0 ? <option value={number} key={number}>r{number} · {recordText(record, ['revision_kind'], 'generated')}</option> : null; })}</select></label>
          <label className="platform-field"><span>共有方式</span><select value={visibility} onChange={(event) => setVisibility(event.target.value as Visibility)}><option value="public">Public</option><option value="private">Private</option></select></label>
          <Field label={visibility === 'public' ? '期限（未指定は7日）' : '期限（必須）'} name="expires_at" type="datetime-local" required={visibility === 'private'} />
          {visibility === 'public'
            ? <Field label="Password（任意・8文字以上）" name="password" type="password" />
            : <Field label="Recipient Account ID" name="recipient_user_id" required />}
          <label className="platform-toggle-row"><span><strong>Downloadを許可</strong></span><input type="checkbox" name="download_allowed" /></label>
          <button className="platform-button is-primary" type="submit" disabled={!resultId || !revision || createState.type === 'working'}>Share作成</button>
        </form>
        <FormResult state={createState} />
        {createdUrl && <div className="share-one-time-url" role="status"><strong>今回だけ表示するShare URL</strong><input className="platform-input" value={createdUrl} readOnly /><button className="platform-button" type="button" onClick={() => void navigator.clipboard.writeText(createdUrl)}>URLをCopy</button><small>Public Token全文は一覧へ保存表示しません。このURLを今ここで控えてください。</small></div>}
      </Panel>

      <Panel title="作成済みShare">
        {resource.status === 'loading' && <BusyState />}
        {resource.status === 'error' && <ErrorState error={resource.error} onRetry={reload} />}
        {resource.status === 'ready' && shares.length === 0 && <EmptyState>作成済みShareはありません。</EmptyState>}
        {resource.status === 'ready' && shares.length > 0 && <div className="share-management-list">{shares.map((share) => <ManagedShareCard key={recordText(share, ['share_id', 'id'])} value={share} reload={reload} />)}</div>}
      </Panel>
    </ResponsivePageShell>
  );
}
