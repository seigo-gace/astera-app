import type { D1Database } from './_account-projection';

export type ExternalStorageActor = { userId: string; tenantId: string };
export class ExternalStorageStoreError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
    this.name = 'ExternalStorageStoreError';
  }
}

export type ExternalStorageDestinationRow = {
  id: string;
  tenant_id: string;
  user_id: string;
  provider: string;
  account_label: string;
  root_folder: string | null;
  vault_reference: string;
  scopes_json: string;
  capabilities_json: string;
  status: string;
  last_verified_at: string | null;
  created_at: string;
  updated_at: string;
  revoked_at: string | null;
};

type ExecutionOption = { key: string; config?: Record<string, string> };

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function text(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
function parseArray(value: string): unknown[] {
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
}
function canonicalState(status: string): 'Connected' | 'NeedsReauth' | 'Unavailable' | 'Revoked' | 'Error' {
  if (status === 'active') return 'Connected';
  if (status === 'pending' || status === 'expired') return 'NeedsReauth';
  if (status === 'revoked') return 'Revoked';
  if (status === 'error') return 'Error';
  return 'Unavailable';
}
function publicDestination(row: ExternalStorageDestinationRow): Record<string, unknown> {
  return {
    id: row.id,
    destination_id: row.id,
    provider: row.provider,
    display_name: row.account_label,
    account_label: row.account_label,
    root_folder: row.root_folder,
    scopes: parseArray(row.scopes_json),
    capabilities: parseArray(row.capabilities_json),
    status: row.status,
    state: canonicalState(row.status),
    usable: row.status === 'active' && !row.revoked_at && Boolean(row.vault_reference),
    credential_reference_present: Boolean(row.vault_reference),
    last_verified_at: row.last_verified_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    revoked_at: row.revoked_at,
  };
}
async function loadDestination(db: D1Database, actor: ExternalStorageActor, id: string, includeRevoked = false): Promise<ExternalStorageDestinationRow> {
  const row = await db.prepare(`SELECT id,tenant_id,user_id,provider,account_label,root_folder,vault_reference,scopes_json,capabilities_json,status,last_verified_at,created_at,updated_at,revoked_at
    FROM storage_destinations WHERE id=?1 AND tenant_id=?2 AND user_id=?3 ${includeRevoked ? '' : 'AND revoked_at IS NULL'} LIMIT 1`)
    .bind(id, actor.tenantId, actor.userId).first<ExternalStorageDestinationRow>();
  if (!row) throw new ExternalStorageStoreError(404, 'STORAGE_DESTINATION_NOT_FOUND', '外部Storage接続先が見つかりません。');
  return row;
}

export async function listExternalStorageDestinations(db: D1Database, actor: ExternalStorageActor) {
  const rows = (await db.prepare(`SELECT id,tenant_id,user_id,provider,account_label,root_folder,vault_reference,scopes_json,capabilities_json,status,last_verified_at,created_at,updated_at,revoked_at
    FROM storage_destinations WHERE tenant_id=?1 AND user_id=?2 AND revoked_at IS NULL ORDER BY updated_at DESC`)
    .bind(actor.tenantId, actor.userId).all<ExternalStorageDestinationRow>()).results ?? [];
  return { destinations: rows.map(publicDestination) };
}

export async function getExternalStorageDestination(db: D1Database, actor: ExternalStorageActor, id: string) {
  return { destination: publicDestination(await loadDestination(db, actor, id)) };
}

export async function updateExternalStorageDestination(db: D1Database, actor: ExternalStorageActor, id: string, value: unknown) {
  const body = record(value);
  const current = await loadDestination(db, actor, id);
  const expectedUpdatedAt = text(body.expected_updated_at ?? body.expectedUpdatedAt);
  if (expectedUpdatedAt && expectedUpdatedAt !== current.updated_at) {
    throw new ExternalStorageStoreError(409, 'STORAGE_DESTINATION_VERSION_CONFLICT', '接続先が別の操作で更新されています。再取得してください。', { current_updated_at: current.updated_at });
  }
  let accountLabel = current.account_label;
  let rootFolder = current.root_folder;
  if (body.account_label !== undefined || body.accountLabel !== undefined) {
    accountLabel = text(body.account_label ?? body.accountLabel);
    if (!accountLabel || [...accountLabel].length > 160) throw new ExternalStorageStoreError(422, 'STORAGE_ACCOUNT_LABEL_INVALID', 'Account Labelは1〜160文字です。');
  }
  if (body.root_folder !== undefined || body.rootFolder !== undefined) {
    const raw = body.root_folder ?? body.rootFolder;
    if (raw === null || text(raw) === '') rootFolder = null;
    else {
      const normalized = text(raw);
      if ([...normalized].length > 1024 || /[\u0000\r\n]/.test(normalized)) throw new ExternalStorageStoreError(422, 'STORAGE_ROOT_FOLDER_INVALID', 'Root Folderを確認してください。');
      rootFolder = normalized;
    }
  }
  const now = new Date().toISOString();
  const result = await db.prepare(`UPDATE storage_destinations SET account_label=?1,root_folder=?2,updated_at=?3
    WHERE id=?4 AND tenant_id=?5 AND user_id=?6 AND revoked_at IS NULL AND updated_at=?7`)
    .bind(accountLabel, rootFolder, now, id, actor.tenantId, actor.userId, current.updated_at).run();
  const changes = Number(result.meta?.changes ?? 1);
  if (result.success === false || changes === 0) throw new ExternalStorageStoreError(409, 'STORAGE_DESTINATION_VERSION_CONFLICT', '接続先更新が競合しました。再取得してください。');
  return getExternalStorageDestination(db, actor, id);
}

export async function revokeExternalStorageDestination(db: D1Database, actor: ExternalStorageActor, id: string) {
  const current = await loadDestination(db, actor, id);
  const now = new Date().toISOString();
  const result = await db.prepare(`UPDATE storage_destinations SET status='revoked',revoked_at=?1,updated_at=?1
    WHERE id=?2 AND tenant_id=?3 AND user_id=?4 AND revoked_at IS NULL AND updated_at=?5`)
    .bind(now, id, actor.tenantId, actor.userId, current.updated_at).run();
  const changes = Number(result.meta?.changes ?? 1);
  if (result.success === false || changes === 0) throw new ExternalStorageStoreError(409, 'STORAGE_DESTINATION_VERSION_CONFLICT', '接続先削除が競合しました。再取得してください。');
  const revoked = await loadDestination(db, actor, id, true);
  return {
    destination: publicDestination(revoked),
    credential_cleanup_pending: true,
    credential_cleanup_reason: 'Provider Token／Vault SecretのRevokeはOAuth・Credential Adapter接続後に実行します。',
  };
}

export async function assertExternalStorageExecutionDestinations(db: D1Database, actor: ExternalStorageActor, options: ExecutionOption[]): Promise<void> {
  const transfers = options.filter((option) => option.key === 'external-storage-transfer');
  for (const transfer of transfers) {
    const destinationId = text(transfer.config?.destinationId);
    if (!destinationId) throw new ExternalStorageStoreError(422, 'STORAGE_DESTINATION_REQUIRED', '転送先Storageを指定してください。');
    let row: ExternalStorageDestinationRow;
    try { row = await loadDestination(db, actor, destinationId); }
    catch (error) {
      if (error instanceof ExternalStorageStoreError && error.code === 'STORAGE_DESTINATION_NOT_FOUND') {
        throw new ExternalStorageStoreError(409, 'STORAGE_DESTINATION_NOT_AVAILABLE', '指定した外部Storage接続先を利用できません。', { destination_id: destinationId });
      }
      throw error;
    }
    if (!row.vault_reference) throw new ExternalStorageStoreError(503, 'STORAGE_CREDENTIAL_REFERENCE_MISSING', '外部Storage Credential参照を確認できないため安全停止しました。', { destination_id: destinationId });
    if (row.status === 'expired' || row.status === 'pending') throw new ExternalStorageStoreError(409, 'STORAGE_DESTINATION_REAUTH_REQUIRED', '外部Storageの再認証が必要です。', { destination_id: destinationId, state: canonicalState(row.status) });
    if (row.status !== 'active') throw new ExternalStorageStoreError(409, 'STORAGE_DESTINATION_UNAVAILABLE', '外部Storage接続先を現在利用できません。', { destination_id: destinationId, state: canonicalState(row.status) });
  }
}
