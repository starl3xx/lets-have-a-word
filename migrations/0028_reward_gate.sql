-- 0028: the reward gate — hold or stake $3 of $WORD to play (round 34+).
--
-- Three farm waves are on record (rounds 28, 29, 33: ~2,950 / 913 / 1,591
-- fresh drive-by accounts, overwhelmingly .base.eth). The gate prices the
-- swarm out: playing requires a wallet holding the round's USD bar in $WORD
-- (staked counts), and every player whose first guess predates the first
-- botted round is grandfathered in free.
--
-- users.first_guess_round: the grandfather column. Backfilled once from
-- MIN(guesses.round_id) per fid via the admin backfill endpoint. NULL means
-- "no guess before the backfill ran", which is exactly "not grandfathered" —
-- new players never need the column written, so nothing maintains it.
--
-- reward_gate_claims: one wallet vouches for at most ONE fid per game-day.
-- Nothing else in the schema constrains wallet↔fid (users.fid is unique, the
-- wallet column is not), so without this a single funded wallet could clear
-- the bar for a thousand accounts. UNIQUE(date, wallet) is the actual
-- defense; the fid column records who claimed it, for audit.
--
-- reward_withheld on round_bonus_words / round_burn_words: a find by an
-- account that fails the gate at award time claims the word (it is dead to
-- dedup either way) but moves no money and burns nothing. The flag is the
-- audit trail, and read paths exclude withheld rows from finder displays.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS first_guess_round integer;

CREATE TABLE IF NOT EXISTS reward_gate_claims (
  id          serial PRIMARY KEY,
  date        date NOT NULL,
  wallet      varchar(42) NOT NULL,
  fid         integer NOT NULL,
  round_id    integer,
  created_at  timestamp NOT NULL DEFAULT now(),
  CONSTRAINT reward_gate_claims_date_wallet_unique UNIQUE (date, wallet)
);

CREATE INDEX IF NOT EXISTS reward_gate_claims_fid_date_idx
  ON reward_gate_claims (fid, date);

ALTER TABLE round_bonus_words
  ADD COLUMN IF NOT EXISTS reward_withheld boolean NOT NULL DEFAULT false;

ALTER TABLE round_burn_words
  ADD COLUMN IF NOT EXISTS reward_withheld boolean NOT NULL DEFAULT false;
