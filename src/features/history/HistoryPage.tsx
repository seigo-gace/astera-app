import { useMemo, useState, type FormEvent } from 'react';
import { asArray, asRecord, recordText, textValue } from '../../platform/api-client';
import type { RouteMatch } from '../../platform/route-registry';
import { BusyState, EmptyState, ErrorState, ResponsivePageShell } from '../../platform/ResponsivePageShell';
import { Field, Panel, SelectField, useResource } from '../../platform/pages/page-kit';
import './history-page.css';

const PURPOSE_OPTIONS = [
  { value: '', label: 'すべてのPurpose' },
  { value: 'auto', label: '自動' },
  { value: 'review', label: 'レビュー' },
  { value: 'compare', label: '比較' },
  { value: 'verify', label: '検証' },
  { value: 'improve', label: '改善' },
  { value: 'research', label: '調査' },
  { value: 'plan', label: '計画' },
  { value: 'consider', label: '検討' },
];

type Filters = { q: string; purpose: string; project: string; status: string; from: string; to: string };
const EMPTY: Filters = { q: '', purpose: '', project: '', status: '', from: '', to: '' };

function buildEndpoint(filters: Filters, cursor: string): string {
  const params = new URLSearchParams();
  if (filters.q.trim()) params.set('q', filters.q.trim());
  if (filters.purpose) params.set('purpose', filters.purpose);
  if (filters.project) params.set('project', filters.project);
  if (filters.status) params.set('status', filters.status);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (cursor) params.set('cursor', cursor);
  params.set('limit', '25');
  return `/api/history?${params.toString()}`;
}

export default function HistoryPage({ route }: { route: RouteMatch }) {
  const [draft, setDraft] = useState<Filters>(EMPTY);
  const [applied, setApplied] = useState<Filters>(EMPTY);
  const [cursor, setCursor] = useState('');
  const [cursorStack, setCursorStack] = useState<string[]>([]);
  const endpoint = useMemo(() => buildEndpoint(applied, cursor), [applied, cursor]);
  const [resource, reload] = useResource(endpoint);
  const [projectsResource] = useResource('/api/projects?status=all');

  const projects = projectsResource.status === 'ready' ? asArray(projectsResource.data, ['projects', 'items']).map(asRecord) : [];
  const projectOptions = [
    { value: '', label: 'すべてのProject' },
    { value: 'unassigned', label: 'Unassigned' },
    ...projects.map((project) => ({
      value: recordText(project, ['project_id', 'id']),
      label: `${recordText(project, ['name'], 'Project')}${recordText(project, ['status']) === 'archived' ? '（Archived）' : ''}`,
    })).filter((option) => option.value),
  ];

  const root = resource.status === 'ready' ? asRecord(resource.data) : {};
  const items = resource.status === 'ready' ? asArray(root.history ?? root.items ?? root.results) : [];
  const nextCursor = recordText(root, ['next_cursor']);
  const hasFilters = Object.values(applied).some((value) => value.trim());

  const apply = (event: FormEvent) => {
    event.preventDefault();
    setApplied({ ...draft });
    setCursor('');
    setCursorStack([]);
  };
  const clear = () => {
    setDraft(EMPTY);
    setApplied(EMPTY);
    setCursor('');
    setCursorStack([]);
  };
  const next = () => {
    if (!nextCursor) return;
    setCursorStack((current) => [...current, cursor]);
    setCursor(nextCursor);
  };
  const previous = () => {
    if (!cursorStack.length) return;
    const prior = cursorStack[cursorStack.length - 1] ?? '';
    setCursorStack((current) => current.slice(0, -1));
    setCursor(prior);
  };

  return (
    <ResponsivePageShell route={route} description="Normal Modeで保存されたHistoryを検索・絞込みし、Revision付きResultへ移動します。Private Modeの実行はHistoryへ保存しません。">
      <Panel title="History Filter">
        <form className="history-filter-grid" onSubmit={apply}>
          <Field label="検索" name="history-q" value={draft.q} onChange={(q) => setDraft((current) => ({ ...current, q }))} placeholder="Title・本文・Purpose" />
          <SelectField label="Purpose" name="history-purpose" value={draft.purpose} onChange={(purpose) => setDraft((current) => ({ ...current, purpose }))} options={PURPOSE_OPTIONS} />
          <SelectField label="Project" name="history-project" value={draft.project} onChange={(project) => setDraft((current) => ({ ...current, project }))} options={projectOptions} />
          <SelectField label="状態" name="history-status" value={draft.status} onChange={(status) => setDraft((current) => ({ ...current, status }))} options={[
            { value: '', label: 'すべての状態' },
            { value: 'complete', label: 'Complete' },
            { value: 'partial', label: 'Partial' },
          ]} />
          <Field label="開始日" name="history-from" type="date" value={draft.from} onChange={(from) => setDraft((current) => ({ ...current, from }))} />
          <Field label="終了日" name="history-to" type="date" value={draft.to} onChange={(to) => setDraft((current) => ({ ...current, to }))} />
          <div className="history-filter-actions">
            <button className="platform-button is-primary" type="submit">適用</button>
            <button className="platform-button" type="button" onClick={clear}>Clear</button>
          </div>
        </form>
      </Panel>

      <Panel title="History">
        {resource.status === 'loading' && <BusyState />}
        {resource.status === 'error' && <ErrorState error={resource.error} onRetry={reload} />}
        {resource.status === 'ready' && items.length === 0 && <EmptyState>{hasFilters ? '条件に一致するHistoryはありません。' : '保存済みHistoryはありません。'}</EmptyState>}
        {resource.status === 'ready' && items.length > 0 && (
          <div className="history-record-list">
            {items.map((item) => {
              const record = asRecord(item);
              const id = recordText(record, ['result_id', 'id']);
              return (
                <a className="history-record" href={`/app/results/${encodeURIComponent(id)}`} key={id}>
                  <span>
                    <strong>{recordText(record, ['title'], id)}</strong>
                    <small>{recordText(record, ['project_name']) || (record.project_id ? 'Project' : 'Unassigned')} · {recordText(record, ['purpose'], '—')} · {recordText(record, ['status'], '—')}</small>
                  </span>
                  <span className="history-record-meta"><b>r{textValue(record.current_revision, '1')}</b><time>{recordText(record, ['created_at'])}</time></span>
                </a>
              );
            })}
          </div>
        )}
        {resource.status === 'ready' && (cursorStack.length > 0 || nextCursor) && (
          <div className="history-pagination" aria-label="History pagination">
            <button className="platform-button" type="button" disabled={cursorStack.length === 0} onClick={previous}>前へ</button>
            <span>{cursorStack.length + 1} Page</span>
            <button className="platform-button" type="button" disabled={!nextCursor} onClick={next}>次へ</button>
          </div>
        )}
      </Panel>
    </ResponsivePageShell>
  );
}
