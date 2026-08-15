import type { D1Database, D1PreparedStatement } from './_account-projection';

export const RESULT_SECTION_KEYS = [
  'true_purpose', 'missing_assumptions', 'fact_check', 'risk_detection',
  'counter_view', 'alternatives', 'recommendation', 'next_prompt',
] as const;
export type ResultSectionKey = (typeof RESULT_SECTION_KEYS)[number];

export type NormalizedResultSection = {
  key: ResultSectionKey;
  title: string;
  body: string;
  sourceIds?: string[];
};
export type NormalizedResult = {
  schema_version: string;
  runtime_version: string;
  purpose_version: string;
  job_id: string;
  completion_state: 'complete' | 'partial';
  sections: NormalizedResultSection[];
  sources?: unknown[];
  warnings?: string[];
  generated_at?: string;
};
export type ResultActor = { userId: string; tenantId: string };

type ResultRow = {
  id: string; tenant_id: string; project_id: string | null; job_id: string; title: string;
  created_by_user_id: string; purpose: string | null; schema_version: string; runtime_version: string;
  purpose_version: string; completion_state: 'complete' | 'partial'; current_revision: number;
  deleted_at: string | null; undo_until: string | null; created_at: string; updated_at: string;
};
type RevisionRow = {
  id: string; result_id: string; revision_number: number; parent_revision_id: string | null;
  editor_user_id: string; revision_kind: 'generated' | 'manual_edit'; created_at: string;
};
type SectionRow = {
  section_key: ResultSectionKey; title: string; content: string; source_ids_json: string;
};
type SourceRow = {
  source_id: string; display_number: number; source_url: string; title: string; retrieved_at: string;
  verification_status: 'verified'|'unverified'|'unavailable';
};
export type PersistedSource = { id:string; displayNumber:number; url:string; title:string; retrievedAt:string; status:'verified'|'unverified'|'unavailable' };

export class ResultStoreError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message); this.name = 'ResultStoreError';
  }
}

function parseJsonArray(value: string): string[] {
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.map(String) : []; } catch { return []; }
}
function ensureFixedSections(sections: NormalizedResultSection[]): NormalizedResultSection[] {
  const map = new Map<ResultSectionKey, NormalizedResultSection>();
  for (const section of sections) {
    if (!RESULT_SECTION_KEYS.includes(section.key) || map.has(section.key) || !section.body.trim()) continue;
    map.set(section.key, { ...section, body: section.body.trim(), title: section.title.trim() || section.key, sourceIds: section.sourceIds ?? [] });
  }
  const missing = RESULT_SECTION_KEYS.filter((key) => !map.has(key));
  if (missing.length) throw new ResultStoreError(409, 'RESULT_SCHEMA_INVALID', '固定8Sectionが不足しています。', { missing });
  return RESULT_SECTION_KEYS.map((key) => map.get(key)!);
}

async function ownedResult(db: D1Database, actor: ResultActor, resultId: string, includeDeleted = true, mode: 'read'|'edit' = 'read'): Promise<ResultRow> {
  const deleted = includeDeleted ? '' : ' AND deleted_at IS NULL';
  const row = await db.prepare(`SELECT id,tenant_id,project_id,job_id,title,created_by_user_id,purpose,schema_version,runtime_version,
    purpose_version,completion_state,current_revision,deleted_at,undo_until,created_at,updated_at
    FROM results WHERE id=?1 AND tenant_id=?2${deleted} LIMIT 1`)
    .bind(resultId, actor.tenantId).first<ResultRow>();
  if (!row) throw new ResultStoreError(404, 'RESULT_NOT_FOUND', 'Resultが見つかりません。');
  if (row.project_id) {
    const member = await db.prepare(`SELECT role FROM project_members WHERE project_id=?1 AND tenant_id=?2 AND user_id=?3 LIMIT 1`)
      .bind(row.project_id, actor.tenantId, actor.userId).first<{role:string}>();
    if (!member || (mode === 'edit' && !['owner','editor'].includes(member.role))) {
      throw new ResultStoreError(403, 'RESULT_ACCESS_DENIED', 'ResultへのAccess権がありません。');
    }
  } else if (row.created_by_user_id !== actor.userId) {
    throw new ResultStoreError(403, 'RESULT_ACCESS_DENIED', 'ResultへのAccess権がありません。');
  }
  return row;
}

async function revisionRow(db: D1Database, resultId: string, revisionNumber: number): Promise<RevisionRow> {
  const row = await db.prepare(`SELECT id,result_id,revision_number,parent_revision_id,editor_user_id,revision_kind,created_at
    FROM result_revisions WHERE result_id=?1 AND revision_number=?2 LIMIT 1`)
    .bind(resultId, revisionNumber).first<RevisionRow>();
  if (!row) throw new ResultStoreError(404, 'RESULT_REVISION_NOT_FOUND', 'Revisionが見つかりません。');
  return row;
}

