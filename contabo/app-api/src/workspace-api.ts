import type { Hono } from 'hono';
import type { Pool } from 'pg';
import type { RuntimeConfig } from './config.js';
import type { RuntimeDatabase, RuntimeJobRow } from './database.js';

type Actor = {
  userId: string;
  tenantId: string;
  email: string;
  language: string;
  sessionId: string;
};

type WorkspaceDependencies = {
  database: RuntimeDatabase;
  config: RuntimeConfig;
};

type ResultRow = {
  id: string;
  tenant_id: string;
  project_id: string | null;
  job_id: string;
  title: string;
  created_by_user_id: string | null;
  purpose: string | null;
  private_mode: boolean;
  schema_version: string;
  runtime_version: string;
  purpose_version: string;
  completion_state: string;
  result_json: unknown;
  source_refs: unknown;
  created_at: Date;
  updated_at: Date;
};

type ProjectRow = {
  id: string;
  name: string;
  description: string;
  owner_user_id: string;
  role: string;
  result_count: string;
  updated_at: Date;
  created_at: Date;
};

type PreferenceRow = {
  values_json: Record<string, unknown>;
  version: string;
  updated_at: Date;
};

class WorkspaceHttpError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'WorkspaceHttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function actorFromHeaders(headers: Headers): Actor {
  if (headers.get('x-astera-internal-authenticated') !== '1') {
    throw new WorkspaceHttpError(401, 'TRUSTED_ACTOR_CONTEXT_REQUIRED', 'Cloudflareで検証済みのActor Contextが必要です。');
  }
  const userId = headers.get('x-astera-user-id')?.trim() || '';
  const tenantId = headers.get('x-astera-tenant-id')?.trim() || '';
  const status = headers.get('x-astera-account-status')?.trim() || '';
  if (!userId || !tenantId || status !== 'active') {
    throw new WorkspaceHttpError(403, 'TRUSTED_ACTOR_CONTEXT_INVALID', 'Actor／Tenant／Account状態を確認できません。');
  }
  return {
    userId,
    tenantId,
    email: headers.get('x-astera-email')?.trim() || '',
    language: headers.get('x-astera-ui-language')?.trim() || 'ja-JP',
    sessionId: headers.get('x-astera-session-id')?.trim() || '',
  };
}

function correlationId(headers: Headers): string {
  return headers.get('x-correlation-id')?.trim() || headers.get('x-request-id')?.trim() || crypto.randomUUID();
}

function errorResponse(error: unknown, requestId: string): Response {
  const normalized = error instanceof WorkspaceHttpError
    ? error
    : new WorkspaceHttpError(500, 'WORKSPACE_API_FAILED', 'Workspace API処理を完了できませんでした。', error instanceof Error ? error.message : String(error));
  return Response.json({
    error: {
      code: normalized.code,
      message: normalized.message,
      correlation_id: requestId,
      retryable: normalized.status >= 500,
      details: normalized.details,
    },
  }, { status: normalized.status, headers: { 'cache-control': 'no-store', 'x-correlation-id': requestId } });
}

function positiveLimit(raw: string | null, fallback = 50): number {
  const value = Number(raw);
  if (!Number.isInteger(value)) return fallback;
  return Math.min(100, Math.max(1, value));
}

