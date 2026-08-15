import type { D1Database } from './_account-projection';

export type NotificationActor = { userId: string; tenantId: string };
type NotificationRow = {
  id: string; type: string; severity: string; title: string; body: string;
  related_type: string | null; related_id: string | null; deep_link: string | null;
  policy_version: string | null; correlation_id: string; created_at: string; read_at: string | null;
};

export async function listNotifications(db: D1Database, actor: NotificationActor, limit = 50) {
  const safeLimit = Math.min(100, Math.max(1, Number.isInteger(limit) ? limit : 50));
  const rows = (await db.prepare(`SELECT id,type,severity,title,body,related_type,related_id,deep_link,policy_version,correlation_id,created_at,read_at
    FROM app_notifications WHERE tenant_id=?1 AND user_id=?2 ORDER BY created_at DESC LIMIT ?3`)
    .bind(actor.tenantId, actor.userId, safeLimit).all<NotificationRow>()).results ?? [];
  return { notifications: rows.map((row) => ({ ...row, read: Boolean(row.read_at) })) };
}