async function resultSources(db: D1Database, resultId: string): Promise<PersistedSource[]> {
  const rows = (await db.prepare(`SELECT source_id,display_number,source_url,title,retrieved_at,verification_status
    FROM source_references WHERE result_id=?1 ORDER BY display_number ASC`).bind(resultId).all<SourceRow>()).results ?? [];
  return rows.map((row) => ({ id:row.source_id, displayNumber:Number(row.display_number), url:row.source_url, title:row.title, retrievedAt:row.retrieved_at, status:row.verification_status }));
}

async function revisionSections(db: D1Database, revisionId: string): Promise<NormalizedResultSection[]> {
  const rows = (await db.prepare(`SELECT section_key,title,content,source_ids_json FROM result_sections WHERE revision_id=?1`)
    .bind(revisionId).all<SectionRow>()).results ?? [];
  const map = new Map(rows.map((row) => [row.section_key, row]));
  const sections: NormalizedResultSection[] = [];
  for (const key of RESULT_SECTION_KEYS) {
    const row = map.get(key);
    if (row) sections.push({ key, title: row.title, body: row.content, sourceIds: parseJsonArray(row.source_ids_json) });
  }
  return ensureFixedSections(sections);
}

export async function getResult(db: D1Database, actor: ResultActor, resultId: string): Promise<Record<string, unknown>> {
  const row = await ownedResult(db, actor, resultId);
  const revision = await revisionRow(db, row.id, Number(row.current_revision));
  const sections = await revisionSections(db, revision.id);
  return {
    result: {
      id: row.id, result_id: row.id, job_id: row.job_id, project_id: row.project_id, title: row.title, purpose: row.purpose,
      schema_version: row.schema_version, runtime_version: row.runtime_version, purpose_version: row.purpose_version,
      completion_state: row.completion_state, current_revision: row.current_revision, deleted_at: row.deleted_at,
      undo_until: row.undo_until, created_at: row.created_at, updated_at: row.updated_at, sections, sources: await resultSources(db, row.id),
    },
  };
}

export async function listRevisions(db: D1Database, actor: ResultActor, resultId: string): Promise<Record<string, unknown>> {
  const row = await ownedResult(db, actor, resultId);
  const rows = (await db.prepare(`SELECT id,result_id,revision_number,parent_revision_id,editor_user_id,revision_kind,created_at
    FROM result_revisions WHERE result_id=?1 ORDER BY revision_number DESC`).bind(row.id).all<RevisionRow>()).results ?? [];
  return { result_id: row.id, current_revision: row.current_revision, revisions: rows };
}

export async function getRevision(db: D1Database, actor: ResultActor, resultId: string, revisionNumber: number): Promise<Record<string, unknown>> {
  const row = await ownedResult(db, actor, resultId);
  if (!Number.isInteger(revisionNumber) || revisionNumber < 1) throw new ResultStoreError(422, 'RESULT_REVISION_INVALID', 'Revision番号が不正です。');
  const revision = await revisionRow(db, row.id, revisionNumber);
  return { result_id: row.id, title: row.title, revision, sections: await revisionSections(db, revision.id) };
}

export function parseEditBody(value: unknown): { baseRevision: number; patches: Map<ResultSectionKey, string> } {
  const body = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const baseRevision = Number(body.base_revision ?? body.baseRevision);
  if (!Number.isInteger(baseRevision) || baseRevision < 1) throw new ResultStoreError(422, 'BASE_REVISION_REQUIRED', 'base_revisionが必要です。');
  const raw = body.sections && typeof body.sections === 'object' && !Array.isArray(body.sections) ? body.sections as Record<string, unknown> : {};
  const patches = new Map<ResultSectionKey, string>();
  for (const [key, value] of Object.entries(raw)) {
    if (!RESULT_SECTION_KEYS.includes(key as ResultSectionKey)) throw new ResultStoreError(422, 'RESULT_SECTION_KEY_INVALID', `未対応Sectionです: ${key}`);
    const content = typeof value === 'string' ? value : value && typeof value === 'object' && !Array.isArray(value)
      ? String((value as Record<string, unknown>).body ?? (value as Record<string, unknown>).content ?? '') : '';
    if (!content.trim()) throw new ResultStoreError(422, 'RESULT_SECTION_EMPTY', `Sectionを空にできません: ${key}`);
    patches.set(key as ResultSectionKey, content.trim());
  }
  if (!patches.size) throw new ResultStoreError(422, 'RESULT_EDIT_EMPTY', '変更するSectionがありません。');
  return { baseRevision, patches };
}

