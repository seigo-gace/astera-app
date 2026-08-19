import type { D1Database } from './_account-projection';

export type TemplateActor = { userId: string; tenantId: string };
export class TemplateStoreError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
    this.name = 'TemplateStoreError';
  }
}

type TemplateRow = {
  id: string;
  tenant_id: string;
  user_id: string;
  title: string;
  content: string;
  version: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

type TemplateDocument = {
  schema: 'astera.google-sheets-template.v1' | 'astera.legacy-template.v1';
  template_source: 'personal';
  provider: 'google-sheets' | 'legacy';
  google_file_id: string | null;
  locale: string;
  time_zone: string;
  output_format: 'google-sheets' | 'legacy';
  allowed_sheets: string[];
  allowed_ranges: string[];
  prohibited_elements: string;
  enabled: boolean;
  lifecycle_state: 'draft' | 'validating' | 'ready' | 'warning' | 'rejected' | 'disabled' | 'deleted';
  legacy_content?: string;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function text(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
function boundedText(value: unknown, name: string, max: number, fallback = ''): string {
  const result = text(value) || fallback;
  if ([...result].length > max) throw new TemplateStoreError(422, `${name.toUpperCase()}_TOO_LONG`, `${name}が長すぎます。`);
  return result;
}
function stringList(value: unknown, name: string): string[] {
  if (value === undefined || value === null || value === '') return [];
  const source = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : null;
  if (!source) throw new TemplateStoreError(422, `${name.toUpperCase()}_INVALID`, `${name}は文字列配列で指定してください。`);
  if (source.length > 200) throw new TemplateStoreError(422, `${name.toUpperCase()}_LIMIT`, `${name}の件数が上限を超えています。`);
  const result = source.map((item) => text(item)).filter(Boolean);
  if (result.some((item) => [...item].length > 240)) throw new TemplateStoreError(422, `${name.toUpperCase()}_ITEM_TOO_LONG`, `${name}の項目が長すぎます。`);
  return [...new Set(result)];
}
function googleFileId(value: unknown): string {
  const id = text(value);
  if (!/^[A-Za-z0-9_-]{5,256}$/.test(id)) throw new TemplateStoreError(422, 'GOOGLE_FILE_ID_INVALID', 'Google Sheets File IDを確認してください。');
  return id;
}
function lifecycle(value: unknown, enabled: boolean): TemplateDocument['lifecycle_state'] {
  const state = text(value) as TemplateDocument['lifecycle_state'];
  const allowed = new Set<TemplateDocument['lifecycle_state']>(['draft','validating','ready','warning','rejected','disabled']);
  if (!state) return enabled ? 'draft' : 'disabled';
  if (!allowed.has(state)) throw new TemplateStoreError(422, 'TEMPLATE_STATE_INVALID', 'Template Stateが不正です。');
  return enabled ? (state === 'disabled' ? 'draft' : state) : 'disabled';
}
function parseDocument(raw: string): TemplateDocument {
  try {
    const parsed = JSON.parse(raw) as Partial<TemplateDocument>;
    if (parsed?.schema === 'astera.google-sheets-template.v1' && parsed.provider === 'google-sheets') {
      return {
        schema: 'astera.google-sheets-template.v1',
        template_source: 'personal',
        provider: 'google-sheets',
        google_file_id: typeof parsed.google_file_id === 'string' ? parsed.google_file_id : null,
        locale: typeof parsed.locale === 'string' && parsed.locale ? parsed.locale : 'ja-JP',
        time_zone: typeof parsed.time_zone === 'string' && parsed.time_zone ? parsed.time_zone : 'Asia/Tokyo',
        output_format: 'google-sheets',
        allowed_sheets: Array.isArray(parsed.allowed_sheets) ? parsed.allowed_sheets.filter((item): item is string => typeof item === 'string') : [],
        allowed_ranges: Array.isArray(parsed.allowed_ranges) ? parsed.allowed_ranges.filter((item): item is string => typeof item === 'string') : [],
        prohibited_elements: typeof parsed.prohibited_elements === 'string' ? parsed.prohibited_elements : '',
        enabled: parsed.enabled !== false,
        lifecycle_state: parsed.lifecycle_state ?? (parsed.enabled === false ? 'disabled' : 'draft'),
      };
    }
    if (parsed?.schema === 'astera.legacy-template.v1' && parsed.provider === 'legacy') {
      return {
        schema: 'astera.legacy-template.v1',
        template_source: 'personal',
        provider: 'legacy',
        google_file_id: null,
        locale: typeof parsed.locale === 'string' && parsed.locale ? parsed.locale : 'ja-JP',
        time_zone: typeof parsed.time_zone === 'string' && parsed.time_zone ? parsed.time_zone : 'Asia/Tokyo',
        output_format: 'legacy',
        allowed_sheets: [],
        allowed_ranges: [],
        prohibited_elements: '',
        enabled: parsed.enabled !== false,
        lifecycle_state: parsed.lifecycle_state ?? (parsed.enabled === false ? 'disabled' : 'draft'),
        legacy_content: typeof parsed.legacy_content === 'string' ? parsed.legacy_content : '',
      };
    }
  } catch { /* legacy row */ }
  return {
    schema: 'astera.legacy-template.v1',
    template_source: 'personal',
    provider: 'legacy',
    google_file_id: null,
    locale: 'ja-JP',
    time_zone: 'Asia/Tokyo',
    output_format: 'legacy',
    allowed_sheets: [],
    allowed_ranges: [],
    prohibited_elements: '',
    enabled: true,
    lifecycle_state: 'draft',
    legacy_content: raw,
  };
}
function serializeDocument(document: TemplateDocument): string { return JSON.stringify(document); }
function publicTemplate(row: TemplateRow): Record<string, unknown> {
  const document = parseDocument(row.content);
  return {
    id: row.id,
    template_id: row.id,
    title: row.title,
    version: Number(row.version),
    template_source: document.template_source,
    provider: document.provider,
    google_file_id: document.google_file_id,
    locale: document.locale,
    time_zone: document.time_zone,
    output_format: document.output_format,
    allowed_sheets: document.allowed_sheets,
    allowed_ranges: document.allowed_ranges,
    prohibited_elements: document.prohibited_elements,
    enabled: document.enabled,
    lifecycle_state: document.lifecycle_state,
    content: document.provider === 'legacy' ? document.legacy_content ?? '' : undefined,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
async function loadRow(db: D1Database, actor: TemplateActor, id: string, includeArchived = false): Promise<TemplateRow> {
  const row = await db.prepare(`SELECT id,tenant_id,user_id,title,content,version,created_at,updated_at,archived_at
    FROM personal_templates WHERE id=?1 AND tenant_id=?2 AND user_id=?3 ${includeArchived ? '' : 'AND archived_at IS NULL'} LIMIT 1`)
    .bind(id, actor.tenantId, actor.userId).first<TemplateRow>();
  if (!row) throw new TemplateStoreError(404, 'TEMPLATE_NOT_FOUND', 'Templateが見つかりません。');
  return row;
}
function normalizeCreate(value: unknown): { title: string; document: TemplateDocument } {
  const body = record(value);
  const title = boundedText(body.title ?? body.name, 'template_title', 120);
  if (!title) throw new TemplateStoreError(422, 'TEMPLATE_TITLE_INVALID', 'Template名は1〜120文字です。');
  const provider = text(body.provider);
  const requestedFileId = text(body.google_file_id ?? body.googleFileId);
  if (provider === 'google-sheets' || requestedFileId) {
    const enabled = body.enabled !== false;
    const document: TemplateDocument = {
      schema: 'astera.google-sheets-template.v1',
      template_source: 'personal',
      provider: 'google-sheets',
      google_file_id: googleFileId(body.google_file_id ?? body.googleFileId),
      locale: boundedText(body.locale, 'locale', 64, 'ja-JP'),
      time_zone: boundedText(body.time_zone ?? body.timeZone, 'time_zone', 100, 'Asia/Tokyo'),
      output_format: 'google-sheets',
      allowed_sheets: stringList(body.allowed_sheets ?? body.allowedSheets, 'allowed_sheets'),
      allowed_ranges: stringList(body.allowed_ranges ?? body.allowedRanges, 'allowed_ranges'),
      prohibited_elements: boundedText(body.prohibited_elements ?? body.prohibitedElements, 'prohibited_elements', 4000),
      enabled,
      lifecycle_state: lifecycle(body.lifecycle_state ?? body.state, enabled),
    };
    return { title, document };
  }
  const content = text(body.content ?? body.body);
  if (!content || [...content].length > 200_000) throw new TemplateStoreError(422, 'TEMPLATE_CONTENT_INVALID', 'Legacy Template本文は1〜200,000文字です。');
  return {
    title,
    document: {
      schema: 'astera.legacy-template.v1', template_source: 'personal', provider: 'legacy', google_file_id: null,
      locale: 'ja-JP', time_zone: 'Asia/Tokyo', output_format: 'legacy', allowed_sheets: [], allowed_ranges: [],
      prohibited_elements: '', enabled: true, lifecycle_state: 'draft', legacy_content: content,
    },
  };
}
function applyPatch(row: TemplateRow, value: unknown): { title: string; document: TemplateDocument } {
  const body = record(value);
  const current = parseDocument(row.content);
  const expectedVersion = body.expected_version ?? body.expectedVersion;
  if (expectedVersion !== undefined && Number(expectedVersion) !== Number(row.version)) {
    throw new TemplateStoreError(409, 'TEMPLATE_VERSION_CONFLICT', 'Templateが別の操作で更新されています。再取得してください。', { current_version: row.version });
  }
  const title = body.title === undefined && body.name === undefined ? row.title : boundedText(body.title ?? body.name, 'template_title', 120);
  if (!title) throw new TemplateStoreError(422, 'TEMPLATE_TITLE_INVALID', 'Template名は1〜120文字です。');
  if (current.provider === 'legacy') {
    if (body.content !== undefined || body.body !== undefined) {
      const legacy = text(body.content ?? body.body);
      if (!legacy || [...legacy].length > 200_000) throw new TemplateStoreError(422, 'TEMPLATE_CONTENT_INVALID', 'Legacy Template本文は1〜200,000文字です。');
      current.legacy_content = legacy;
    }
  } else {
    if (body.google_file_id !== undefined || body.googleFileId !== undefined) current.google_file_id = googleFileId(body.google_file_id ?? body.googleFileId);
    if (body.locale !== undefined) current.locale = boundedText(body.locale, 'locale', 64, current.locale);
    if (body.time_zone !== undefined || body.timeZone !== undefined) current.time_zone = boundedText(body.time_zone ?? body.timeZone, 'time_zone', 100, current.time_zone);
    if (body.allowed_sheets !== undefined || body.allowedSheets !== undefined) current.allowed_sheets = stringList(body.allowed_sheets ?? body.allowedSheets, 'allowed_sheets');
    if (body.allowed_ranges !== undefined || body.allowedRanges !== undefined) current.allowed_ranges = stringList(body.allowed_ranges ?? body.allowedRanges, 'allowed_ranges');
    if (body.prohibited_elements !== undefined || body.prohibitedElements !== undefined) current.prohibited_elements = boundedText(body.prohibited_elements ?? body.prohibitedElements, 'prohibited_elements', 4000);
  }
  if (body.enabled !== undefined) current.enabled = body.enabled === true;
  current.lifecycle_state = lifecycle(body.lifecycle_state ?? body.state ?? current.lifecycle_state, current.enabled);
  if (!current.enabled) current.lifecycle_state = 'disabled';
  return { title, document: current };
}
function snapshot(row: TemplateRow, document = parseDocument(row.content)): string {
  return JSON.stringify({ ...publicTemplate({ ...row, content: serializeDocument(document) }), archived_at: row.archived_at });
}

export async function listTemplates(db: D1Database, actor: TemplateActor): Promise<Record<string, unknown>> {
  const rows = (await db.prepare(`SELECT id,tenant_id,user_id,title,content,version,created_at,updated_at,archived_at
    FROM personal_templates WHERE tenant_id=?1 AND user_id=?2 AND archived_at IS NULL ORDER BY updated_at DESC`)
    .bind(actor.tenantId, actor.userId).all<TemplateRow>()).results ?? [];
  return { templates: rows.map(publicTemplate) };
}
export async function getTemplate(db: D1Database, actor: TemplateActor, id: string): Promise<Record<string, unknown>> {
  return { template: publicTemplate(await loadRow(db, actor, id)) };
}
export async function createTemplate(db: D1Database, actor: TemplateActor, value: unknown, changeKind: 'create' | 'duplicate' = 'create'): Promise<Record<string, unknown>> {
  const normalized = normalizeCreate(value);
  const id = crypto.randomUUID(), now = new Date().toISOString();
  const content = serializeDocument(normalized.document);
  const row: TemplateRow = { id, tenant_id: actor.tenantId, user_id: actor.userId, title: normalized.title, content, version: 1, created_at: now, updated_at: now, archived_at: null };
  await db.batch([
    db.prepare(`INSERT INTO personal_templates(id,tenant_id,user_id,title,content,version,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,1,?6,?6)`)
      .bind(id, actor.tenantId, actor.userId, normalized.title, content, now),
    db.prepare(`INSERT INTO personal_template_versions(template_id,tenant_id,user_id,version,snapshot_json,change_kind,created_at) VALUES(?1,?2,?3,1,?4,?5,?6)`)
      .bind(id, actor.tenantId, actor.userId, snapshot(row, normalized.document), changeKind, now),
  ]);
  return { template: publicTemplate(row) };
}
export async function updateTemplate(db: D1Database, actor: TemplateActor, id: string, value: unknown): Promise<Record<string, unknown>> {
  const current = await loadRow(db, actor, id);
  const normalized = applyPatch(current, value);
  const version = Number(current.version) + 1, now = new Date().toISOString(), content = serializeDocument(normalized.document);
  const next: TemplateRow = { ...current, title: normalized.title, content, version, updated_at: now };
  const result = await db.batch([
    db.prepare(`UPDATE personal_templates SET title=?1,content=?2,version=?3,updated_at=?4 WHERE id=?5 AND tenant_id=?6 AND user_id=?7 AND archived_at IS NULL AND version=?8`)
      .bind(normalized.title, content, version, now, id, actor.tenantId, actor.userId, current.version),
    db.prepare(`INSERT INTO personal_template_versions(template_id,tenant_id,user_id,version,snapshot_json,change_kind,created_at) VALUES(?1,?2,?3,?4,?5,'update',?6)`)
      .bind(id, actor.tenantId, actor.userId, version, snapshot(next, normalized.document), now),
  ]);
  if (result[0]?.success === false) throw new TemplateStoreError(409, 'TEMPLATE_VERSION_CONFLICT', 'Template更新が競合しました。再取得してください。');
  return { template: publicTemplate(next) };
}
export async function duplicateTemplate(db: D1Database, actor: TemplateActor, id: string, value: unknown): Promise<Record<string, unknown>> {
  const current = await loadRow(db, actor, id);
  const document = parseDocument(current.content);
  document.lifecycle_state = document.enabled ? 'draft' : 'disabled';
  const body = record(value);
  const title = text(body.title) || `${current.title} コピー`;
  if (document.provider === 'google-sheets') {
    return createTemplate(db, actor, { title, ...document, google_file_id: document.google_file_id }, 'duplicate');
  }
  return createTemplate(db, actor, { title, content: document.legacy_content ?? '' }, 'duplicate');
}
export async function deleteTemplate(db: D1Database, actor: TemplateActor, id: string): Promise<Record<string, unknown>> {
  const current = await loadRow(db, actor, id);
  const document = parseDocument(current.content);
  document.enabled = false;
  document.lifecycle_state = 'deleted';
  const version = Number(current.version) + 1, now = new Date().toISOString(), content = serializeDocument(document);
  const deleted: TemplateRow = { ...current, content, version, updated_at: now, archived_at: now };
  await db.batch([
    db.prepare(`UPDATE personal_templates SET content=?1,version=?2,updated_at=?3,archived_at=?3 WHERE id=?4 AND tenant_id=?5 AND user_id=?6 AND archived_at IS NULL AND version=?7`)
      .bind(content, version, now, id, actor.tenantId, actor.userId, current.version),
    db.prepare(`INSERT INTO personal_template_versions(template_id,tenant_id,user_id,version,snapshot_json,change_kind,created_at) VALUES(?1,?2,?3,?4,?5,'delete',?6)`)
      .bind(id, actor.tenantId, actor.userId, version, snapshot(deleted, document), now),
  ]);
  return { template: { ...publicTemplate(deleted), lifecycle_state: 'deleted', deleted_at: now } };
}
export async function listTemplateVersions(db: D1Database, actor: TemplateActor, id: string): Promise<Record<string, unknown>> {
  await loadRow(db, actor, id, true);
  const rows = (await db.prepare(`SELECT version,snapshot_json,change_kind,created_at FROM personal_template_versions
    WHERE template_id=?1 AND tenant_id=?2 AND user_id=?3 ORDER BY version DESC`)
    .bind(id, actor.tenantId, actor.userId).all<{version:number;snapshot_json:string;change_kind:string;created_at:string}>()).results ?? [];
  return { template_id: id, versions: rows.map((row) => ({ version: Number(row.version), change_kind: row.change_kind, created_at: row.created_at, snapshot: JSON.parse(row.snapshot_json) })) };
}
