-- Puzzle Crumbs: persist shorter words (4–8 letters) found by players per round.
-- Crumbs are permanent per puzzle per user — once found, they stay forever.

CREATE TABLE IF NOT EXISTS puzzle_crumbs (
  id            SERIAL PRIMARY KEY,
  round_id      INTEGER NOT NULL REFERENCES rounds(id),
  fid           INTEGER NOT NULL,
  word          VARCHAR(10) NOT NULL,
  found_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One occurrence of each word per user per round
  CONSTRAINT puzzle_crumbs_round_fid_word_unique UNIQUE (round_id, fid, word)
);

-- Fast lookup: all crumbs for a user on a given round
CREATE INDEX IF NOT EXISTS puzzle_crumbs_round_fid_idx
  ON puzzle_crumbs (round_id, fid);
