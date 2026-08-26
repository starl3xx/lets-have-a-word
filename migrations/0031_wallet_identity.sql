-- 0031: wallet-native player identity (Base App).
--
-- Base App stopped hosting Farcaster mini apps on 2026-04-09, so a player
-- there has a wallet and no FID. Rather than making users.fid nullable — which
-- would break the 24 tables that join on it and the 85 endpoints that read it —
-- wallet players get a SYNTHETIC fid drawn from the sequence below, above the
-- real Farcaster FID space. Every existing query keeps working untouched.
--
-- 1_000_000_000 is chosen against two ceilings: real FIDs are around 1-2M and
-- growing slowly, and users.fid is a Postgres `integer`, which caps at
-- 2,147,483,647. That leaves ~1.1B synthetic ids and no collision risk.
-- It is also POSITIVE on purpose: eleven endpoints validate `fid <= 0`, so a
-- negative-id scheme would have been rejected at the door by input validation.

CREATE SEQUENCE IF NOT EXISTS wallet_player_fid_seq
  AS integer
  START WITH 1000000000
  MINVALUE 1000000000
  MAXVALUE 2147483647
  NO CYCLE;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS identity_origin varchar(16) NOT NULL DEFAULT 'farcaster';

-- PARTIAL index, deliberately.
--
-- A blanket UNIQUE on signer_wallet_address would be wrong twice over. It could
-- fail outright on existing data — that column is a snapshot of Neynar's
-- verified_addresses and nothing has ever guaranteed two FIDs do not hold the
-- same string — and it would be a claim we do not need to make. Only
-- wallet-origin rows use the address AS their identity, so only they need it to
-- be unique. lower() because addresses arrive both checksummed and lowercased,
-- and one wallet must never become two players.
CREATE UNIQUE INDEX IF NOT EXISTS users_wallet_identity_unique
  ON users (lower(signer_wallet_address))
  WHERE identity_origin = 'wallet';

COMMENT ON COLUMN users.identity_origin IS
  'farcaster = Quick Auth / SIWF sign-in (every pre-Base-App row); wallet = SIWE sign-in with a synthetic fid >= 1000000000';

-- Run this BEFORE the index if you want to see what it would have caught.
-- It should return zero rows; if it does not, those FIDs share a wallet and the
-- account-linking path in upsertUserFromWallet will pick the earliest of them.
--
--   SELECT lower(signer_wallet_address) AS wallet, count(*), array_agg(fid ORDER BY fid)
--   FROM users
--   WHERE signer_wallet_address IS NOT NULL
--   GROUP BY 1 HAVING count(*) > 1;