function resultPayload(row: ResultRow): Record<string, unknown> {
  const stored = record(row.result_json);
  const nested = record(stored.result ?? stored.data ?? stored);
  return {
    ...nested,
    id: row.id,
    result_id: row.id,
    job_id: row.job_id,
    title: row.title,
    project_id: row.project_id,
    purpose: row.purpose,
    private_mode: row.private_mode,
    schema_version: row.schema_version,
    runtime_version: row.runtime_version,
    purpose_version: row.purpose_version,
    completion_state: row.completion_state,
    sources: Array.isArray(row.source_refs) ? row.source_refs : nested.sources ?? [],
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

function sectionBody(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.map(String).join('\n').trim();
  const source = record(value);
  return text(source.body ?? source.content ?? source.text);
}

function resultSections(value: unknown): Array<{ key: string; title: string; body: string }> {
  const root = record(value);
  const result = record(root.result ?? root.data ?? root);
  const sections = result.sections;
  if (Array.isArray(sections)) {
    return sections.map((item) => {
      const section = record(item);
      return { key: text(section.key), title: text(section.title) || text(section.key), body: sectionBody(section) };
    }).filter((section) => section.key && section.body);
  }
  const objectSections = record(sections);
  return Object.entries(objectSections).map(([key, item]) => {
    const section = record(item);
    return { key, title: text(section.title) || key, body: sectionBody(item) };
  }).filter((section) => section.body);
}

function deriveResultTitle(value: unknown, purpose: string): string {
  const root = record(value);
  const result = record(root.result ?? root.data ?? root);
  const explicit = text(result.title ?? result.name);
  if (explicit) return explicit.slice(0, 160);
  const purposeSection = resultSections(value).find((section) => section.key === 'true_purpose');
  if (purposeSection?.body) return purposeSection.body.replace(/\s+/g, ' ').slice(0, 160);
  return `Astera ${purpose}`;
}

function markdownResult(row: ResultRow): string {
  const payload = resultPayload(row);
  const sections = resultSections(row.result_json);
  const lines = [`# ${row.title}`, '', `- Result ID: ${row.id}`, `- Job ID: ${row.job_id}`, `- Purpose: ${row.purpose ?? ''}`, `- Completion: ${row.completion_state}`, `- Created: ${row.created_at.toISOString()}`, ''];
  for (const section of sections) lines.push(`## ${section.title}`, '', section.body, '');
  const sources = Array.isArray(payload.sources) ? payload.sources : [];
  if (sources.length) lines.push('## Sources', '', ...sources.map((source) => `- ${JSON.stringify(source)}`), '');
  return lines.join('\n');
}

function safeFilename(value: string): string {
  return value.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim().slice(0, 120) || 'Astera-result';
}

function scalarPreferenceObject(value: unknown): Record<string, string | number | boolean | null> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new WorkspaceHttpError(422, 'PREFERENCE_BODY_INVALID', 'PreferenceはObjectで指定してください。');
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 100) throw new WorkspaceHttpError(422, 'PREFERENCE_KEY_LIMIT_EXCEEDED', 'Preference項目数が上限を超えています。');
  const result: Record<string, string | number | boolean | null> = {};
  for (const [key, item] of entries) {
    if (!/^[a-zA-Z0-9_.-]{1,80}$/.test(key)) throw new WorkspaceHttpError(422, 'PREFERENCE_KEY_INVALID', `Preference Keyが不正です: ${key}`);
    if (typeof item === 'string') result[key] = item.slice(0, 2_000);
    else if (typeof item === 'number' && Number.isFinite(item)) result[key] = item;
    else if (typeof item === 'boolean' || item === null) result[key] = item;
    else throw new WorkspaceHttpError(422, 'PREFERENCE_VALUE_INVALID', `Preference ValueはScalarのみ対応します: ${key}`);
  }
  return result;
}

function preferenceNamespace(pathname: string): string {
  const suffix = pathname.replace(/^\/api\/preferences\/?/, '').trim();
  return suffix || 'general';
}

async function preferenceGet(pool: Pool, actor: Actor, namespace: string): Promise<Record<string, unknown>> {
  const result = await pool.query<PreferenceRow>(
    `SELECT values_json, version, updated_at
     FROM user_preferences WHERE tenant_id = $1 AND user_id = $2 AND namespace = $3 LIMIT 1`,
    [actor.tenantId, actor.userId, namespace],
  );
  const row = result.rows[0];
  return {
    preferences: row?.values_json ?? {},
    namespace,
    version: row ? Number(row.version) : 0,
    updated_at: row?.updated_at.toISOString() ?? null,
  };
}

async function preferencePatch(pool: Pool, actor: Actor, namespace: string, body: unknown): Promise<Record<string, unknown>> {
  const patch = scalarPreferenceObject(body);
  const result = await pool.query<PreferenceRow>(
    `INSERT INTO user_preferences (tenant_id, user_id, namespace, values_json, version)
     VALUES ($1, $2, $3, $4::jsonb, 1)
     ON CONFLICT (tenant_id, user_id, namespace) DO UPDATE SET
       values_json = user_preferences.values_json || excluded.values_json,
       version = user_preferences.version + 1,
       updated_at = NOW()
     RETURNING values_json, version, updated_at`,
    [actor.tenantId, actor.userId, namespace, JSON.stringify(patch)],
  );
  const row = result.rows[0];
  if (!row) throw new WorkspaceHttpError(500, 'PREFERENCE_UPDATE_FAILED', 'Preferenceを保存できませんでした。');
  return { preferences: row.values_json, namespace, version: Number(row.version), updated_at: row.updated_at.toISOString() };
}

