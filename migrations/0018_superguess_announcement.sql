-- Migration: Add Superguess announcement tracking
-- Date: 2026-03-24
-- Description: Track whether users have seen the Superguess feature announcement modal

ALTER TABLE users
ADD COLUMN has_seen_superguess_announcement boolean DEFAULT false NOT NULL;

COMMENT ON COLUMN users.has_seen_superguess_announcement IS 'Whether user has seen the Milestone 15 Superguess announcement modal';
