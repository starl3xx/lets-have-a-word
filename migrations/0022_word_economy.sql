-- Migration: $WORD-denominated economy (parallel columns)
-- Date: 2026-08-13
-- Description: Adds $WORD amount columns alongside the existing ETH ones so
--              rounds 1-33 keep rendering in ETH while round 34+ runs in
--              $WORD. Additive only — no drops, no rewrites, no backfill.
--
-- Apply this BEFORE the code deploys (lesson from PR #139's Round 29 outage).
--
-- WHY PARALLEL COLUMNS RATHER THAN REUSING THE ETH ONES
-- The ETH columns are numeric(20,18): twenty digits with eighteen after the
-- decimal point, so the largest value they can hold is 99.999999999999999999.
-- A $WORD seed is ~78,125,000 tokens (26 digits in wei). Writing one into
-- those columns throws `numeric field overflow` — reuse is not a trade-off,
-- it is impossible.
--
-- TYPE CHOICE
-- Token amounts use numeric(78,0), which is arbitrary-precision, sums natively
-- in the analytics queries, and orders correctly. The pre-existing $WORD
-- columns elsewhere (word_rewards.amount, superguess_sessions.word_amount_paid,
-- round_payouts.amount_word) are varchar(78), where '9' sorts above '10' and
-- SUM() needs a cast. New columns do not propagate that; the existing ones are
-- left alone rather than type-migrated under live data.

-- ---------------------------------------------------------------------------
-- rounds
-- ---------------------------------------------------------------------------
ALTER TABLE rounds
  ADD COLUMN IF NOT EXISTS prize_currency varchar(8) NOT NULL DEFAULT 'eth',
  ADD COLUMN IF NOT EXISTS prize_pool_word numeric(78,0) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS seed_next_round_word numeric(78,0) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS seed_usd_cents integer,
  ADD COLUMN IF NOT EXISTS seed_price_e18 numeric(78,0),
  ADD COLUMN IF NOT EXISTS jackpot_contract_address varchar(42);

COMMENT ON COLUMN rounds.prize_currency IS 'eth for rounds 1-33, word for 34+. Drives which columns the UI reads.';
COMMENT ON COLUMN rounds.seed_usd_cents IS 'USD target the seed was priced at, e.g. 2000 for $20.';
COMMENT ON COLUMN rounds.seed_price_e18 IS 'USD-per-$WORD (1e18-scaled) used at seed time. Snapshot: never re-price history.';

-- ---------------------------------------------------------------------------
-- round_payouts
--
-- amount_word is declared in schema.ts but NO migration ever created it, and
-- no code reads or writes it. archive.ts:260 and :994 do full-row select()s on
-- this table, which fail outright if the column is absent in a given
-- environment. IF NOT EXISTS closes that drift either way.
-- ---------------------------------------------------------------------------
ALTER TABLE round_payouts
  ADD COLUMN IF NOT EXISTS amount_word varchar(78),
  ADD COLUMN IF NOT EXISTS currency varchar(8) NOT NULL DEFAULT 'eth';

-- A $WORD payout has no ETH amount to record.
ALTER TABLE round_payouts ALTER COLUMN amount_eth DROP NOT NULL;

-- ---------------------------------------------------------------------------
-- round_archive
-- ---------------------------------------------------------------------------
ALTER TABLE round_archive
  ADD COLUMN IF NOT EXISTS currency varchar(8) NOT NULL DEFAULT 'eth',
  ADD COLUMN IF NOT EXISTS seed_word numeric(78,0),
  ADD COLUMN IF NOT EXISTS final_jackpot_word numeric(78,0),
  ADD COLUMN IF NOT EXISTS seed_usd_cents integer,
  ADD COLUMN IF NOT EXISTS final_jackpot_usd_cents integer;

ALTER TABLE round_archive ALTER COLUMN seed_eth DROP NOT NULL;
ALTER TABLE round_archive ALTER COLUMN final_jackpot_eth DROP NOT NULL;

COMMENT ON COLUMN round_archive.final_jackpot_usd_cents IS 'USD value at resolution time. Snapshot so a later price move never rewrites what a past round was worth.';

-- ---------------------------------------------------------------------------
-- pack_purchases
--
-- Purchases stay ETH-denominated, so the existing price columns are unchanged
-- and refunds need no migration at all. word_credited records how much $WORD
-- the pool was credited for this purchase.
-- ---------------------------------------------------------------------------
ALTER TABLE pack_purchases
  ADD COLUMN IF NOT EXISTS word_credited numeric(78,0),
  ADD COLUMN IF NOT EXISTS sales_contract_address varchar(42);

-- ---------------------------------------------------------------------------
-- system_state / admin_wallet_actions
-- ---------------------------------------------------------------------------
ALTER TABLE system_state
  ADD COLUMN IF NOT EXISTS creator_balance_word numeric(78,0) NOT NULL DEFAULT 0;

ALTER TABLE admin_wallet_actions
  ADD COLUMN IF NOT EXISTS currency varchar(8) NOT NULL DEFAULT 'eth',
  ADD COLUMN IF NOT EXISTS amount_word numeric(78,0);

-- ---------------------------------------------------------------------------
-- word_conversions
--
-- The treasury's ETH -> $WORD batch conversion is the operation the whole
-- model depends on and is currently untracked. Without a record there is no
-- way to reconcile "player ETH taken" against "$WORD credited to the pool",
-- which is the invariant that tells you whether the tranche is draining faster
-- than revenue replaces it.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS word_conversions (
  id serial PRIMARY KEY,
  eth_amount_wei numeric(78,0) NOT NULL,
  word_amount_wei numeric(78,0) NOT NULL,
  eth_usd_price numeric(20,8),
  word_usd_price_e18 numeric(78,0),
  swap_tx_hash varchar(66),
  fund_tx_hash varchar(66),
  initiated_by_fid integer NOT NULL,
  note varchar(500),
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS word_conversions_created_at_idx ON word_conversions (created_at);

-- ---------------------------------------------------------------------------
-- Indexes for the new discriminators
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS rounds_prize_currency_idx ON rounds (prize_currency);
CREATE INDEX IF NOT EXISTS round_archive_currency_idx ON round_archive (currency);
