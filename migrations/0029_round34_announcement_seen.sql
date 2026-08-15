-- 0029: seen-flag for the one-time round-34 announcement modal.
--
-- The modal itself is era-gated server-side: /api/onboarding/status offers it
-- only while the ACTIVE round pays $WORD (rounds.prize_currency = 'word'), so
-- opening the app before round 34 starts cannot leak the update. This column
-- only records dismissal, same pattern as the other has_seen_* flags.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS has_seen_round34_announcement boolean NOT NULL DEFAULT false;
