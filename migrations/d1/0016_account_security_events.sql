-- Account security audit events (no secrets in metadata).
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS account_security_events (
  id TEXT NOT NULL PRIMARY KEY,
  user_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'sign_in_email',
    'sign_in_passkey',
    'sign_in_oauth',
    'sign_in_native_exchange',
    'sign_out',
    'password_change',
    'password_setup',
    '2fa_enable',
    '2fa_disable',
    '2fa_verify',
    'passkey_add',
    'passkey_delete',
    'session_revoke',
    'session_revoke_others',
    'session_revoke_all',
    'oauth_link',
    'oauth_unlink',
    'exchange_rejected'
  )),
  actor_ip TEXT,
  user_agent TEXT,
  correlation_id TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS account_security_events_tenant_user_created
  ON account_security_events (tenant_id, user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS account_security_events_correlation_id
  ON account_security_events (correlation_id);

CREATE INDEX IF NOT EXISTS account_security_events_event_type
  ON account_security_events (event_type);
