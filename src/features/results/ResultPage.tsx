import { useEffect, useMemo, useState } from 'react';
import { apiUrl, asArray, asRecord, recordText, textValue, type JsonObject } from '../../platform/api-client';
import type { RouteMatch } from '../../platform/route-registry';
import { BusyState, EmptyState, ErrorState, ResponsivePageShell } from '../../platform/ResponsivePageShell';
import { FormResult, Panel, submitForm, useResource, type SubmitState } from '../../platform/pages/page-kit';
import './result-page.css';

const EXPECTED_KEYS = [
  'true_purpose', 'missing_assumptions', 'fact_check', 'risk_detection',
  'counter_view', 'alternatives', 'recommendation', 'next_prompt',
] as const;

function resultId(route: RouteMatch): string {
  return route.params.id || '';
}

export default function ResultPage({ route }: { route: RouteMatch }) {
  const id = resultId(route);
  const [resource, reload] = useResource(`/api/results/${encodeURIComponent(id)}`);
  const [revisions, reloadRevisions] = useResource(`/api/results/${encodeURIComponent(id)}/revisions`);
  const [projects] = useResource('/api/projects?status=active');
  const root = resource.status === 'ready' ? asRecord(resource.data) : {};
  const result = resource.status === 'ready' ? asRecord(root.result ?? root.data ?? root) : {};
  const currentRevision = Number(result.current_revision || 0);
  const [selectedRevision, setSelectedRevision] = useState(0);

  useEffect(() => {
    if (currentRevision > 0 && selectedRevision === 0) setSelectedRevision(currentRevision);
  }, [currentRevision, selectedRevision]);
  useEffect(() => {
    if (resource.status === 'ready') window.scrollTo({ top: 0, behavior: 'auto' });
  }, [resource.status]);

  const selectedEndpoint = selectedRevision > 0 && selectedRevision !== currentRevision
    ? `/api/results/${encodeURIComponent(id)}/revisions/${selectedRevision}`
    : null;
  const [selectedResource] = useResource(selectedEndpoint);
  const selectedRoot = selectedResource.status === 'ready' ? asRecord(selectedResource.data) : {};
  const sections = selectedRevision === currentRevision || selectedRevision === 0
    ? asArray(result.sections)
    : selectedResource.status === 'ready'
      ? asArray(selectedRoot.sections)
      : [];
  const sources = asArray(result.sources);
  const revisionItems = revisions.status === 'ready' ? asArray(revisions.data, ['revisions', 'items']) : [];
  const projectItems = projects.status === 'ready' ? asArray(projects.data, ['projects', 'items']).map(asRecord) : [];
  const deleted = Boolean(result.deleted_at);
  const isCurrent = selectedRevision === currentRevision;
  const schemaComplete = EXPECTED_KEYS.every((key) => sections.some((item) => recordText(asRecord(item), ['key']) === key));

  const [action, setAction] = useState<SubmitState>({ type: 'idle' });
  const [sourceMode, setSourceMode] = useState<'number' | 'detail'>('number');
  const [editingKey, setEditingKey] = useState('');
  const [editText, setEditText] = useState('');

  const projectValue = typeof result.project_id === 'string' ? result.project_id : '';
  const title = recordText(result, ['title', 'name'], 'Astera Result');

  const saveSection = async (section: JsonObject) => {
    const key = recordText(section, ['key']);
    if (!key || !editText.trim() || !currentRevision) return;
    const response = await submitForm(`/api/results/${encodeURIComponent(id)}`, {
      base_revision: currentRevision,
      sections: { [key]: editText.trim() },
    }, setAction, { method: 'PATCH', success: '新しいRevisionとして保存しました。', idempotent: true });
    if (!response) return;
    const next = Number(asRecord(response).current_revision || currentRevision + 1);
    setEditingKey('');
    setSelectedRevision(next);
    reload();
    reloadRevisions();
  };

  const moveProject = async (target: string) => {
    const response = await submitForm(`/api/results/${encodeURIComponent(id)}`, {
      project_id: target || null,
    }, setAction, { method: 'PATCH', success: target ? 'ResultをProjectへ移動しました。' : 'ResultをUnassignedへ移動しました。', idempotent: true });
    if (response) reload();
  };

  const remove = async () => {
    if (!window.confirm('Resultを削除予定状態にします。共有は失効し、取消期限内ならUndoできます。')) return;
    const response = await submitForm(`/api/results/${encodeURIComponent(id)}`, {}, setAction, {
      method: 'DELETE',
      success: 'Resultを削除予定にしました。',
      idempotent: true,
    });
    if (response) reload();
  };

  const undo = async () => {
    const response = await submitForm(`/api/results/${encodeURIComponent(id)}/undo-delete`, {}, setAction, {
      success: 'Result削除を取り消しました。',
      idempotent: true,
    });
    if (response) reload();
  };

  const exportRevision = async (format: 'md' | 'txt' | 'json') => {
    setAction({ type: 'working' });
    try {
      const response = await fetch(apiUrl(`/api/results/${encodeURIComponent(id)}/export?format=${format}&revision=${selectedRevision || currentRevision}`), {
        credentials: 'include',
        headers: { Accept: '*/*' },
      });
      if (!response.ok) throw new Error(`RESULT_EXPORT_HTTP_${response.status}`);
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const disposition = response.headers.get('content-disposition') || '';
      const match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
      const filename = match ? decodeURIComponent(match[1]) : `${title}.${format}`;
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      setAction({ type: 'success', message: `Revision ${selectedRevision || currentRevision}を${format.toUpperCase()}で保存しました。` });
    } catch (error) {
      setAction({ type: 'error', message: error instanceof Error ? error.message : 'Exportに失敗しました。', code: 'RESULT_EXPORT_FAILED' });
    }
  };

  const copyAll = async () => {
    const text = sections.map((item) => {
      const section = asRecord(item);
      return `${recordText(section, ['title', 'key'])}\n${recordText(section, ['body', 'content'])}`;
    }).join('\n\n');
    try {
      await navigator.clipboard.writeText(text);
      setAction({ type: 'success', message: '8項目をClipboardへコピーしました。' });
    } catch {
      setAction({ type: 'error', message: 'Clipboardへコピーできませんでした。', code: 'CLIPBOARD_WRITE_FAILED' });
    }
  };

  const revisionOptions = useMemo(() => revisionItems.map((item) => {
    const revision = asRecord(item);
    return {
      number: Number(revision.revision_number || 0),
      kind: recordText(revision, ['revision_kind']),
      created: recordText(revision, ['created_at']),
    };
  }).filter((item) => item.number > 0), [revisionItems]);

  return (
    <ResponsivePageShell route={route} description="固定8項目Result、Source、Revision、編集、Download、Share、Project移動、Delete/Undoを管理します。">
      {resource.status === 'loading' && <BusyState />}
      {resource.status === 'error' && <ErrorState error={resource.error} onRetry={reload} />}
      {resource.status === 'ready' && (
        <>
          <section className="result-summary">
            <div>
              <span className={`result-state is-${recordText(result, ['completion_state'], 'complete')}`}>{recordText(result, ['completion_state'], 'complete')}</span>
              <h1>{title}</h1>
              <p>Revision {currentRevision} · {recordText(result, ['purpose'], 'Purpose未設定')} · {projectValue ? 'Project所属' : 'Unassigned'}</p>
            </div>
            <div className="result-summary-actions">
              <button className="platform-button" type="button" onClick={() => void copyAll()}>全体をCopy</button>
              <a className="platform-button" href={`/app/shares?result=${encodeURIComponent(id)}`}>Share</a>
              <details className="result-more">
                <summary className="platform-button" aria-label="その他の操作">•••</summary>
                <div>
                  <button type="button" onClick={() => void exportRevision('md')}>Markdown</button>
                  <button type="button" onClick={() => void exportRevision('txt')}>Text</button>
                  <button type="button" onClick={() => void exportRevision('json')}>JSON</button>
                  {!deleted ? <button type="button" onClick={() => void remove()}>削除</button> : <button type="button" onClick={() => void undo()}>削除をUndo</button>}
                </div>
              </details>
            </div>
          </section>

          {deleted && <div className="result-deleted-banner" role="status"><strong>Deleted Pending</strong><span>Undo期限: {recordText(result, ['undo_until'], '—')}</span><button className="platform-button" type="button" onClick={() => void undo()}>削除を取り消す</button></div>}
          {!schemaComplete && <div className="result-schema-warning" role="alert">固定8項目Schemaを確認できません。編集や完成扱いを停止してください。</div>}
          <FormResult state={action} />

          <div className="result-control-grid">
            <Panel title="Revision">
              {revisions.status === 'loading' && <BusyState />}
              {revisions.status === 'error' && <ErrorState error={revisions.error} onRetry={reloadRevisions} />}
              {revisions.status === 'ready' && revisionOptions.length === 0 && <EmptyState>Revision情報がありません。</EmptyState>}
              {revisions.status === 'ready' && revisionOptions.length > 0 && <label className="platform-field"><span>表示Revision</span><select value={selectedRevision || currentRevision} onChange={(event) => { setEditingKey(''); setSelectedRevision(Number(event.target.value)); }}>{revisionOptions.map((revision) => <option value={revision.number} key={revision.number}>r{revision.number} · {revision.kind || 'generated'} · {revision.created}</option>)}</select></label>}
            </Panel>
            <Panel title="Project">
              <label className="platform-field"><span>所属Project</span><select value={projectValue} disabled={deleted || projects.status !== 'ready'} onChange={(event) => void moveProject(event.target.value)}><option value="">Unassigned</option>{projectItems.map((project) => {
                const pid = recordText(project, ['project_id', 'id']);
                return <option key={pid} value={pid}>{recordText(project, ['name'], pid)}</option>;
              })}</select></label>
            </Panel>
          </div>

          {selectedEndpoint && selectedResource.status === 'loading' && <BusyState />}
          {selectedEndpoint && selectedResource.status === 'error' && <ErrorState error={selectedResource.error} />}
          {sections.length > 0 && (
            <section className="result-card-grid" aria-label="Astera固定8項目Result">
              {sections.map((item, index) => {
                const section = asRecord(item);
                const key = recordText(section, ['key']);
                const body = recordText(section, ['body', 'content']);
                const editing = editingKey === key;
                return (
                  <article className="result-card" key={key || index}>
                    <header><span>{String(index + 1).padStart(2, '0')}</span><h2>{recordText(section, ['title', 'key'], key)}</h2></header>
                    {editing ? <textarea value={editText} onChange={(event) => setEditText(event.target.value)} rows={8} /> : <p>{body}</p>}
                    <footer>
                      <button className="platform-button" type="button" onClick={() => void navigator.clipboard.writeText(body)}>Copy</button>
                      {isCurrent && !deleted && (editing
                        ? <><button className="platform-button is-primary" type="button" onClick={() => void saveSection(section)}>新Revisionで保存</button><button className="platform-button" type="button" onClick={() => setEditingKey('')}>Cancel</button></>
                        : <button className="platform-button" type="button" onClick={() => { setEditingKey(key); setEditText(body); }}>Edit</button>)}
                    </footer>
                  </article>
                );
              })}
            </section>
          )}

          <Panel title="Source / 根拠" actions={<div className="result-source-toggle" role="group" aria-label="Source表示方式"><button className={`platform-button${sourceMode === 'number' ? ' is-primary' : ''}`} type="button" aria-pressed={sourceMode === 'number'} onClick={() => setSourceMode('number')}>番号</button><button className={`platform-button${sourceMode === 'detail' ? ' is-primary' : ''}`} type="button" aria-pressed={sourceMode === 'detail'} onClick={() => setSourceMode('detail')}>詳細</button></div>}>
            {sources.length === 0 ? <EmptyState>Sourceはありません。</EmptyState> : <ol className={`result-sources is-${sourceMode}`}>{sources.map((item, index) => {
              const source = asRecord(item);
              const url = recordText(source, ['url', 'source_url']);
              const number = textValue(source.displayNumber ?? source.display_number, String(index + 1));
              return <li key={recordText(source, ['id', 'source_id'], String(index))}><a href={url || undefined} target={url ? '_blank' : undefined} rel={url ? 'noreferrer' : undefined}>[{number}] {recordText(source, ['title'], url || 'Source')}</a>{sourceMode === 'detail' && <span>{recordText(source, ['status', 'verification_status'], 'unverified')} · {recordText(source, ['retrievedAt', 'retrieved_at'], '取得時刻不明')}</span>}</li>;
            })}</ol>}
          </Panel>
        </>
      )}
    </ResponsivePageShell>
  );
}