export async function editResult(db: D1Database, actor: ResultActor, resultId: string, value: unknown): Promise<Record<string, unknown>> {
  const edit = parseEditBody(value);
  const row = await ownedResult(db, actor, resultId, false, 'edit');
  if (row.current_revision !== edit.baseRevision) throw new ResultStoreError(409, 'RESULT_REVISION_CONFLICT', 'Resultが別Revisionへ更新されています。', { current_revision: row.current_revision });
  const current = await revisionRow(db, row.id, row.current_revision);
  const sections = (await revisionSections(db, current.id)).map((section) => ({ ...section, body: edit.patches.get(section.key) ?? section.body }));
  const next = row.current_revision + 1;
  const revisionId = crypto.randomUUID();
  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [
    db.prepare(`INSERT INTO result_revisions
      (id,result_id,tenant_id,revision_number,parent_revision_id,editor_user_id,revision_kind,created_at)
      VALUES (?1,?2,?3,?4,?5,?6,'manual_edit',?7)`)
      .bind(revisionId, row.id, actor.tenantId, next, current.id, actor.userId, now),
  ];
  for (const section of sections) statements.push(db.prepare(`INSERT INTO result_sections
    (revision_id,tenant_id,section_key,title,content,source_ids_json) VALUES (?1,?2,?3,?4,?5,?6)`)
    .bind(revisionId, actor.tenantId, section.key, section.title, section.body, JSON.stringify(section.sourceIds ?? [])));
  statements.push(db.prepare(`UPDATE results SET current_revision=?1,updated_at=?2 WHERE id=?3 AND tenant_id=?4 AND current_revision=?5 AND deleted_at IS NULL`)
    .bind(next, now, row.id, actor.tenantId, edit.baseRevision));
  try { await db.batch(statements); }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/UNIQUE|constraint|current_revision/i.test(message)) throw new ResultStoreError(409, 'RESULT_REVISION_CONFLICT', 'Resultが別Revisionへ更新されています。');
    throw error;
  }
  return { result_id: row.id, current_revision: next, parent_revision: current.revision_number, sections };
}

export async function deleteResult(db: D1Database, actor: ResultActor, resultId: string): Promise<Record<string, unknown>> {
  const row = await ownedResult(db, actor, resultId, true, 'edit');
  if (row.deleted_at && row.undo_until) return { result_id: row.id, state: 'deletion_scheduled', undo_until: row.undo_until, shares_revoked: true };
  const now = new Date();
  const undoUntil = new Date(now.getTime() + 10 * 60 * 1000).toISOString();
  const iso = now.toISOString();
  await db.batch([
    db.prepare(`UPDATE results SET deleted_at=?1,undo_until=?2,updated_at=?1 WHERE id=?3 AND tenant_id=?4 AND deleted_at IS NULL`).bind(iso, undoUntil, row.id, actor.tenantId),
    db.prepare(`UPDATE result_shares SET revoked_at=COALESCE(revoked_at,?1) WHERE result_id=?2 AND tenant_id=?3`).bind(iso, row.id, actor.tenantId),
  ]);
  return { result_id: row.id, state: 'deletion_scheduled', undo_until: undoUntil, shares_revoked: true };
}

export async function undoDeleteResult(db: D1Database, actor: ResultActor, resultId: string): Promise<Record<string, unknown>> {
  const now = new Date().toISOString();
  const existing = await ownedResult(db, actor, resultId, true, 'edit');
  if (!existing.deleted_at || !existing.undo_until || existing.undo_until <= now) throw new ResultStoreError(409, 'RESULT_UNDO_UNAVAILABLE', '削除取消期限を過ぎているか、Resultは削除状態ではありません。');
  await db.prepare(`UPDATE results SET deleted_at=NULL,undo_until=NULL,updated_at=?1 WHERE id=?2 AND tenant_id=?3 AND deleted_at IS NOT NULL AND undo_until>?1`)
    .bind(now, resultId, actor.tenantId).run();
  return { result_id: resultId, state: 'active', shares_restored: false };
}

export function formatRevisionExport(title: string, revision: number, sections: NormalizedResultSection[], format: 'txt'|'md'|'json', sources: PersistedSource[] = []): { body: string; contentType: string; extension: string } {
  if (format === 'json') return { body: JSON.stringify({ title, revision, sections, sources }, null, 2), contentType: 'application/json; charset=utf-8', extension: 'json' };
  const sourceLines = sources.map((source) => `[${source.displayNumber}] ${source.title} ${source.url} (${source.status})`);
  if (format === 'txt') return { body: [`${title} (Revision ${revision})`, '', ...sections.flatMap((s) => [s.title, s.body, '']), ...(sourceLines.length ? ['Sources', ...sourceLines, ''] : [])].join('\n'), contentType: 'text/plain; charset=utf-8', extension: 'txt' };
  return { body: [`# ${title}`, '', `Revision: ${revision}`, '', ...sections.flatMap((s) => [`## ${s.title}`, '', s.body, '']), ...(sourceLines.length ? ['## Sources', '', ...sourceLines, ''] : [])].join('\n'), contentType: 'text/markdown; charset=utf-8', extension: 'md' };
}

export async function exportResult(db: D1Database, actor: ResultActor, resultId: string, format: 'txt'|'md'|'json', revisionNumber?: number): Promise<{ filename: string; body: string; contentType: string }> {
  const row = await ownedResult(db, actor, resultId, false);
  const number = revisionNumber ?? row.current_revision;
  const revision = await revisionRow(db, row.id, number);
  const sections = await revisionSections(db, revision.id);
  const output = formatRevisionExport(row.title, number, sections, format, await resultSources(db, row.id));
  const safe = row.title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim().slice(0, 120) || 'Astera-result';
  return { filename: `${safe}-r${number}.${output.extension}`, body: output.body, contentType: output.contentType };
}
