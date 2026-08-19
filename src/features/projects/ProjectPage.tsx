import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { asArray, asRecord, recordText, textValue, type JsonObject } from '../../platform/api-client';
import type { RouteMatch } from '../../platform/route-registry';
import { BusyState, EmptyState, ErrorState, ResponsivePageShell } from '../../platform/ResponsivePageShell';
import { Field, FormResult, Panel, submitForm, useResource, type SubmitState } from '../../platform/pages/page-kit';
import './project-page.css';

type ProjectView = 'active' | 'archived';

function projectId(record: JsonObject): string {
  return recordText(record, ['project_id', 'id']);
}
function projectStatus(record: JsonObject): ProjectView {
  return recordText(record, ['status']) === 'archived' || record.archived_at ? 'archived' : 'active';
}

export default function ProjectPage({ route }: { route: RouteMatch }) {
  const [search, setSearch] = useState('');
  const [view, setView] = useState<ProjectView>('active');
  const endpoint = `/api/projects?status=all${search.trim() ? `&q=${encodeURIComponent(search.trim())}` : ''}`;
  const [resource, reload] = useResource(endpoint);
  const projects = useMemo(() => resource.status === 'ready' ? asArray(resource.data, ['projects', 'items']).map(asRecord) : [], [resource]);
  const visible = useMemo(() => projects.filter((project) => projectStatus(project) === view), [projects, view]);
  const activeProjects = useMemo(() => projects.filter((project) => projectStatus(project) === 'active'), [projects]);

  const [selectedId, setSelectedId] = useState('');
  const [detailOpen, setDetailOpen] = useState(false);
  useEffect(() => {
    if (visible.length === 0) {
      setSelectedId('');
      setDetailOpen(false);
      return;
    }
    if (!visible.some((project) => projectId(project) === selectedId)) setSelectedId(projectId(visible[0]));
  }, [selectedId, visible]);

  const [detail, reloadDetail] = useResource(selectedId ? `/api/projects/${encodeURIComponent(selectedId)}` : null);
  const detailRoot = detail.status === 'ready' ? asRecord(detail.data) : {};
  const selected = detail.status === 'ready' ? asRecord(detailRoot.project ?? detailRoot.data ?? detailRoot) : {};
  const results = detail.status === 'ready' ? asArray(selected.results) : [];

  const [createState, setCreateState] = useState<SubmitState>({ type: 'idle' });
  const [actionState, setActionState] = useState<SubmitState>({ type: 'idle' });
  const [rename, setRename] = useState('');
  const [description, setDescription] = useState('');
  useEffect(() => {
    if (detail.status !== 'ready') return;
    setRename(recordText(selected, ['name']));
    setDescription(recordText(selected, ['description']));
  }, [detail.status, selectedId]);

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const result = await submitForm('/api/projects', {
      name: textValue(data.get('name')),
      description: textValue(data.get('description')),
    }, setCreateState, { success: 'Projectを作成しました。', idempotent: true });
    if (!result) return;
    form.reset();
    reload();
  };

  const patchProject = async (body: JsonObject, success: string) => {
    if (!selectedId) return;
    const result = await submitForm(`/api/projects/${encodeURIComponent(selectedId)}`, body, setActionState, {
      method: 'PATCH',
      success,
      idempotent: true,
    });
    if (!result) return;
    reload();
    reloadDetail();
  };

  const removeProject = async () => {
    if (!selectedId || !window.confirm('Projectを削除します。Project内のResultは削除せずUnassignedへ戻します。')) return;
    const result = await submitForm(`/api/projects/${encodeURIComponent(selectedId)}`, {}, setActionState, {
      method: 'DELETE',
      success: 'Projectを削除し、ResultをUnassignedへ戻しました。',
      idempotent: true,
    });
    if (!result) return;
    setDetailOpen(false);
    setSelectedId('');
    reload();
  };

  const moveResult = async (result: JsonObject, targetProjectId: string) => {
    const id = recordText(result, ['result_id', 'id']);
    if (!id) return;
    const response = await submitForm(`/api/results/${encodeURIComponent(id)}`, {
      project_id: targetProjectId || null,
    }, setActionState, {
      method: 'PATCH',
      success: targetProjectId ? 'ResultをProjectへ移動しました。' : 'ResultをUnassignedへ移動しました。',
      idempotent: true,
      dedupeKey: `move-result:${id}:${targetProjectId || 'unassigned'}`,
    });
    if (!response) return;
    reload();
    reloadDetail();
  };

  return (
    <ResponsivePageShell route={route} description="単階層Projectを作成・検索・Rename・Archiveし、ResultをProjectまたはUnassignedへ整理します。">
      <Panel title="新規Project">
        <form className="project-create-form" onSubmit={create}>
          <Field label="Project名" name="name" required maxLength={120} />
          <Field label="説明（任意）" name="description" maxLength={2000} />
          <button className="platform-button is-primary" type="submit" disabled={createState.type === 'working'}>作成</button>
        </form>
        <FormResult state={createState} />
      </Panel>

      <Panel title="Projectを探す">
        <div className="project-toolbar">
          <Field label="検索" name="project-search" value={search} onChange={setSearch} placeholder="Project名・説明" />
          <div className="project-view-tabs" role="group" aria-label="Project状態">
            <button className={`platform-button${view === 'active' ? ' is-primary' : ''}`} type="button" aria-pressed={view === 'active'} onClick={() => { setView('active'); setDetailOpen(false); }}>Active</button>
            <button className={`platform-button${view === 'archived' ? ' is-primary' : ''}`} type="button" aria-pressed={view === 'archived'} onClick={() => { setView('archived'); setDetailOpen(false); }}>Archived</button>
          </div>
        </div>
      </Panel>

      {resource.status === 'loading' && <BusyState />}
      {resource.status === 'error' && <ErrorState error={resource.error} onRetry={reload} />}
      {resource.status === 'ready' && (
        <div className="project-workspace-grid">
          <Panel title={view === 'active' ? 'Active Project' : 'Archived Project'}>
            {visible.length === 0 ? <EmptyState>{search ? '条件に一致するProjectはありません。' : 'Projectはありません。'}</EmptyState> : (
              <div className="project-list">
                {visible.map((project) => {
                  const id = projectId(project);
                  const current = id === selectedId;
                  return (
                    <button
                      className={`project-list-button${current ? ' is-selected' : ''}`}
                      type="button"
                      aria-pressed={current}
                      key={id}
                      onClick={() => { setSelectedId(id); setDetailOpen(true); }}
                    >
                      <span><strong>{recordText(project, ['name'], id)}</strong><small>{recordText(project, ['description']) || '説明なし'}</small></span>
                      <b>{textValue(project.result_count, '0')} Result</b>
                    </button>
                  );
                })}
              </div>
            )}
          </Panel>

          {detailOpen && <button className="project-detail-backdrop" type="button" aria-label="Project詳細を閉じる" onClick={() => setDetailOpen(false)} />}
          <div className="project-detail-shell" data-open={detailOpen ? 'true' : 'false'}>
            <Panel
              title="Project詳細"
              actions={<button className="platform-button project-mobile-close" type="button" onClick={() => setDetailOpen(false)}>閉じる</button>}
            >
              {!selectedId && <EmptyState>Projectを選択してください。</EmptyState>}
              {selectedId && detail.status === 'loading' && <BusyState />}
              {selectedId && detail.status === 'error' && <ErrorState error={detail.error} onRetry={reloadDetail} />}
              {selectedId && detail.status === 'ready' && (
                <>
                  <form className="project-detail-form" onSubmit={(event) => { event.preventDefault(); void patchProject({ name: rename, description }, 'Project情報を更新しました。'); }}>
                    <Field label="Project名" name="project-name" value={rename} onChange={setRename} required maxLength={120} />
                    <Field label="説明" name="project-description" value={description} onChange={setDescription} maxLength={2000} />
                    <div className="platform-action-row">
                      <button className="platform-button is-primary" type="submit" disabled={actionState.type === 'working'}>保存</button>
                      <button className="platform-button" type="button" disabled={actionState.type === 'working'} onClick={() => void patchProject({ archived: projectStatus(selected) === 'active' }, projectStatus(selected) === 'active' ? 'ProjectをArchiveしました。' : 'ProjectをActiveへ戻しました。')}>
                        {projectStatus(selected) === 'active' ? 'Archive' : 'Activeへ戻す'}
                      </button>
                      <button className="platform-button" type="button" disabled={actionState.type === 'working'} onClick={() => void removeProject()}>削除</button>
                    </div>
                  </form>
                  <FormResult state={actionState} />
                  <section className="project-results" aria-labelledby="project-results-title">
                    <h3 id="project-results-title">Result</h3>
                    {results.length === 0 ? <EmptyState>このProjectにResultはありません。</EmptyState> : results.map((item) => {
                      const result = asRecord(item);
                      const id = recordText(result, ['result_id', 'id']);
                      return (
                        <div className="project-result-row" key={id}>
                          <a href={`/app/results/${encodeURIComponent(id)}`}><strong>{recordText(result, ['title'], id)}</strong><span>{recordText(result, ['purpose', 'status'])}</span></a>
                          <label>
                            <span>移動先</span>
                            <select defaultValue={selectedId} onChange={(event) => { if (event.target.value !== selectedId) void moveResult(result, event.target.value); }}>
                              <option value="">Unassigned</option>
                              {projectStatus(selected) === 'archived' && <option value={selectedId} disabled>{recordText(selected, ['name'], '現在のArchived Project')}</option>}
                              {activeProjects.map((project) => <option value={projectId(project)} key={projectId(project)}>{recordText(project, ['name'], projectId(project))}</option>)}
                            </select>
                          </label>
                        </div>
                      );
                    })}
                  </section>
                </>
              )}
            </Panel>
          </div>
        </div>
      )}
    </ResponsivePageShell>
  );
}
