PRAGMA foreign_keys = ON;

ALTER TABLE app_jobs
  ADD COLUMN purpose_text TEXT CHECK (purpose_text IS NULL OR length(purpose_text) <= 2000);

ALTER TABLE chat_turns
  ADD COLUMN purpose_text TEXT CHECK (purpose_text IS NULL OR length(purpose_text) <= 2000);
