-- 0026: Superguess purchases move to ETH, and one payment grants one session
--
-- Two changes, both additive.
--
-- CURRENCY. Superguess was priced in $WORD. Players earn $WORD by playing —
-- jackpot, bonus words, top ten — and now spend ETH to buy, matching guess
-- packs. A first-time player is far likelier to hold ETH than the reward
-- token, and pricing purchases in $WORD pushed holders to sell it in order to
-- play, which works against staking.
--
-- PAYMENT IDENTITY. There was no record of WHICH payment bought a session.
-- Verification scanned the receipt for any $WORD transfer to the operator of
-- roughly the right size, so a historical transfer read off Base — public
-- data — could be replayed for a free session, and the endpoint then spent
-- real operator funds burning $WORD against a payment that never happened.
-- Recording (tx_hash, log_index) uniquely means one payment grants exactly one
-- session, including inside a bundled ERC-4337 transaction.
--
-- word_amount_paid becomes nullable: an ETH purchase has no $WORD amount, and
-- forcing a '0' there would be indistinguishable from a real zero-value legacy
-- row.

ALTER TABLE superguess_sessions ADD COLUMN IF NOT EXISTS currency VARCHAR(8) NOT NULL DEFAULT 'word';
ALTER TABLE superguess_sessions ADD COLUMN IF NOT EXISTS eth_amount_paid VARCHAR(78);
ALTER TABLE superguess_sessions ADD COLUMN IF NOT EXISTS tx_hash VARCHAR(66);
ALTER TABLE superguess_sessions ADD COLUMN IF NOT EXISTS log_index INTEGER;

ALTER TABLE superguess_sessions ALTER COLUMN word_amount_paid DROP NOT NULL;

ALTER TABLE superguess_sessions
  ADD CONSTRAINT superguess_sessions_payment_unique UNIQUE (tx_hash, log_index);
