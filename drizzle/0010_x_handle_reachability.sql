-- X handle resolution for tweet mentions
--
-- The announcer sends one string to both Farcaster and X (announcer.ts,
-- postTweet(params.text)). Farcaster usernames and X handles are separate
-- namespaces, so every "@name" in a tweet is a coin flip that lands on a
-- stranger. Sampled 15 of the names already tweeted: 14 are live X accounts
-- belonging to other people, including one with 105,653 followers and one
-- spam account.
--
-- These columns cache what walletlink.social knows about a player's real X
-- handle, so the tweet can mention the right account when it is live and fall
-- back to a plain name when it is not.
--
-- Nullable on purpose, and the checked_at is separate from the value:
--   x_handle       NULL = no X handle known for this player
--   x_reachability NULL = never looked, which is not the same as "unreachable"
--   x_checked_at   NULL = never looked, so it is due; this is the retry signal,
--                  matching wallet_tx_count_checked_at and
--                  coinbase_attested_checked_at elsewhere on this table.
--
-- A failed lookup must leave all three untouched rather than writing a false
-- negative: absence of evidence is not evidence of absence, and a wrong value
-- here suppresses a mention the player earned.

ALTER TABLE users ADD COLUMN IF NOT EXISTS x_handle VARCHAR(15);
ALTER TABLE users ADD COLUMN IF NOT EXISTS x_reachability VARCHAR(12);
ALTER TABLE users ADD COLUMN IF NOT EXISTS x_checked_at TIMESTAMP;

-- The announcer resolves by Farcaster username, since that is what appears in
-- the cast copy it is rewriting. Case-insensitive because usernames are
-- compared lowercased.
CREATE INDEX IF NOT EXISTS users_username_lower_idx
  ON users (lower(username)) WHERE username IS NOT NULL;

COMMENT ON COLUMN users.x_handle IS
  'Real X handle from walletlink.social, NOT the Farcaster username. NULL = none known.';
COMMENT ON COLUMN users.x_reachability IS
  'live | suspended | unclaimed | reassigned. Only "live" earns an @mention in a tweet.';
COMMENT ON COLUMN users.x_checked_at IS
  'Last successful walletlink lookup. NULL = never checked, so it is due.';
