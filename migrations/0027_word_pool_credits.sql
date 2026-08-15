-- 0027: $WORD credited to a round's prize pool from player purchases.
--
-- Guess packs and Superguesses are paid in ETH, which goes to the treasury, so
-- nothing reaches a $WORD prize pool on its own. 80% of each purchase is
-- credited here in $WORD at the price in force when it was bought; the other
-- 20% is creator revenue. Same split the ETH economy ran inside
-- JackpotManagerV3 — what is new is that the pool side needs an explicit
-- conversion, because the money arrives in one asset and the prize is paid in
-- another.
--
-- Credits accumulate in this table and reach WordJackpot in a single batched
-- top-up before the round resolves, so no player waits on a transaction to buy
-- a pack. That makes "has this credit reached the contract" a real question:
-- resolveRound validates its payout sum against the contract's currentPool, so
-- an unflushed credit means resolution reverts with a winner already found.
-- flushed_at is what lets that be checked beforehand instead of discovered
-- during payout.
--
-- Each row records the price it was struck at. A credit is a conversion at a
-- moment in time, and without the rate there is no way to audit whether the
-- treasury's later ETH->$WORD buyback kept pace with what was paid out.

CREATE TABLE IF NOT EXISTS word_pool_credits (
  id             serial PRIMARY KEY,
  round_id       integer NOT NULL REFERENCES rounds(id),
  source         varchar(16) NOT NULL,   -- 'pack' | 'superguess'
  source_ref     varchar(128) NOT NULL,  -- `${txHash}:${logIndex}`
  eth_amount_wei numeric(78, 0) NOT NULL,
  word_amount_wei numeric(78, 0) NOT NULL,
  price_e18      numeric(78, 0) NOT NULL,
  price_source   varchar(16) NOT NULL,   -- 'contract' | 'round_seed'
  eth_usd_price  numeric(20, 8),
  created_at     timestamp NOT NULL DEFAULT now(),
  flushed_at     timestamp,
  flush_tx_hash  varchar(66)
);

-- One credit per payment. A retried webhook or a double-submitted purchase is
-- indistinguishable from a real one at every other layer, so idempotency has to
-- live in the database.
CREATE UNIQUE INDEX IF NOT EXISTS word_pool_credits_source_unique
  ON word_pool_credits (source, source_ref);

CREATE INDEX IF NOT EXISTS word_pool_credits_round_idx
  ON word_pool_credits (round_id);

-- Drives the unflushed-total check on the resolve path.
CREATE INDEX IF NOT EXISTS word_pool_credits_unflushed_idx
  ON word_pool_credits (round_id, flushed_at);
