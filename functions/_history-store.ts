import type { D1Database } from './_account-projection';

export type HistoryActor = { userId: string; tenantId: string };
export const HISTORY_PURPOSES = ['auto', 'review', 'compare', 'verify', 'improve', 'research', 'plan', 'consider'] as const;
export const HISTORY_SCOPES = ['active', 'archived', 'all', 'pinned'] as const;
export type HistoryPurpose = (typeof HISTORY_PURPOSES)[number];
export type HistoryStatus = '' | 'complete' | 'partial';
export type HistoryScope = (typeof HISTORY_SCOPES)[number];

export type HistoryQuery = {
  q: string;
  purpose: '' | HistoryPurpose;
  project: string;
  status: HistoryStatus;
  scope: HistoryScope;
  from: string;
  to: string;
  cursor: string;
  limit: number;
};

type CursorValue = { createdAt: string; id: string };
type HistoryRow = {
  id: string;
  job_id: string;
  project_id: string | null;
  project_name: string | null;
  title: string;
  purpose: string | null;
  completion_state: string;
  current_revision: number;
  archived_at?: string | null;
  pinned_at?: string | null;
  created_at: string;
  updated_at: string;
};

export class HistoryStoreError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
    this.name = 'HistoryStoreError';
  }
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}
function text(value: string | null): string {
  return (value || '').trim();
}
function normalizeBoundary(value: string, side: 'from' | 'to'): string {
  if (!value) return '';
  const raw = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? `${value}${side === 'from' ? 'T00:00:00.000Z' : 'T23:59:59.999Z'}`
    : value;
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) throw new HistoryStoreError(422, 'HISTORY_PERIOD_INVALID', '期間指定を確認してください。');
  return new Date(parsed).toISOString();
}
function encodeCursor(value: CursorValue): string {
  return btoa(`${value.createdAt}|${value.id}`).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function decodeCursor(value: string): CursorValue | null {
  if (!value) return null;
  try {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const decoded = atob(padded);
    const split = decoded.indexOf('|');
    if (split < 1) throw new Error('cursor');
    const createdAt = decoded.slice(0, split);
    const id = decoded.slice(split + 1);
    if (!id || !Number.isFinite(Date.parse(createdAt))) throw new Error('cursor');
    return { createdAt, id };
  } catch {
    throw new HistoryStoreError(422, 'HISTORY_CURSOR_INVALID', 'History Cursorが不正です。最初から読み直してください。');
  }
}

async function organizationColumnsReady(db: D1Database): Promise<boolean> {
  const rows = (await db.prepare('PRAGMA table_info(results)').all<{ name: string }>()).results ?? [];
  const names = new Set(rows.map((row) => String(row.name)));
  return names.has('archived_at') && names.has('pinned_at');
}

export function parseHistoryQuery(url: URL): HistoryQuery {
  const q = text(url.searchParams.get('q')).slice(0, 200);
  const purposeRaw = text(url.searchParams.get('purpose'));
  if (purposeRaw && !HISTORY_PURPOSES.includes(purposeRaw as HistoryPurpose)) {
    throw new HistoryStoreError(422, 'HISTORY_PURPOSE_INVALID', 'Purpose Filterが不正です。');
  }
  const statusRaw = text(url.searchParams.get('status'));
  if (statusRaw && !['complete', 'partial'].includes(statusRaw)) {
    throw new HistoryStoreError(422, 'HISTORY_STATUS_INVALID', 'Status Filterが不正です。');
  }
  const scopeRaw = text(url.searchParams.get('scope')) || 'active';
  if (!HISTORY_SCOPES.includes(scopeRaw as HistoryScope)) {
    throw new HistoryStoreError(422, 'HISTORY_SCOPE_INVALID', 'History Scopeが不正です。');
  }
  const project = text(url.searchParams.get('project')).slice(0, 200);
  const limitRaw = Number(url.searchParams.get('limit') || 25);
  const limit = Number.isInteger(limitRaw) ? Math.min(100, Math.max(1, limitRaw)) : 25;
  return {
    q,
    purpose: purposeRaw as '' | HistoryPurpose,
    project,
    status: statusRaw as HistoryStatus,
    scope: scopeRaw as HistoryScope,
    from: normalizeBoundary(text(url.searchParams.get('from')), 'from'),
    to: normalizeBoundary(text(url.searchParams.get('to')), 'to'),
    cursor: text(url.searchParams.get('cursor')),
    limit,
  };
}

function mapHistoryPage(rows: HistoryRow[], query: HistoryQuery): Record<string, unknown> {
  const hasMore = rows.length > query.limit;
  const page = hasMore ? rows.slice(0, query.limit) : rows;
  const last = page.at(-1);
  return {
    history: page.map((row) => ({
      id: row.id,
      result_id: row.id,
      job_id: row.job_id,
      project_id: row.project_id,
      project_name: row.project_name,
      title: row.title,
      purpose: row.purpose,
      status: row.completion_state,
      completion_state: row.completion_state,
      current_revision: Number(row.current_revision),
      archived: Boolean(row.archived_at),
      archived_at: row.archived_at ?? null,
      pinned: Boolean(row.pinned_at),
      pinned_at: row.pinned_at ?? null,
      created_at: row.created_at,
      updated_at: row.updated_at,
    })),
    next_cursor: hasMore && last ? encodeCursor({ createdAt: last.created_at, id: last.id }) : null,
    has_more: hasMore,
    limit: query.limit,
    filters: {
      q: query.q,
      purpose: query.purpose || null,
      project: query.project || null,
      status: query.status || null,
      scope: query.scope,
      from: query.from || null,
      to: query.to || null,
    },
  };
}

export async function listHistoryPage(
  db: D1Database,
  actor: HistoryActor,
  query: HistoryQuery,
): Promise<Record<string, unknown>> {
  if (query.from && query.to && query.from > query.to) {
    throw new HistoryStoreError(422, 'HISTORY_PERIOD_REVERSED', '開始日は終了日以前にしてください。');
  }
  const cursor = decodeCursor(query.cursor);
  const pattern = `%${escapeLike(query.q)}%`;
  const projectMode = query.project === 'unassigned' ? 'unassigned' : query.project ? 'project' : '';
  const organized = await organizationColumnsReady(db);

  if (!organized && (query.scope === 'archived' || query.scope === 'pinned')) {
    return mapHistoryPage([], query);
  }

  if (!organized) {
    const rows = (await db.prepare(`SELECT DISTINCT r.id,r.job_id,r.project_id,p.name AS project_name,r.title,r.purpose,
        r.completion_state,r.current_revision,r.created_at,r.updated_at
      FROM results r
      LEFT JOIN projects p ON p.id=r.project_id AND p.tenant_id=r.tenant_id
      LEFT JOIN project_members pm ON pm.project_id=r.project_id AND pm.tenant_id=r.tenant_id AND pm.user_id=?2
      WHERE r.tenant_id=?1 AND r.deleted_at IS NULL
        AND ((r.project_id IS NULL AND r.created_by_user_id=?2) OR (r.project_id IS NOT NULL AND pm.user_id IS NOT NULL))
        AND (?3='' OR r.title LIKE ?4 ESCAPE '\\' OR COALESCE(r.purpose,'') LIKE ?4 ESCAPE '\\' OR EXISTS(
          SELECT 1 FROM result_revisions rr JOIN result_sections rs ON rs.revision_id=rr.id
          WHERE rr.result_id=r.id AND rr.revision_number=r.current_revision AND rs.content LIKE ?4 ESCAPE '\\'))
        AND (?5='' OR r.purpose=?5)
        AND (?6='' OR (?6='unassigned' AND r.project_id IS NULL) OR (?6='project' AND r.project_id=?7))
        AND (?8='' OR r.completion_state=?8)
        AND (?9='' OR r.created_at>=?9)
        AND (?10='' OR r.created_at<=?10)
        AND (?11='' OR r.created_at<?11 OR (r.created_at=?11 AND r.id<?12))
      ORDER BY r.created_at DESC,r.id DESC
      LIMIT ?13`).bind(
        actor.tenantId,
        actor.userId,
        query.q,
        pattern,
        query.purpose,
        projectMode,
        projectMode === 'project' ? query.project : '',
        query.status,
        query.from,
        query.to,
        cursor?.createdAt || '',
        cursor?.id || '',
        query.limit + 1,
      ).all<HistoryRow>()).results ?? [];
    return mapHistoryPage(rows, query);
  }

  const rows = (await db.prepare(`SELECT DISTINCT r.id,r.job_id,r.project_id,p.name AS project_name,r.title,r.purpose,
      r.completion_state,r.current_revision,r.archived_at,r.pinned_at,r.created_at,r.updated_at
    FROM results r
    LEFT JOIN projects p ON p.id=r.project_id AND p.tenant_id=r.tenant_id
    LEFT JOIN project_members pm ON pm.project_id=r.project_id AND pm.tenant_id=r.tenant_id AND pm.user_id=?2
    WHERE r.tenant_id=?1 AND r.deleted_at IS NULL
      AND ((r.project_id IS NULL AND r.created_by_user_id=?2) OR (r.project_id IS NOT NULL AND pm.user_id IS NOT NULL))
      AND (?3='' OR r.title LIKE ?4 ESCAPE '\\' OR COALESCE(r.purpose,'') LIKE ?4 ESCAPE '\\' OR EXISTS(
        SELECT 1 FROM result_revisions rr JOIN result_sections rs ON rs.revision_id=rr.id
        WHERE rr.result_id=r.id AND rr.revision_number=r.current_revision AND rs.content LIKE ?4 ESCAPE '\\'))
      AND (?5='' OR r.purpose=?5)
      AND (?6='' OR (?6='unassigned' AND r.project_id IS NULL) OR (?6='project' AND r.project_id=?7))
      AND (?8='' OR r.completion_state=?8)
      AND (?9='' OR r.created_at>=?9)
      AND (?10='' OR r.created_at<=?10)
      AND (?11='' OR r.created_at<?11 OR (r.created_at=?11 AND r.id<?12))
      AND (
        ?13='all'
        OR (?13='active' AND r.archived_at IS NULL)
        OR (?13='archived' AND r.archived_at IS NOT NULL)
        OR (?13='pinned' AND r.archived_at IS NULL AND r.pinned_at IS NOT NULL)
      )
    ORDER BY r.created_at DESC,r.id DESC
    LIMIT ?14`).bind(
      actor.tenantId,
      actor.userId,
      query.q,
      pattern,
      query.purpose,
      projectMode,
      projectMode === 'project' ? query.project : '',
      query.status,
      query.from,
      query.to,
      cursor?.createdAt || '',
      cursor?.id || '',
      query.scope,
      query.limit + 1,
    ).all<HistoryRow>()).results ?? [];

  return mapHistoryPage(rows, query);
}
