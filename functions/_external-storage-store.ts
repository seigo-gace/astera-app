import type { D1Database } from './_account-projection';

export type ExternalStorageActor = { userId: string; tenantId: string };
export type ExternalStorageDestinationRow = {
  id: string;
  provider: string;
  account_label: string;
  status: string;
  capabilities_json: string;
  last_verified_at: string | null;
  created_at: string;
  updated_at: string;
};

function parseArray(value: string): unknown[] {
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
}

export async function listExternalStorageDestinations(db: D1Database, actor: ExternalStorageActor) {
  const rows = (await db.prepare(`SELECT id,provider,account_label,status,capabilities_json,last_verified_at,created_at,updated_at
    FROM storage_destinations WHERE tenant_id=?1 AND user_id=?2 AND revoked_at IS NULL ORDER BY updated_at DESC`)
    .bind(actor.tenantId, actor.userId).all<ExternalStorageDestinationRow>()).results ?? [];
  return {
    destinations: rows.map((row) => ({
      id: row.id,
      provider: row.provider,
      display_name: row.account_label,
      account_label: row.account_label,
      status: row.status,
      capabilities: parseArray(row.capabilities_json),
      last_verified_at: row.last_verified_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
    })),
  };
}
