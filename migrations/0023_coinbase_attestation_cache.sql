-- 0023: cache Coinbase Verified Account attestation lookups
--
-- The wallet-cluster gate consults this on the guess path, so the EAS read is
-- memoised rather than repeated per guess. NULL means "never checked" and is
-- distinct from FALSE ("checked, not verified") — the gate needs to tell those
-- apart to know whether its cached answer is worth trusting.
--
-- Both columns are nullable with no default, so this is additive and safe to
-- apply before the code that reads them ships.

ALTER TABLE users ADD COLUMN IF NOT EXISTS coinbase_attested BOOLEAN;
ALTER TABLE users ADD COLUMN IF NOT EXISTS coinbase_attested_checked_at TIMESTAMP;

-- Lets the operator report find verified users without a sequential scan.
CREATE INDEX IF NOT EXISTS users_coinbase_attested_idx
  ON users (coinbase_attested)
  WHERE coinbase_attested IS TRUE;
