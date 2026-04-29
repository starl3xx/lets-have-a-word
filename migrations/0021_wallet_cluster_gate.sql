-- Migration: Wallet-cluster gate (post-Round-29 sybil defense, third layer)
-- Date: 2026-04-29
-- Description: Caches a wallet's earliest Base tx timestamp and the size of
--              its "co-mint cluster" — the count of LHAW users whose wallet
--              first-tx falls within ±1h of this one. The Round 28/29 farm
--              deployed 22 wallets in a single 3-hour window on 2026-03-15;
--              22 vs the legit cohort's max-of-2 is an order-of-magnitude
--              gap. .base.eth + cluster_size >= 5 + low score uniquely
--              matches the bot fingerprint.
--
-- Apply this BEFORE the code deploys (lesson from PR #139's Round 29 outage).

ALTER TABLE users
ADD COLUMN wallet_first_tx_at timestamp,
ADD COLUMN wallet_first_tx_checked_at timestamp,
ADD COLUMN wallet_cluster_size integer;

CREATE INDEX users_wallet_first_tx_at_idx ON users (wallet_first_tx_at);
CREATE INDEX users_wallet_cluster_size_idx ON users (wallet_cluster_size);

COMMENT ON COLUMN users.wallet_first_tx_at IS 'Earliest Base tx timestamp for signer_wallet_address (from Blockscout). Immutable once resolved.';
COMMENT ON COLUMN users.wallet_first_tx_checked_at IS 'Last attempt to resolve wallet_first_tx_at — null means never tried.';
COMMENT ON COLUMN users.wallet_cluster_size IS 'Count of LHAW users with wallet_first_tx_at within ±1h. >=5 indicates a coordinated mint batch (bot signature).';
