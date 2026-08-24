-- Annual billing variants. Plan identity stays stable; billing cadence becomes a variant.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS plan_billing_variants (
  catalog_version TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  billing_cycle TEXT NOT NULL CHECK (billing_cycle IN ('monthly', 'annual')),
  recurring_amount INTEGER NOT NULL CHECK (recurring_amount >= 0),
  recurring_interval TEXT NOT NULL CHECK (recurring_interval IN ('month', 'year')),
  included_credits INTEGER NOT NULL CHECK (included_credits >= 0),
  square_plan_variation_id TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  PRIMARY KEY (catalog_version, plan_id, billing_cycle),
  FOREIGN KEY (catalog_version, plan_id) REFERENCES plan_catalog_entries(catalog_version, plan_id)
);

INSERT OR IGNORE INTO plan_billing_variants
  (catalog_version, plan_id, billing_cycle, recurring_amount, recurring_interval,
   included_credits, square_plan_variation_id, active, created_at)
SELECT catalog_version, plan_id, 'monthly', recurring_amount, 'month',
       included_credits, square_plan_variation_id, active, created_at
FROM plan_catalog_entries;

INSERT OR IGNORE INTO plan_billing_variants
  (catalog_version, plan_id, billing_cycle, recurring_amount, recurring_interval,
   included_credits, square_plan_variation_id, active, created_at)
SELECT catalog_version, plan_id, 'annual',
       CASE plan_id
         WHEN 'basic' THEN 9800
         WHEN 'pro' THEN 29800
         WHEN 'business' THEN 99800
         WHEN 'enterprise' THEN 298000
       END,
       'year', included_credits, NULL, active, created_at
FROM plan_catalog_entries
WHERE plan_id IN ('basic', 'pro', 'business', 'enterprise');

ALTER TABLE tenant_subscriptions
  ADD COLUMN billing_cycle TEXT NOT NULL DEFAULT 'monthly'
  CHECK (billing_cycle IN ('monthly', 'annual'));

ALTER TABLE billing_intents
  ADD COLUMN billing_cycle TEXT
  CHECK (billing_cycle IS NULL OR billing_cycle IN ('monthly', 'annual'));

CREATE INDEX IF NOT EXISTS plan_billing_variants_active
  ON plan_billing_variants(catalog_version, active, plan_id, billing_cycle);
CREATE INDEX IF NOT EXISTS tenant_subscriptions_plan_cycle
  ON tenant_subscriptions(plan_id, billing_cycle, status);