export async function assertProjectAccess(
  pool: Pool,
  tenantId: string,
  userId: string,
  projectId: string | null,
  requiredRole: 'viewer' | 'editor' = 'viewer',
): Promise<void> {
  if (!projectId) return;
  const result = await pool.query<{ role: string }>(
    `SELECT pm.role
     FROM projects p
     JOIN project_members pm ON pm.project_id = p.id
     WHERE p.id = $1 AND p.tenant_id = $2 AND pm.user_id = $3 AND p.archived_at IS NULL
     LIMIT 1`,
    [projectId, tenantId, userId],
  );
  const role = result.rows[0]?.role;
  if (!role) throw new WorkspaceHttpError(404, 'PROJECT_NOT_FOUND', 'Projectが見つからないかAccess権がありません。');
  if (requiredRole === 'editor' && !['owner', 'editor'].includes(role)) {
    throw new WorkspaceHttpError(403, 'PROJECT_WRITE_PERMISSION_REQUIRED', 'Projectへの書込権限がありません。');
  }
}

export async function persistWorkspaceResult(
  pool: Pool,
  job: RuntimeJobRow,
  resultValue: unknown,
): Promise<void> {
  if (job.private_mode) return;
  if (!['completed', 'partially_completed'].includes(job.state)) return;
  await assertProjectAccess(pool, job.tenant_id, job.user_id, job.project_id, 'editor');
  const root = record(resultValue);
  const result = record(root.result ?? root.data ?? root);
  const schemaVersion = text(result.schema_version ?? result.schemaVersion) || 'astera-result-v1';
  const runtimeVersion = text(result.runtime_version ?? result.runtimeVersion) || 'unknown';
  const purposeVersion = text(result.purpose_version ?? result.purposeVersion) || 'unknown';
  const completion = text(result.completion_state ?? result.completionState) || (job.state === 'partially_completed' ? 'partial' : 'complete');
  const sources = Array.isArray(result.sources) ? result.sources : [];
  const title = deriveResultTitle(resultValue, job.purpose);
  await pool.query(
    `INSERT INTO results
      (id, tenant_id, project_id, job_id, schema_version, runtime_version, purpose_version,
       completion_state, result_json, source_refs, title, created_by_user_id, purpose, private_mode)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $12, $13, $14)
     ON CONFLICT (job_id) DO UPDATE SET
       project_id = excluded.project_id,
       schema_version = excluded.schema_version,
       runtime_version = excluded.runtime_version,
       purpose_version = excluded.purpose_version,
       completion_state = excluded.completion_state,
       result_json = excluded.result_json,
       source_refs = excluded.source_refs,
       title = excluded.title,
       purpose = excluded.purpose,
       private_mode = excluded.private_mode,
       updated_at = NOW()`,
    [
      crypto.randomUUID(),
      job.tenant_id,
      job.project_id,
      job.id,
      schemaVersion,
      runtimeVersion,
      purposeVersion,
      completion,
      JSON.stringify(resultValue),
      JSON.stringify(sources),
      title,
      job.user_id,
      job.purpose,
      job.private_mode,
    ],
  );
}

