-- Migration: Add CHECK constraint to prevent salt corruption
-- The salt field must be a 64-character hex string (32 bytes)

-- Add CHECK constraint to rounds.salt
ALTER TABLE rounds
ADD CONSTRAINT rounds_salt_valid_hex
CHECK (
  salt IS NOT NULL
  AND length(salt) = 64
  AND salt ~ '^[a-f0-9]+$'
);

-- Add CHECK constraint to round_archive.salt
ALTER TABLE round_archive
ADD CONSTRAINT round_archive_salt_valid_hex
CHECK (
  salt IS NOT NULL
  AND length(salt) = 64
  AND salt ~ '^[a-f0-9]+$'
);

-- Add CHECK constraint to round_bonus_words.salt (16 chars for individual salts)
ALTER TABLE round_bonus_words
ADD CONSTRAINT round_bonus_words_salt_valid_hex
CHECK (
  salt IS NOT NULL
  AND length(salt) = 32
  AND salt ~ '^[a-f0-9]+$'
);
