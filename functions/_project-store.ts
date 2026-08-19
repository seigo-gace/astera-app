import type { D1Database } from './_account-projection';

export type ProjectActor = { userId: string; tenantId: string };
export type ProjectListStatus = 'active' | 'archived' | 'all';

type ProjectRow = {
  id: string;
  tenant_id: string;
  name: string;
  description: string;
  owner_user_id: string;
  role: string;
  archived_at: string | null;
  result_count?: number;
  created_at: string;
  updated_at: string;
};

type ResultRow = {
  id: string;
  project_id: string | null;
  created_by_user_id: string;
  title: string;
  purpose: string | null;
  completion_state: string;
  current_revision: number;
  created_at: string;
  updated_at: string;
};

export class ProjectStoreError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
    this.name = 'ProjectStoreError';
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}
function publicProject(row: ProjectRow): Record<string, unknown> {
  return {
    id: row.id,
    project_id: row.id,
    name: row.name,
    description: row.description,
    owner_user_id: row.owner_user_id,
    role: row.role,
    status: row.archived_at ? 'archived' : 'active',
    archived_at: row.archived_at,
    result_count: Number(row.result_count ?? 0),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function projectAccess(
  db: D1Database,
  actor: ProjectActor,
  projectId: string,
  mode: 'read' | 'write',
): Promise<ProjectRow> {
  const row = await db.prepare(`SELECT p.id,p.tenant_id,p.name,p.description,p.owner_user_id,p.archived_at,p.created_at,p.updated_at,pm.role
    FROM projects p
    JOIN project_members pm ON pm.project_id=p.id AND pm.tenant_id=p.tenant_id
    WHERE p.id=?1 AND p.tenant_id=?2 AND pm.user_id=?3
    LIMIT 1`).bind(projectId, actor.tenantId, actor.userId).first<ProjectRow>();
  if (!row) throw new ProjectStoreError(404, 'PROJECT_NOT_FOUND', 'Projectが見つかりません。');
  if (mode === 'write' && !['owner', 'editor'].includes(row.role)) {
    throw new ProjectStoreError(403, 'PROJECT_WRITE_PERMISSION_REQUIRED', 'Projectを変更する権限がありません。');
  }
  return row;
}

export function normalizeProjectStatus(value: string | null): ProjectListStatus {
  if (!value || value === 'active') return 'active';
  if (value === 'archived' || value === 'all') return value;
  throw new ProjectStoreError(422, 'PROJECT_STATUS_INVALID', 'Project状態はactive／archived／allから指定してください。');
}

export async function listProjectRecords(
  db: D1Database,
  actor: ProjectActor,
  query = '',
  status: ProjectListStatus = 'active',
): Promise<Record<string, unknown>> {
  const q = query.trim().slice(0, 200);
  const pattern = `%${escapeLike(q)}%`;
  const statusClause = status === 'active'
    ? ' AND p.archived_at IS NULL'
    : status === 'archived'
      ? ' AND p.archived_at IS NOT NULL'
      : '';
  const rows = (await db.prepare(`SELECT p.id,p.tenant_id,p.name,p.description,p.owner_user_id,p.archived_at,p.created_at,p.updated_at,pm.role,
      COUNT(r.id) AS result_count
    FROM projects p
    JOIN project_members pm ON pm.project_id=p.id AND pm.tenant_id=p.tenant_id AND pm.user_id=?2
    LEFT JOIN results r ON r.project_id=p.id AND r.tenant_id=p.tenant_id AND r.deleted_at IS NULL
    WHERE p.tenant_id=?1${statusClause}
      AND (?3='' OR p.name LIKE ?4 ESCAPE '\\' OR p.description LIKE ?4 ESCAPE '\\')
    GROUP BY p.id,p.tenant_id,p.name,p.description,p.owner_user_id,p.archived_at,p.created_at,p.updated_at,pm.role
    ORDER BY CASE WHEN p.archived_at IS NULL THEN 0 ELSE 1 END, p.updated_at DESC`)
    .bind(actor.tenantId, actor.userId, q, pattern).all<ProjectRow>()).results ?? [];
  return { projects: rows.map(publicProject), query: q, status };
}

export async function getProjectRecord(
  db: D1Database,
  actor: ProjectActor,
  projectId: string,
): Promise<Record<string, unknown>> {
  const project = await projectAccess(db, actor, projectId, 'read');
  const results = (await db.prepare(`SELECT id,project_id,created_by_user_id,title,purpose,completion_state,current_revision,created_at,updated_at
    FROM results
    WHERE tenant_id=?1 AND project_id=?2 AND deleted_at IS NULL
    ORDER BY created_at DESC`).bind(actor.tenantId, project.id).all<ResultRow>()).results ?? [];
  return {
    project: {
      ...publicProject({ ...project, result_count: results.length }),
      results: results.map((row) => ({
        id: row.id,
        result_id: row.id,
        project_id: row.project_id,
        title: row.title,
        purpose: row.purpose,
        status: row.completion_state,
        completion_state: row.completion_state,
        current_revision: Number(row.current_revision),
        created_at: row.created_at,
        updated_at: row.updated_at,
      })),
    },
  };
}

export async function updateProjectRecord(
  db: D1Database,
  actor: ProjectActor,
  projectId: string,
  value: unknown,
): Promise<Record<string, unknown>> {
  const current = await projectAccess(db, actor, projectId, 'write');
  const body = record(value);
  const hasName = Object.prototype.hasOwnProperty.call(body, 'name');
  const hasDescription = Object.prototype.hasOwnProperty.call(body, 'description');
  const hasArchived = Object.prototype.hasOwnProperty.call(body, 'archived');
  if (!hasName && !hasDescription && !hasArchived) {
    throw new ProjectStoreError(422, 'PROJECT_PATCH_EMPTY', '変更するProject項目がありません。');
  }

  const name = hasName ? text(body.name) : current.name;
  const description = hasDescription ? text(body.description) : current.description;
  if (!name || [...name].length > 120) throw new ProjectStoreError(422, 'PROJECT_NAME_INVALID', 'Project名は1〜120文字です。');
  if ([...description].length > 2000) throw new ProjectStoreError(422, 'PROJECT_DESCRIPTION_TOO_LONG', 'Project説明は2,000文字以内です。');

  if (hasArchived && typeof body.archived !== 'boolean') {
    throw new ProjectStoreError(422, 'PROJECT_ARCHIVED_INVALID', 'archivedはtrue／falseで指定してください。');
  }
  const archivedAt = hasArchived ? (body.archived ? new Date().toISOString() : null) : current.archived_at;

  const duplicate = await db.prepare(`SELECT id FROM projects WHERE tenant_id=?1 AND name=?2 AND id<>?3 LIMIT 1`)
    .bind(actor.tenantId, name, projectId).first<{ id: string }>();
  if (duplicate) throw new ProjectStoreError(409, 'PROJECT_NAME_CONFLICT', '同じProject名が存在します。');

  const now = new Date().toISOString();
  await db.prepare(`UPDATE projects SET name=?1,description=?2,archived_at=?3,updated_at=?4
    WHERE id=?5 AND tenant_id=?6`).bind(name, description, archivedAt, now, projectId, actor.tenantId).run();
  return getProjectRecord(db, actor, projectId);
}

export async function deleteProjectRecord(
  db: D1Database,
  actor: ProjectActor,
  projectId: string,
): Promise<Record<string, unknown>> {
  const project = await projectAccess(db, actor, projectId, 'write');
  const count = await db.prepare(`SELECT COUNT(*) AS count FROM results WHERE tenant_id=?1 AND project_id=?2 AND deleted_at IS NULL`)
    .bind(actor.tenantId, project.id).first<{ count: number }>();
  const now = new Date().toISOString();
  await db.batch([
    db.prepare(`UPDATE results SET project_id=NULL,updated_at=?1 WHERE tenant_id=?2 AND project_id=?3`)
      .bind(now, actor.tenantId, project.id),
    db.prepare(`DELETE FROM projects WHERE id=?1 AND tenant_id=?2`).bind(project.id, actor.tenantId),
  ]);
  return {
    project_id: project.id,
    state: 'deleted',
    results_unassigned: Number(count?.count ?? 0),
  };
}

async function assertResultWriteAccess(
  db: D1Database,
  actor: ProjectActor,
  resultId: string,
): Promise<{ id: string; project_id: string | null; created_by_user_id: string }> {
  const row = await db.prepare(`SELECT id,project_id,created_by_user_id
    FROM results WHERE id=?1 AND tenant_id=?2 AND deleted_at IS NULL LIMIT 1`)
    .bind(resultId, actor.tenantId).first<{ id: string; project_id: string | null; created_by_user_id: string }>();
  if (!row) throw new ProjectStoreError(404, 'RESULT_NOT_FOUND', 'Resultが見つかりません。');
  if (!row.project_id) {
    if (row.created_by_user_id !== actor.userId) throw new ProjectStoreError(403, 'RESULT_ACCESS_DENIED', 'ResultへのAccess権がありません。');
    return row;
  }
  const member = await db.prepare(`SELECT role FROM project_members WHERE project_id=?1 AND tenant_id=?2 AND user_id=?3 LIMIT 1`)
    .bind(row.project_id, actor.tenantId, actor.userId).first<{ role: string }>();
  if (!member || !['owner', 'editor'].includes(member.role)) {
    throw new ProjectStoreError(403, 'RESULT_ACCESS_DENIED', 'Resultを移動する権限がありません。');
  }
  return row;
}

export async function moveResultToProject(
  db: D1Database,
  actor: ProjectActor,
  resultId: string,
  projectId: string | null,
): Promise<Record<string, unknown>> {
  const result = await assertResultWriteAccess(db, actor, resultId);
  if (projectId) {
    const target = await db.prepare(`SELECT p.id
      FROM projects p
      JOIN project_members pm ON pm.project_id=p.id AND pm.tenant_id=p.tenant_id
      WHERE p.id=?1 AND p.tenant_id=?2 AND p.archived_at IS NULL
        AND pm.user_id=?3 AND pm.role IN ('owner','editor')
      LIMIT 1`).bind(projectId, actor.tenantId, actor.userId).first<{ id: string }>();
    if (!target) {
      throw new ProjectStoreError(403, 'PROJECT_WRITE_PERMISSION_REQUIRED', '移動先Projectが存在しないか、書込み権限がありません。');
    }
  }
  const now = new Date().toISOString();
  await db.prepare(`UPDATE results SET project_id=?1,updated_at=?2 WHERE id=?3 AND tenant_id=?4 AND deleted_at IS NULL`)
    .bind(projectId, now, result.id, actor.tenantId).run();
  return { result_id: result.id, project_id: projectId, state: projectId ? 'assigned' : 'unassigned' };
}
