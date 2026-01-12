-- Migration: Add start_tx_hash column for tracking the start round commitment transaction
-- This allows the archive to link directly to the transaction that committed the answer hash

ALTER TABLE rounds
ADD COLUMN start_tx_hash VARCHAR(66);

COMMENT ON COLUMN rounds.start_tx_hash IS 'Transaction hash from startRoundWithCommitment call';
