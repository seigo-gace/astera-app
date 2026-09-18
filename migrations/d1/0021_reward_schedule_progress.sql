ALTER TABLE reward_credit_schedules ADD COLUMN grants_applied INTEGER NOT NULL DEFAULT 1 CHECK (grants_applied >= 1);
