-- 0034: seen-flag for the one-time Lexigotchi beta-tester popup.
--
-- The popup asks players to DM starl3xx to test Lexigotchi. It is shown once
-- per PLAYER, not once per device, so the flag lives here rather than in
-- localStorage: Farcaster players open the game on both phone and web.
-- Same pattern as the other has_seen_* flags.
--
-- APPLY BEFORE DEPLOYING. schema.ts names this column, so every full-row read
-- of `users` selects it; code deployed ahead of the column breaks those reads.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS has_seen_lexigotchi_beta boolean NOT NULL DEFAULT false;
