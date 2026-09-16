-- One-time compatibility repair for accounts that completed registration before the
-- password-required registration gate was introduced, but were later rewritten to
-- pending_password_setup by the account projection regression.
-- New accounts created after the gate are NOT affected and still require password setup.
PRAGMA foreign_keys = ON;

UPDATE user_profiles
SET account_status = 'active',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE account_status = 'pending_password_setup'
  AND created_at < '2026-09-16T08:04:50.000Z';
