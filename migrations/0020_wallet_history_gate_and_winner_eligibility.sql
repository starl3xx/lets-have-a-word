-- Migration: Wallet-history gate + winner-eligibility tracking
-- Date: 2026-04-28
-- Description: Adds wallet-tx-count caching for the wallet-history gate
--              (defense against the Round 28/29 .base.eth bot farm whose
--              wallets all sat at 8–12 outgoing txs and ~$0.01 ETH), plus
--              an `is_ineligible_winner` audit flag on guesses for the
--              winner-eligibility-at-win-time check.
--
-- Apply this BEFORE the code deploys. Schema changes that ship in code
-- without the matching migration cause "column does not exist" on every
-- full-row read of users/guesses (this happened on PR #139 / Round 29).

ALTER TABLE users
ADD COLUMN wallet_tx_count integer,
ADD COLUMN wallet_tx_count_checked_at timestamp;

CREATE INDEX users_wallet_tx_count_idx ON users (wallet_tx_count);

COMMENT ON COLUMN users.wallet_tx_count IS 'Outgoing tx count for signer_wallet_address on Base, fetched via eth_getTransactionCount';
COMMENT ON COLUMN users.wallet_tx_count_checked_at IS 'Last RPC check time; null = never checked';

ALTER TABLE guesses
ADD COLUMN is_ineligible_winner boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN guesses.is_ineligible_winner IS 'Correct guess that failed winner-eligibility (post-Round-29 anti-bot). Audit flag only — does not lock the round, word is not exposed via wheel.';
