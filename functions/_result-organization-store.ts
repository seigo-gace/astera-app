import type { D1Database } from './_account-projection';

export type ResultOrganizationActor = { userId: string; tenantId: string };

type OrganizationRow = {
  id: string;
  project_id: string | null;
  created_by_user_id: string;
  deleted_at: string | null;
  archived_at: string | null;
  pinned_at: string | null;
};

export class ResultOrganizationStoreError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
    this.name = 'ResultOrganizationStoreError';
  }
}

async function organizationColumnsReady(db: D1Database): Promise<boolean> {
  const rows = (await db.prepare('PRAGMA table_info(results)').all<{ name: string }>()).results ?? [];
  const names = new Set(rows.map((row) => String(row.name)));
  return names.has('archived_at') && names.has('pinned_at');
}

async function requireOrganizationSchema(db: D1Database): Promise<void> {
  if (!(await organizationColumnsReady(db))) {
    throw new ResultOrganizationStoreError(
      503,
      'RESULT_ORGANIZATION_MIGRATION_REQUIRED',
      'Result整理機能のD1 Migrationがまだ適用されていません。',
    );
  }
}

async function editableResult(
  db: D1Database,
  actor: ResultOrganizationActor,
  resultId: string,
): Promise<OrganizationRow> {
  await requireOrganizationSchema(db);
  const row = await db.prepare(`SELECT id,project_id,created_by_user_id,deleted_at,archived_at,pinned_at
    FROM results WHERE id=?1 AND tenant_id=?2 LIMIT 1`)
    .bind(resultId, actor.tenantId)
    .first<OrganizationRow>();
  if (!row) throw new ResultOrganizationStoreError(404, 'RESULT_NOT_FOUND', 'Resultが見つかりません。');
  if (row.project_id) {
    const member = await db.prepare(`SELECT role FROM project_members
      WHERE project_id=?1 AND tenant_id=?2 AND user_id=?3 LIMIT 1`)
      .bind(row.project_id, actor.tenantId, actor.userId)
      .first<{ role: string }>();
    if (!member || !['owner', 'editor'].includes(String(member.role))) {
      throw new ResultOrganizationStoreError(403, 'RESULT_ACCESS_DENIED', 'Resultを整理する権限がありません。');
    }
  } else if (row.created_by_user_id !== actor.userId) {
    throw new ResultOrganizationStoreError(403, 'RESULT_ACCESS_DENIED', 'Resultを整理する権限がありません。');
  }
  if (row.deleted_at) {
    throw new ResultOrganizationStoreError(409, 'RESULT_DELETED', '削除予定のResultは整理できません。');
  }
  return row;
}

export async function getResultOrganization(
  db: D1Database,
  actor: ResultOrganizationActor,
  resultId: string,
): Promise<Record<string, unknown>> {
  const row = await editableResult(db, actor, resultId);
  return {
    result_id: row.id,
    project_id: row.project_id,
    pinned: Boolean(row.pinned_at),
    pinned_at: row.pinned_at,
    archived: Boolean(row.archived_at),
    archived_at: row.archived_at,
  };
}

export async function patchResultOrganization(
  db: D1Database,
  actor: ResultOrganizationActor,
  resultId: string,
  value: unknown,
): Promise<Record<string, unknown>> {
  const body = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const hasPinned = Object.prototype.hasOwnProperty.call(body, 'pinned');
  const hasArchived = Object.prototype.hasOwnProperty.call(body, 'archived');
  if (!hasPinned && !hasArchived) {
    throw new ResultOrganizationStoreError(422, 'RESULT_ORGANIZATION_EMPTY', 'pinnedまたはarchivedを指定してください。');
  }
  if (hasPinned && typeof body.pinned !== 'boolean') {
    throw new ResultOrganizationStoreError(422, 'RESULT_PIN_INVALID', 'pinnedはbooleanで指定してください。');
  }
  if (hasArchived && typeof body.archived !== 'boolean') {
    throw new ResultOrganizationStoreError(422, 'RESULT_ARCHIVE_INVALID', 'archivedはbooleanで指定してください。');
  }

  const row = await editableResult(db, actor, resultId);
  const now = new Date().toISOString();
  let archivedAt = row.archived_at;
  let pinnedAt = row.pinned_at;

  if (hasArchived) {
    archivedAt = body.archived === true ? (archivedAt || now) : null;
    if (body.archived === true) pinnedAt = null;
  }
  if (hasPinned) {
    if (body.pinned === true && archivedAt) {
      throw new ResultOrganizationStoreError(409, 'ARCHIVED_RESULT_CANNOT_BE_PINNED', 'アーカイブ中のResultはピン留めできません。');
    }
    pinnedAt = body.pinned === true ? (pinnedAt || now) : null;
  }

  await db.prepare(`UPDATE results
    SET archived_at=?1,pinned_at=?2,updated_at=?3
    WHERE id=?4 AND tenant_id=?5 AND deleted_at IS NULL`)
    .bind(archivedAt, pinnedAt, now, row.id, actor.tenantId)
    .run();

  return {
    result_id: row.id,
    project_id: row.project_id,
    pinned: Boolean(pinnedAt),
    pinned_at: pinnedAt,
    archived: Boolean(archivedAt),
    archived_at: archivedAt,
  };
}
