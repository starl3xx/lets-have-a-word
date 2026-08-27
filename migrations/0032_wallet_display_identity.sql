-- Display identity for wallet-native players.
--
-- A Base App player has no Farcaster account, so Neynar knows nothing about
-- them and every name surface fell back to "fid:1000000001" with a generated
-- placeholder avatar — in the stats panel, and in the permanent public archive.
-- Their real identity is their basename (starl3xx.base.eth), resolvable onchain
-- on Base from the address SIWE already proved they control.
--
-- SEPARATE COLUMNS RATHER THAN REUSING users.username, deliberately. Two live
-- consumers read that column as a FARCASTER handle: announcer.ts prefixes it
-- with "@" unconditionally, and tweet-mentions.ts matches lower(username)
-- against Farcaster handles with no unique constraint. A basename landing there
-- becomes a broken mention on Farcaster and, worse, an @mention of a stranger
-- on X — the exact class of bug walletlink.ts was written to stop.
--
-- Nullable on purpose: a wallet with no basename is normal and must render as a
-- truncated address, not as a blank or an invented name.

ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name varchar(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url varchar(500);

-- NULL means "never looked", which is the retry signal and is deliberately
-- distinct from "looked and found nothing" (checked_at set, display_name null).
-- Same convention as x_checked_at and wallet_first_tx_checked_at.
ALTER TABLE users ADD COLUMN IF NOT EXISTS display_checked_at timestamp;
