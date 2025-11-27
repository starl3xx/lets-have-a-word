-- XP Events Table Migration
-- Milestone 6.7: Event-sourced XP tracking system
--
-- Creates the xp_events table for tracking all XP-earning actions.
-- Total XP is computed by summing xp_amount for a given FID.
--
-- Run this script manually against your Neon database:
-- psql $DATABASE_URL < drizzle/0003_xp_events.sql

-- =============================================================================
-- Table: xp_events
-- =============================================================================
-- Stores all XP-earning events in an event-sourced pattern.
-- Each row represents a single XP-earning action.
-- Total XP = SUM(xp_amount) WHERE fid = ?

CREATE TABLE IF NOT EXISTS xp_events (
  id SERIAL PRIMARY KEY,
  fid INTEGER NOT NULL,
  round_id INTEGER,
  event_type VARCHAR(50) NOT NULL,
  xp_amount INTEGER NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for efficient per-user XP queries and time-based lookups
CREATE INDEX IF NOT EXISTS xp_events_fid_created_at_idx
  ON xp_events (fid, created_at DESC);

-- Index for round-specific XP queries
CREATE INDEX IF NOT EXISTS xp_events_round_id_idx
  ON xp_events (round_id);

-- Index for event type queries (analytics, debugging)
CREATE INDEX IF NOT EXISTS xp_events_event_type_idx
  ON xp_events (event_type);

-- =============================================================================
-- XP Event Types Reference (for documentation)
-- =============================================================================
-- DAILY_PARTICIPATION    - +10 XP for first valid guess of the day
-- GUESS                  - +2 XP per valid guess (free or paid)
-- WIN                    - +2500 XP for correctly guessing the secret word
-- TOP_TEN_GUESSER        - +50 XP for being in top 10 guessers at round resolution
-- REFERRAL_FIRST_GUESS   - +20 XP when a referred user makes their first guess
-- STREAK_DAY             - +15 XP for each consecutive day playing (after day 1)
-- NEAR_MISS              - 0 XP (tracking only) for guesses close to the answer
-- CLANKTON_BONUS_DAY     - +10 XP per day for CLANKTON holders who participate
-- SHARE_CAST             - +15 XP for sharing to Farcaster (once per day)
-- PACK_PURCHASE          - +20 XP per pack purchase

-- =============================================================================
-- Verification Queries
-- =============================================================================
-- Run these to verify the table is working:
--
-- Get total XP for a user:
-- SELECT COALESCE(SUM(xp_amount), 0) AS total_xp FROM xp_events WHERE fid = 123;
--
-- Get recent XP events:
-- SELECT * FROM xp_events WHERE fid = 123 ORDER BY created_at DESC LIMIT 20;
--
-- Get XP breakdown by type:
-- SELECT event_type, SUM(xp_amount) AS total FROM xp_events WHERE fid = 123 GROUP BY event_type;
--
-- Get XP earned per round:
-- SELECT round_id, SUM(xp_amount) AS xp FROM xp_events WHERE fid = 123 AND round_id IS NOT NULL GROUP BY round_id;
