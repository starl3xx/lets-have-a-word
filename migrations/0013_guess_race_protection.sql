-- Migration: Add race condition protections for guesses
-- Prevents same user from guessing same word twice in same round

-- Add unique constraint on (round_id, fid, word)
-- This is a database-level safety net - application already prevents this,
-- but this ensures data integrity even if there's a bug or race condition
ALTER TABLE guesses
ADD CONSTRAINT guesses_round_fid_word_unique
UNIQUE (round_id, fid, word);
