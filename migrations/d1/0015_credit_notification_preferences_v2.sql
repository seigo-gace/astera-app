PRAGMA foreign_keys = ON;
ALTER TABLE credit_notification_preferences ADD COLUMN events_json TEXT NOT NULL DEFAULT '["credit.low","credit.critical","credit.insufficient","credit.purchase_pending","credit.credited","credit.resume_available","credit.resume_blocked"]' CHECK (json_valid(events_json));
