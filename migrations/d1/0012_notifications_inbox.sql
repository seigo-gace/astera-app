CREATE TABLE IF NOT EXISTS app_notifications (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  event_id TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK (type IN (
    'credit.low','credit.critical','credit.insufficient','credit.purchase_pending',
    'credit.credited','credit.resume_available','credit.resume_blocked',
    'account.security','account.lifecycle','storage.lifecycle','system.status'
  )),
  severity TEXT NOT NULL CHECK (severity IN ('info','warning','critical')),
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  related_type TEXT,
  related_id TEXT,
  deep_link TEXT,
  policy_version TEXT,
  correlation_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  read_at TEXT
);
CREATE INDEX IF NOT EXISTS app_notifications_user_created
  ON app_notifications(tenant_id, user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS app_notifications_user_unread
  ON app_notifications(tenant_id, user_id, read_at, created_at DESC);
