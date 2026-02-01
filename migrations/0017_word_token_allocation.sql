-- Migration: Add $WORD token allocation field
-- Date: 2026-01-31
-- Description: Add freeAllocatedWordToken field to daily_guess_state table for $WORD token holder bonuses

ALTER TABLE daily_guess_state 
ADD COLUMN free_allocated_word_token integer DEFAULT 0 NOT NULL;

-- Update existing rows to have 0 $WORD token allocation (default behavior)
-- This is already handled by the DEFAULT 0 NOT NULL constraint above

-- Add comment for documentation
COMMENT ON COLUMN daily_guess_state.free_allocated_word_token IS '$WORD token holder bonus guesses (0 or 1)';