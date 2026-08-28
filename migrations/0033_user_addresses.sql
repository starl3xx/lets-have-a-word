-- Addresses a player has PROVEN they control, beyond the one Neynar knows.
--
-- THE PROBLEM. A returning Farcaster player who opens the game in Base App
-- silently becomes a brand-new account. upsertUserFromWallet links a SIWE
-- address to an existing player only when it equals users.signer_wallet_address,
-- which holds Neynar's verified EOA — and a Base Account is a different,
-- smart-contract wallet. purchase-guess-pack.ts already documents that the two
-- differ. So the veteran loses reward-gate grandfathering (keyed on
-- first_guess_round), their Early Adopter Wordmark (same column), their XP,
-- streak, stats and referral history, and is shown the "you must hold $WORD"
-- onboarding instead of "you're in free".
--
-- It cuts the other way too: the reward gate's one-wallet-one-fid-per-day claim
-- keys on the address, so one human with an EOA and a Base Account draws two
-- full daily allocations.
--
-- ONE ROW PER ADDRESS, ACROSS ALL PLAYERS. The unique index is on the address
-- alone, not on (fid, address): an address may vouch for exactly one player, or
-- linking would become a way to attach one wallet to several accounts and
-- multiply the daily allocation it was meant to bound.
--
-- users.signer_wallet_address is left alone. It is the PAYOUT address and a
-- Neynar snapshot; this table answers a different question ("who else is this
-- person?") and must not quietly redirect anybody's winnings.

CREATE TABLE IF NOT EXISTS user_addresses (
  id serial PRIMARY KEY,
  fid integer NOT NULL,
  address varchar(42) NOT NULL,
  -- How the claim was proven. 'link_code' is the two-session handshake:
  -- a Quick Auth session issues the code, a SIWE session redeems it.
  linked_via varchar(16) NOT NULL DEFAULT 'link_code',
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS user_addresses_address_unique
  ON user_addresses (lower(address));

CREATE INDEX IF NOT EXISTS user_addresses_fid_idx ON user_addresses (fid);
