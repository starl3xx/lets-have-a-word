-- Round Archive Tables for "Let's Have A Word"
-- Milestone 5.4: Round archive
--
-- These tables store historical round data for the archive feature
-- Run this script manually against your Neon database:
-- psql $DATABASE_URL < drizzle/0002_round_archive.sql

-- =============================================================================
-- Table 1: round_archive
-- =============================================================================
-- Stores archived round data with computed statistics
CREATE TABLE IF NOT EXISTS round_archive (
  id SERIAL PRIMARY KEY,
  round_number INTEGER NOT NULL UNIQUE,
  target_word VARCHAR(5) NOT NULL,
  seed_eth DECIMAL(20, 18) NOT NULL,
  final_jackpot_eth DECIMAL(20, 18) NOT NULL,
  total_guesses INTEGER NOT NULL,
  unique_players INTEGER NOT NULL,
  winner_fid INTEGER,
  winner_cast_hash VARCHAR(100),
  winner_guess_number INTEGER,
  start_time TIMESTAMP NOT NULL,
  end_time TIMESTAMP NOT NULL,
  referrer_fid INTEGER,
  payouts_json JSONB NOT NULL,
  salt VARCHAR(64) NOT NULL,
  clankton_bonus_count INTEGER NOT NULL DEFAULT 0,
  referral_bonus_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Indexes for round_archive
CREATE INDEX IF NOT EXISTS index_round_archive_on_round_number ON round_archive(round_number);
CREATE INDEX IF NOT EXISTS round_archive_winner_fid_idx ON round_archive(winner_fid);
CREATE INDEX IF NOT EXISTS round_archive_start_time_idx ON round_archive(start_time);

-- =============================================================================
-- Table 2: round_archive_errors
-- =============================================================================
-- Stores anomalies and errors encountered during archiving
CREATE TABLE IF NOT EXISTS round_archive_errors (
  id SERIAL PRIMARY KEY,
  round_number INTEGER NOT NULL,
  error_type VARCHAR(100) NOT NULL,
  error_message VARCHAR(1000) NOT NULL,
  error_data JSONB,
  resolved BOOLEAN NOT NULL DEFAULT FALSE,
  resolved_at TIMESTAMP,
  resolved_by INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Indexes for round_archive_errors
CREATE INDEX IF NOT EXISTS round_archive_errors_round_number_idx ON round_archive_errors(round_number);
CREATE INDEX IF NOT EXISTS round_archive_errors_unresolved_idx ON round_archive_errors(resolved);

-- =============================================================================
-- View: Archive Summary Statistics
-- =============================================================================
-- Provides aggregate statistics for the archive dashboard
CREATE OR REPLACE VIEW view_archive_stats AS
SELECT
  COUNT(*) as total_rounds,
  SUM(total_guesses) as total_guesses_all_time,
  COUNT(DISTINCT winner_fid) as unique_winners,
  SUM(final_jackpot_eth) as total_jackpot_distributed,
  AVG(total_guesses) as avg_guesses_per_round,
  AVG(unique_players) as avg_players_per_round,
  AVG(EXTRACT(EPOCH FROM (end_time - start_time)) / 60) as avg_round_length_minutes
FROM round_archive;

-- =============================================================================
-- Verification Queries
-- =============================================================================
-- Run these to verify the tables are created:

-- SELECT * FROM round_archive LIMIT 5;
-- SELECT * FROM round_archive_errors LIMIT 5;
-- SELECT * FROM view_archive_stats;
