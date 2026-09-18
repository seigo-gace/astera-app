PRAGMA foreign_keys = ON;

-- Prevent two different coupon codes from the same campaign bypassing a per-account limit
-- when requests arrive concurrently. redemption_seq is campaign/user scoped in redeem.ts.
CREATE UNIQUE INDEX IF NOT EXISTS coupon_redemption_campaign_user_seq
  ON coupon_redemptions(campaign_id, user_id, redemption_seq);
