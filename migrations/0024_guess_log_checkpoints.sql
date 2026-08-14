-- 0024: Merkle checkpoints over the guess log
--
-- Mirrors what has been committed to the GuessLog contract so inclusion proofs
-- can be rebuilt without replaying chain history.
--
-- from_guess_id / to_guess_id pin the exact rows a checkpoint covered. Proofs
-- are regenerated from that range rather than from whatever `guesses` holds at
-- the time of asking, so a later insert cannot silently change a historical
-- proof — which is the entire point of committing the log in the first place.
--
-- Purely additive: no existing table is altered, so this is safe to apply
-- before the code that writes to it ships.

CREATE TABLE IF NOT EXISTS guess_log_checkpoints (
  id             SERIAL PRIMARY KEY,
  round_id       INTEGER NOT NULL REFERENCES rounds(id),
  checkpoint_id  INTEGER NOT NULL,           -- index within the round; matches onchain
  from_index     INTEGER NOT NULL,           -- inclusive, 1-based guess_index_in_round
  to_index       INTEGER NOT NULL,           -- inclusive
  from_guess_id  INTEGER NOT NULL,
  to_guess_id    INTEGER NOT NULL,
  root           VARCHAR(66) NOT NULL,
  tx_hash        VARCHAR(66),
  posted_at      TIMESTAMP,
  created_at     TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT guess_log_checkpoints_round_checkpoint_unique UNIQUE (round_id, checkpoint_id)
);

CREATE INDEX IF NOT EXISTS guess_log_checkpoints_round_idx
  ON guess_log_checkpoints (round_id);
