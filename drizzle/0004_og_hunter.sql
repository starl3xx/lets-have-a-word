-- OG Hunter Campaign Tables
-- Milestone: OG Hunter prelaunch campaign
--
-- Run this migration against your database:
-- psql $DATABASE_URL < drizzle/0004_og_hunter.sql

-- =============================================================================
-- Add addedMiniAppAt column to users table
-- =============================================================================
-- Tracks when a user added the mini app via Farcaster SDK webhook
ALTER TABLE users ADD COLUMN IF NOT EXISTS added_mini_app_at TIMESTAMP;

-- =============================================================================
-- User Badges Table
-- =============================================================================
-- Stores badges awarded to users (OG Hunter, etc.)
CREATE TABLE IF NOT EXISTS user_badges (
  id SERIAL PRIMARY KEY,
  fid INTEGER NOT NULL,
  badge_type VARCHAR(50) NOT NULL,
  metadata JSONB,
  awarded_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(fid, badge_type)
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS user_badges_fid_idx ON user_badges(fid);
CREATE INDEX IF NOT EXISTS user_badges_badge_type_idx ON user_badges(badge_type);

-- =============================================================================
-- OG Hunter Cast Proofs Table
-- =============================================================================
-- Stores verified cast share proofs for OG Hunter campaign
CREATE TABLE IF NOT EXISTS og_hunter_cast_proofs (
  id SERIAL PRIMARY KEY,
  fid INTEGER NOT NULL UNIQUE,
  cast_hash VARCHAR(100) NOT NULL,
  cast_url VARCHAR(500),
  cast_text VARCHAR(1000),
  verified_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS og_hunter_cast_proofs_fid_idx ON og_hunter_cast_proofs(fid);
CREATE INDEX IF NOT EXISTS og_hunter_cast_proofs_cast_hash_idx ON og_hunter_cast_proofs(cast_hash);

-- =============================================================================
-- Verification
-- =============================================================================
-- Verify tables were created
DO $$
BEGIN
  RAISE NOTICE 'OG Hunter migration complete:';
  RAISE NOTICE '  - users.added_mini_app_at column added';
  RAISE NOTICE '  - user_badges table created';
  RAISE NOTICE '  - og_hunter_cast_proofs table created';
END $$;
