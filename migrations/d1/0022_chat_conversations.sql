PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS chat_conversations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS chat_conversations_owner_updated
  ON chat_conversations(tenant_id, user_id, archived_at, updated_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS chat_turns (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL,
  job_id TEXT NOT NULL UNIQUE REFERENCES app_jobs(id) ON DELETE CASCADE,
  prompt TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('auto','review','compare','verify','improve','research','plan','consider')),
  position INTEGER NOT NULL CHECK (position >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (conversation_id, position)
);

CREATE INDEX IF NOT EXISTS chat_turns_conversation_position
  ON chat_turns(conversation_id, position ASC);
CREATE INDEX IF NOT EXISTS chat_turns_owner_job
  ON chat_turns(tenant_id, user_id, job_id);
