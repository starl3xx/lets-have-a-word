-- Airdrop Manager: CLANKTON to $WORD Migration
-- Tracks snapshot balances, current $WORD balances, and distribution audit trail
--
-- Run this migration against your database:
-- psql $DATABASE_URL < drizzle/0006_airdrop_manager.sql

-- =============================================================================
-- Airdrop Wallets Table
-- =============================================================================
-- Imported CLANKTON holder data + cached $WORD balance lookups
CREATE TABLE IF NOT EXISTS airdrop_wallets (
  id SERIAL PRIMARY KEY,
  wallet_address VARCHAR(42) NOT NULL UNIQUE,
  snapshot_token VARCHAR(20) NOT NULL DEFAULT 'CLANKTON',
  snapshot_balance NUMERIC(30, 0) NOT NULL,
  snapshot_date VARCHAR(20),
  current_word_balance NUMERIC(30, 2),
  airdrop_needed NUMERIC(30, 2),
  balance_last_checked_at TIMESTAMP,
  balance_check_error VARCHAR(500),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS airdrop_wallets_wallet_idx ON airdrop_wallets(wallet_address);

-- =============================================================================
-- Airdrop Distributions Table
-- =============================================================================
-- Audit trail for "mark as sent" actions
CREATE TABLE IF NOT EXISTS airdrop_distributions (
  id SERIAL PRIMARY KEY,
  airdrop_wallet_id INTEGER NOT NULL REFERENCES airdrop_wallets(id),
  amount_sent NUMERIC(30, 2) NOT NULL,
  marked_by_fid INTEGER NOT NULL,
  tx_hash VARCHAR(66),
  note VARCHAR(500),
  sent_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS airdrop_distributions_wallet_idx ON airdrop_distributions(airdrop_wallet_id);

-- =============================================================================
-- Verification
-- =============================================================================
DO $$
BEGIN
  RAISE NOTICE 'Airdrop manager migration complete:';
  RAISE NOTICE '  - airdrop_wallets table created';
  RAISE NOTICE '  - airdrop_distributions table created';
END $$;
