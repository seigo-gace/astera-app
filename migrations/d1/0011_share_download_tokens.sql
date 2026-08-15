CREATE TABLE IF NOT EXISTS share_download_tokens (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  share_id TEXT NOT NULL REFERENCES result_shares(id) ON DELETE CASCADE,
  issued_to_user_id TEXT,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS share_download_tokens_share ON share_download_tokens(share_id, created_at DESC);
CREATE INDEX IF NOT EXISTS share_download_tokens_expiry ON share_download_tokens(expires_at, consumed_at);
