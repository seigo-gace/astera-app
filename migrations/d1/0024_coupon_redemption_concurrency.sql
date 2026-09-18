PRAGMA foreign_keys = ON;

-- Prevent concurrent use of different codes from the same campaign bypassing per-account limits.
CREATE UNIQUE INDEX IF NOT EXISTS coupon_redemption_campaign_user_seq
  ON coupon_redemptions(campaign_id, user_id, redemption_seq);
