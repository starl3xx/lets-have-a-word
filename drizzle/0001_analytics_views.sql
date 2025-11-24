-- Analytics Views for "Let's Have A Word"
-- Milestone 5.2: Analytics system
--
-- These views aggregate data from the analytics_events table
-- Run this script manually against your Neon database:
-- psql $DATABASE_URL < drizzle/0001_analytics_views.sql

-- =============================================================================
-- View 1: DAU (Daily Active Users)
-- =============================================================================
-- Count distinct users who had any activity each day
CREATE OR REPLACE VIEW view_dau AS
SELECT
  DATE(created_at) as day,
  COUNT(DISTINCT user_id) as active_users
FROM analytics_events
WHERE user_id IS NOT NULL
GROUP BY DATE(created_at)
ORDER BY day DESC;

-- =============================================================================
-- View 2: WAU (Weekly Active Users)
-- =============================================================================
-- Count distinct users who had any activity each ISO week
CREATE OR REPLACE VIEW view_wau AS
SELECT
  DATE_TRUNC('week', created_at)::date as week_start,
  COUNT(DISTINCT user_id) as active_users
FROM analytics_events
WHERE user_id IS NOT NULL
GROUP BY DATE_TRUNC('week', created_at)
ORDER BY week_start DESC;

-- =============================================================================
-- View 3: Free/Paid Guess Ratio
-- =============================================================================
-- Breakdown of free vs paid guesses per day
CREATE OR REPLACE VIEW view_free_paid_ratio AS
SELECT
  DATE(created_at) as day,
  COUNT(*) FILTER (WHERE event_type = 'free_guess_used') as free_guesses,
  COUNT(*) FILTER (WHERE event_type = 'paid_guess_used') as paid_guesses,
  CASE
    WHEN COUNT(*) FILTER (WHERE event_type = 'paid_guess_used') > 0
    THEN ROUND(
      COUNT(*) FILTER (WHERE event_type = 'free_guess_used')::numeric /
      COUNT(*) FILTER (WHERE event_type = 'paid_guess_used')::numeric,
      2
    )
    ELSE 0
  END as free_to_paid_ratio
FROM analytics_events
WHERE event_type IN ('free_guess_used', 'paid_guess_used')
GROUP BY DATE(created_at)
ORDER BY day DESC;

-- =============================================================================
-- View 4: Jackpot Growth
-- =============================================================================
-- Track prize pool evolution from round resolution events
CREATE OR REPLACE VIEW view_jackpot_growth AS
SELECT
  DATE(created_at) as day,
  CAST(round_id AS INTEGER) as round_id,
  CAST(data->>'prizePoolEth' AS NUMERIC) as jackpot_eth,
  CAST(data->>'winnerFid' AS INTEGER) as winner_fid
FROM analytics_events
WHERE event_type = 'round_resolved'
  AND data->>'prizePoolEth' IS NOT NULL
ORDER BY day DESC;

-- =============================================================================
-- View 5: Referral Funnel
-- =============================================================================
-- Aggregate referral metrics per day
CREATE OR REPLACE VIEW view_referral_funnel AS
SELECT
  DATE(created_at) as day,
  COUNT(*) FILTER (WHERE event_type = 'referral_share') as referral_shares,
  COUNT(*) FILTER (WHERE event_type = 'referral_join') as referral_joins,
  COUNT(*) FILTER (WHERE event_type = 'referral_win') as referral_wins,
  COUNT(*) FILTER (WHERE event_type = 'share_bonus_unlocked') as bonus_unlocked
FROM analytics_events
WHERE event_type IN ('referral_share', 'referral_join', 'referral_win', 'share_bonus_unlocked')
GROUP BY DATE(created_at)
ORDER BY day DESC;

-- =============================================================================
-- Verification Queries
-- =============================================================================
-- Run these to verify the views are working:

-- SELECT * FROM view_dau LIMIT 30;
-- SELECT * FROM view_wau LIMIT 12;
-- SELECT * FROM view_free_paid_ratio LIMIT 30;
-- SELECT * FROM view_jackpot_growth LIMIT 30;
-- SELECT * FROM view_referral_funnel LIMIT 30;