export function registerWorkspaceApi(app: Hono, dependencies: WorkspaceDependencies): void {
  const pool = dependencies.database.pool;

  app.get('/api/projects', async (context) => {
    const requestId = correlationId(context.req.raw.headers);
    try {
      const actor = actorFromHeaders(context.req.raw.headers);
      const result = await pool.query<ProjectRow>(
        `SELECT p.id, p.name, p.description, p.owner_user_id, pm.role,
                COUNT(r.id)::text AS result_count, p.updated_at, p.created_at
         FROM projects p
         JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = $2
         LEFT JOIN results r ON r.project_id = p.id
         WHERE p.tenant_id = $1 AND p.archived_at IS NULL
         GROUP BY p.id, pm.role
         ORDER BY p.updated_at DESC`,
        [actor.tenantId, actor.userId],
      );
      return context.json({ projects: result.rows.map((row) => ({
        id: row.id,
        project_id: row.id,
        name: row.name,
        description: row.description,
        owner_user_id: row.owner_user_id,
        role: row.role,
        result_count: Number(row.result_count),
        file_count: 0,
        created_at: row.created_at.toISOString(),
        updated_at: row.updated_at.toISOString(),
      })) }, 200, { 'cache-control': 'no-store', 'x-correlation-id': requestId });
    } catch (error) {
      return errorResponse(error, requestId);
    }
  });

  app.post('/api/projects', async (context) => {
    const requestId = correlationId(context.req.raw.headers);
    const client = await pool.connect();
    try {
      const actor = actorFromHeaders(context.req.raw.headers);
      const body = record(await context.req.json().catch(() => null));
      const name = text(body.name);
      const description = text(body.description);
      if (!name || name.length > 120) throw new WorkspaceHttpError(422, 'PROJECT_NAME_INVALID', 'Project名は1〜120文字です。');
      if (description.length > 2_000) throw new WorkspaceHttpError(422, 'PROJECT_DESCRIPTION_TOO_LONG', 'Project説明は2,000文字以内です。');
      const id = crypto.randomUUID();
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO projects (id, tenant_id, name, description, owner_user_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, actor.tenantId, name, description, actor.userId],
      );
      await client.query(
        `INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'owner')`,
        [id, actor.userId],
      );
      await client.query('COMMIT');
      return context.json({ project: { id, project_id: id, name, description, role: 'owner', result_count: 0 } }, 201, { 'cache-control': 'no-store', 'x-correlation-id': requestId });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      return errorResponse(error, requestId);
    } finally {
      client.release();
    }
  });

  app.get('/api/history', async (context) => {
    const requestId = correlationId(context.req.raw.headers);
    try {
      const actor = actorFromHeaders(context.req.raw.headers);
      const query = context.req.query('q')?.trim().slice(0, 200) || '';
      const limit = positiveLimit(context.req.query('limit') || null);
      const result = await pool.query<ResultRow & { project_name: string | null }>(
        `SELECT r.*, p.name AS project_name
         FROM results r
         LEFT JOIN projects p ON p.id = r.project_id
         WHERE r.tenant_id = $1
           AND (r.created_by_user_id = $2 OR r.created_by_user_id IS NULL)
           AND r.private_mode = FALSE
           AND ($3 = '' OR r.title ILIKE '%' || $3 || '%' OR r.result_json::text ILIKE '%' || $3 || '%')
         ORDER BY r.created_at DESC
         LIMIT $4`,
        [actor.tenantId, actor.userId, query, limit],
      );
      const history = result.rows.map((row) => ({
        id: row.id,
        result_id: row.id,
        job_id: row.job_id,
        title: row.title,
        purpose: row.purpose,
        completion_state: row.completion_state,
        project_id: row.project_id,
        project: row.project_id ? { id: row.project_id, name: row.project_name } : null,
        created_at: row.created_at.toISOString(),
        updated_at: row.updated_at.toISOString(),
      }));
      return context.json({ history, results: history, items: history }, 200, { 'cache-control': 'no-store', 'x-correlation-id': requestId });
    } catch (error) {
      return errorResponse(error, requestId);
    }
  });

  app.get('/api/results/:result', async (context) => {
    const requestId = correlationId(context.req.raw.headers);
    try {
      const actor = actorFromHeaders(context.req.raw.headers);
      const result = await pool.query<ResultRow>(
        `SELECT * FROM results WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
        [context.req.param('result'), actor.tenantId],
      );
      const row = result.rows[0];
      if (!row || (row.created_by_user_id && row.created_by_user_id !== actor.userId && !row.project_id)) {
        throw new WorkspaceHttpError(404, 'RESULT_NOT_FOUND', 'Resultが見つかりません。');
      }
      if (row.project_id) await assertProjectAccess(pool, actor.tenantId, actor.userId, row.project_id, 'viewer');
      return context.json({ result: resultPayload(row) }, 200, { 'cache-control': 'no-store', 'x-correlation-id': requestId });
    } catch (error) {
      return errorResponse(error, requestId);
    }
  });

  app.post('/api/results/:result/download', async (context) => {
    const requestId = correlationId(context.req.raw.headers);
    try {
      const actor = actorFromHeaders(context.req.raw.headers);
      const result = await pool.query<ResultRow>(
        `SELECT * FROM results WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
        [context.req.param('result'), actor.tenantId],
      );
      const row = result.rows[0];
      if (!row) throw new WorkspaceHttpError(404, 'RESULT_NOT_FOUND', 'Resultが見つかりません。');
      if (row.project_id) await assertProjectAccess(pool, actor.tenantId, actor.userId, row.project_id, 'viewer');
      return new Response(markdownResult(row), {
        status: 200,
        headers: {
          'content-type': 'text/markdown; charset=utf-8',
          'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`${safeFilename(row.title)}.md`)}`,
          'cache-control': 'no-store',
          'x-correlation-id': requestId,
        },
      });
    } catch (error) {
      return errorResponse(error, requestId);
    }
  });

  app.post('/api/results/:result/share', async (context) => {
    const requestId = correlationId(context.req.raw.headers);
    try {
      const actor = actorFromHeaders(context.req.raw.headers);
      const resultId = context.req.param('result');
      const result = await pool.query<ResultRow>(`SELECT * FROM results WHERE id = $1 AND tenant_id = $2 LIMIT 1`, [resultId, actor.tenantId]);
      const row = result.rows[0];
      if (!row) throw new WorkspaceHttpError(404, 'RESULT_NOT_FOUND', 'Resultが見つかりません。');
      if (row.private_mode) throw new WorkspaceHttpError(409, 'PRIVATE_RESULT_SHARE_FORBIDDEN', 'Private Mode Resultは共有できません。');
      if (row.project_id) await assertProjectAccess(pool, actor.tenantId, actor.userId, row.project_id, 'editor');
      const body = record(await context.req.json().catch(() => ({})));
      const expiresRaw = text(body.expires_at ?? body.expiresAt);
      const expiresAt = expiresRaw ? new Date(expiresRaw) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now() || expiresAt.getTime() > Date.now() + 90 * 24 * 60 * 60 * 1000) {
        throw new WorkspaceHttpError(422, 'SHARE_EXPIRY_INVALID', '共有期限は現在から90日以内の未来日時です。');
      }
      const id = crypto.randomUUID();
      await pool.query(
        `INSERT INTO result_shares (id, result_id, tenant_id, created_by, expires_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, resultId, actor.tenantId, actor.userId, expiresAt.toISOString()],
      );
      return context.json({ share: { id, share_id: id, result_id: resultId, expires_at: expiresAt.toISOString(), url: `/s/${id}` } }, 201, { 'cache-control': 'no-store', 'x-correlation-id': requestId });
    } catch (error) {
      return errorResponse(error, requestId);
    }
  });

  app.delete('/api/shares/:share', async (context) => {
    const requestId = correlationId(context.req.raw.headers);
    try {
      const actor = actorFromHeaders(context.req.raw.headers);
      const result = await pool.query(
        `UPDATE result_shares SET revoked_at = NOW()
         WHERE id = $1 AND tenant_id = $2 AND created_by = $3 AND revoked_at IS NULL
         RETURNING id`,
        [context.req.param('share'), actor.tenantId, actor.userId],
      );
      if (!result.rows[0]) throw new WorkspaceHttpError(404, 'SHARE_NOT_FOUND', '共有設定が見つかりません。');
      return context.json({ revoked: true, share_id: result.rows[0].id }, 200, { 'cache-control': 'no-store', 'x-correlation-id': requestId });
    } catch (error) {
      return errorResponse(error, requestId);
    }
  });

  app.get('/api/preferences', async (context) => {
    const requestId = correlationId(context.req.raw.headers);
    try {
      const actor = actorFromHeaders(context.req.raw.headers);
      return context.json(await preferenceGet(pool, actor, 'general'), 200, { 'cache-control': 'no-store', 'x-correlation-id': requestId });
    } catch (error) {
      return errorResponse(error, requestId);
    }
  });

  app.patch('/api/preferences', async (context) => {
    const requestId = correlationId(context.req.raw.headers);
    try {
      const actor = actorFromHeaders(context.req.raw.headers);
      return context.json(await preferencePatch(pool, actor, 'general', await context.req.json().catch(() => null)), 200, { 'cache-control': 'no-store', 'x-correlation-id': requestId });
    } catch (error) {
      return errorResponse(error, requestId);
    }
  });

  app.get('/api/preferences/:namespace', async (context) => {
    const requestId = correlationId(context.req.raw.headers);
    try {
      const actor = actorFromHeaders(context.req.raw.headers);
      const namespace = preferenceNamespace(context.req.path);
      return context.json(await preferenceGet(pool, actor, namespace), 200, { 'cache-control': 'no-store', 'x-correlation-id': requestId });
    } catch (error) {
      return errorResponse(error, requestId);
    }
  });

  app.patch('/api/preferences/:namespace', async (context) => {
    const requestId = correlationId(context.req.raw.headers);
    try {
      const actor = actorFromHeaders(context.req.raw.headers);
      const namespace = preferenceNamespace(context.req.path);
      return context.json(await preferencePatch(pool, actor, namespace, await context.req.json().catch(() => null)), 200, { 'cache-control': 'no-store', 'x-correlation-id': requestId });
    } catch (error) {
      return errorResponse(error, requestId);
    }
  });

  app.get('/api/templates', async (context) => {
    const requestId = correlationId(context.req.raw.headers);
    try {
      const actor = actorFromHeaders(context.req.raw.headers);
      const result = await pool.query(
        `SELECT id, title, content, version, created_at, updated_at
         FROM personal_templates
         WHERE tenant_id = $1 AND user_id = $2 AND archived_at IS NULL
         ORDER BY updated_at DESC LIMIT 100`,
        [actor.tenantId, actor.userId],
      );
      return context.json({ templates: result.rows.map((row) => ({ ...row, version: Number(row.version), created_at: row.created_at.toISOString(), updated_at: row.updated_at.toISOString() })) }, 200, { 'cache-control': 'no-store', 'x-correlation-id': requestId });
    } catch (error) {
      return errorResponse(error, requestId);
    }
  });

  app.post('/api/templates', async (context) => {
    const requestId = correlationId(context.req.raw.headers);
    try {
      const actor = actorFromHeaders(context.req.raw.headers);
      const body = record(await context.req.json().catch(() => null));
      const title = text(body.title ?? body.name);
      const content = text(body.content ?? body.body);
      if (!title || title.length > 120) throw new WorkspaceHttpError(422, 'TEMPLATE_TITLE_INVALID', 'Template名は1〜120文字です。');
      if (!content || [...content].length > 200_000) throw new WorkspaceHttpError(422, 'TEMPLATE_CONTENT_INVALID', 'Template本文は1〜200,000文字です。');
      const id = crypto.randomUUID();
      const result = await pool.query(
        `INSERT INTO personal_templates (id, tenant_id, user_id, title, content)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, title, content, version, created_at, updated_at`,
        [id, actor.tenantId, actor.userId, title, content],
      );
      return context.json({ template: result.rows[0] }, 201, { 'cache-control': 'no-store', 'x-correlation-id': requestId });
    } catch (error) {
      return errorResponse(error, requestId);
    }
  });

  app.get('/api/storage/destinations', async (context) => {
    const requestId = correlationId(context.req.raw.headers);
    try {
      const actor = actorFromHeaders(context.req.raw.headers);
      const result = await pool.query(
        `SELECT id, provider, display_name, status, capabilities, created_at, updated_at
         FROM storage_destinations
         WHERE tenant_id = $1 AND user_id = $2 AND revoked_at IS NULL
         ORDER BY updated_at DESC`,
        [actor.tenantId, actor.userId],
      );
      return context.json({ destinations: result.rows.map((row) => ({ ...row, created_at: row.created_at.toISOString(), updated_at: row.updated_at.toISOString() })) }, 200, { 'cache-control': 'no-store', 'x-correlation-id': requestId });
    } catch (error) {
      return errorResponse(error, requestId);
    }
  });

  app.post('/api/storage/destinations/authorize', async (context) => {
    const requestId = correlationId(context.req.raw.headers);
    try {
      actorFromHeaders(context.req.raw.headers);
      throw new WorkspaceHttpError(503, 'STORAGE_OAUTH_BROKER_NOT_CONFIGURED', '外部Storage OAuth Brokerが設定されていません。');
    } catch (error) {
      return errorResponse(error, requestId);
    }
  });

  app.get('/api/notifications', async (context) => {
    const requestId = correlationId(context.req.raw.headers);
    try {
      const actor = actorFromHeaders(context.req.raw.headers);
      const result = await pool.query(
        `SELECT id, type, severity, title, body, related_type, related_id, created_at, read_at
         FROM notifications
         WHERE tenant_id = $1 AND user_id = $2
         ORDER BY created_at DESC LIMIT 100`,
        [actor.tenantId, actor.userId],
      );
      return context.json({ notifications: result.rows.map((row) => ({ ...row, created_at: row.created_at.toISOString(), read_at: row.read_at?.toISOString() ?? null })) }, 200, { 'cache-control': 'no-store', 'x-correlation-id': requestId });
    } catch (error) {
      return errorResponse(error, requestId);
    }
  });
}
