-- Versioned commercial catalog, subscription projection and Square provider mapping.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS plan_catalog_entries (
  catalog_version TEXT NOT NULL REFERENCES catalog_versions(version),
  plan_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  currency TEXT NOT NULL CHECK (currency = 'JPY'),
  recurring_amount INTEGER NOT NULL CHECK (recurring_amount >= 0),
  recurring_interval TEXT NOT NULL CHECK (recurring_interval IN ('month', 'year', 'none')),
  included_credits INTEGER NOT NULL CHECK (included_credits >= 0),
  entitlement_ids TEXT NOT NULL DEFAULT '[]',
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  square_plan_variation_id TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (catalog_version, plan_id)
);

CREATE TABLE IF NOT EXISTS credit_products (
  catalog_version TEXT NOT NULL REFERENCES catalog_versions(version),
  product_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  currency TEXT NOT NULL CHECK (currency = 'JPY'),
  amount INTEGER NOT NULL CHECK (amount > 0),
  credits INTEGER NOT NULL CHECK (credits > 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  square_catalog_object_id TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (catalog_version, product_id)
);

CREATE TABLE IF NOT EXISTS tenant_subscriptions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL UNIQUE REFERENCES tenants(id),
  catalog_version TEXT NOT NULL REFERENCES catalog_versions(version),
  plan_id TEXT NOT NULL,
  provider_subscription_id TEXT UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('none', 'pending', 'active', 'paused', 'grace', 'cancel_pending', 'cancelled', 'failed')),
  current_period_start TEXT,
  current_period_end TEXT,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0 CHECK (cancel_at_period_end IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (catalog_version, plan_id) REFERENCES plan_catalog_entries(catalog_version, plan_id)
);

ALTER TABLE billing_intents ADD COLUMN product_kind TEXT NOT NULL DEFAULT 'credit' CHECK (product_kind IN ('credit', 'plan'));
ALTER TABLE billing_intents ADD COLUMN credit_amount INTEGER NOT NULL DEFAULT 0 CHECK (credit_amount >= 0);
ALTER TABLE billing_intents ADD COLUMN provider_order_id TEXT;
ALTER TABLE billing_intents ADD COLUMN provider_payment_id TEXT;
ALTER TABLE billing_intents ADD COLUMN checkout_url TEXT;
ALTER TABLE billing_intents ADD COLUMN return_context_id TEXT;
ALTER TABLE billing_intents ADD COLUMN expires_at TEXT;
ALTER TABLE billing_intents ADD COLUMN completed_at TEXT;
ALTER TABLE billing_intents ADD COLUMN failure_code TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS billing_intents_provider_order
  ON billing_intents(provider_order_id) WHERE provider_order_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS billing_intents_provider_payment
  ON billing_intents(provider_payment_id) WHERE provider_payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS billing_intents_tenant_created
  ON billing_intents(tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS return_contexts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL,
  route TEXT NOT NULL,
  reference_type TEXT NOT NULL,
  reference_id TEXT,
  private_mode INTEGER NOT NULL DEFAULT 0 CHECK (private_mode IN (0, 1)),
  resume_mode TEXT NOT NULL CHECK (resume_mode IN ('user_confirm', 'user_confirm_and_reestimate')),
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS return_contexts_tenant_expiry
  ON return_contexts(tenant_id, expires_at);
