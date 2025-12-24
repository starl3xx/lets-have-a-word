-- Migration: 0011_referrer_fid_index.sql
-- Add index on referrer_fid for faster referral lookups
-- Note: We use an index rather than a foreign key constraint because:
-- 1. Referrals may come from users who haven't played yet (via Farcaster)
-- 2. Application-level validation handles invalid referrer FIDs
-- 3. This preserves flexibility while improving query performance

-- Add index for faster referral queries (finding all users referred by a given FID)
CREATE INDEX IF NOT EXISTS idx_users_referrer_fid ON users(referrer_fid) WHERE referrer_fid IS NOT NULL;
