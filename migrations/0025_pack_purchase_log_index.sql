-- 0025: key a pack purchase on the event, not the transaction
--
-- tx_hash stopped being a unique key the moment gas sponsorship became
-- possible. An ERC-4337 bundler batches user operations from different
-- accounts into ONE transaction, so two players who buy at the same moment
-- share a transaction hash and have one PacksPurchased event each. Under the
-- old UNIQUE(tx_hash) the first submission was credited and the second was
-- rejected as a duplicate — after that player had already paid.
--
-- RUN THIS BEFORE the code that writes log_index. It is additive and the old
-- constraint is replaced by two that together preserve every guarantee it had.

ALTER TABLE pack_purchases ADD COLUMN IF NOT EXISTS log_index INTEGER;

-- The old constraint. Named differently depending on how it was created, so
-- both spellings are dropped and neither is required to exist.
ALTER TABLE pack_purchases DROP CONSTRAINT IF EXISTS pack_purchases_tx_hash_unique;
ALTER TABLE pack_purchases DROP CONSTRAINT IF EXISTS pack_purchases_tx_hash_key;

-- One credit per event.
ALTER TABLE pack_purchases
  ADD CONSTRAINT pack_purchases_tx_hash_log_index_unique UNIQUE (tx_hash, log_index);

-- Every existing row has a NULL log_index, and Postgres treats NULLs as
-- distinct, so the constraint above alone would let an old transaction be
-- claimed a second time with a real index attached. This keeps the original
-- one-credit-per-transaction rule for those rows. The endpoint also refuses
-- outright when it finds a NULL-index row for the hash, so this is the second
-- of two independent guards rather than the only one.
CREATE UNIQUE INDEX IF NOT EXISTS pack_purchases_legacy_tx_hash_unique
  ON pack_purchases (tx_hash)
  WHERE log_index IS NULL;
