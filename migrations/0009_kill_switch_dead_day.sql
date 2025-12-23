-- Milestone 9.5: Kill Switch and Dead Day operational controls
-- Migration: Add round cancellation, pack purchases, and refunds tables

-- Add cancellation fields to rounds table
ALTER TABLE rounds
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active' NOT NULL,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS cancelled_reason TEXT,
  ADD COLUMN IF NOT EXISTS cancelled_by INTEGER,
  ADD COLUMN IF NOT EXISTS refunds_started_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS refunds_completed_at TIMESTAMP;

-- Add index for status lookups
CREATE INDEX IF NOT EXISTS rounds_status_idx ON rounds (status);

-- Create pack_purchases table for refund tracking
-- Each pack purchase is recorded here for audit and refund purposes
CREATE TABLE IF NOT EXISTS pack_purchases (
  id SERIAL PRIMARY KEY,
  round_id INTEGER NOT NULL REFERENCES rounds(id),
  fid INTEGER NOT NULL,
  pack_count INTEGER NOT NULL DEFAULT 1,
  total_price_eth DECIMAL(20, 18) NOT NULL,
  total_price_wei VARCHAR(78) NOT NULL, -- Store as string to preserve precision
  pricing_phase VARCHAR(20) NOT NULL, -- 'BASE', 'LATE_1', 'LATE_2'
  total_guesses_at_purchase INTEGER NOT NULL, -- Round guess count when purchased
  created_at TIMESTAMP DEFAULT NOW() NOT NULL,

  -- Unique constraint to prevent duplicate records
  CONSTRAINT pack_purchases_unique_idx UNIQUE (round_id, fid, created_at)
);

-- Indexes for pack_purchases
CREATE INDEX IF NOT EXISTS pack_purchases_round_idx ON pack_purchases (round_id);
CREATE INDEX IF NOT EXISTS pack_purchases_fid_idx ON pack_purchases (fid);
CREATE INDEX IF NOT EXISTS pack_purchases_created_at_idx ON pack_purchases (created_at);

-- Create refunds table for tracking refund status
CREATE TABLE IF NOT EXISTS refunds (
  id SERIAL PRIMARY KEY,
  round_id INTEGER NOT NULL REFERENCES rounds(id),
  fid INTEGER NOT NULL,
  amount_eth DECIMAL(20, 18) NOT NULL,
  amount_wei VARCHAR(78) NOT NULL, -- Store as string to preserve precision
  status VARCHAR(20) DEFAULT 'pending' NOT NULL, -- 'pending', 'processing', 'sent', 'failed'
  purchase_ids INTEGER[] NOT NULL, -- Array of pack_purchase.id being refunded

  -- Transaction tracking
  refund_tx_hash VARCHAR(66), -- Ethereum transaction hash
  sent_at TIMESTAMP,
  error_message TEXT,
  retry_count INTEGER DEFAULT 0 NOT NULL,

  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW() NOT NULL,

  -- One refund per user per round
  CONSTRAINT refunds_round_fid_unique UNIQUE (round_id, fid)
);

-- Indexes for refunds
CREATE INDEX IF NOT EXISTS refunds_round_idx ON refunds (round_id);
CREATE INDEX IF NOT EXISTS refunds_fid_idx ON refunds (fid);
CREATE INDEX IF NOT EXISTS refunds_status_idx ON refunds (status);

-- Create operational_events table for audit logging
CREATE TABLE IF NOT EXISTS operational_events (
  id SERIAL PRIMARY KEY,
  event_type VARCHAR(50) NOT NULL, -- 'kill_switch_enabled', 'kill_switch_disabled', 'dead_day_enabled', etc.
  round_id INTEGER REFERENCES rounds(id),
  triggered_by INTEGER NOT NULL, -- Admin FID
  reason TEXT,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- Index for operational events
CREATE INDEX IF NOT EXISTS operational_events_type_idx ON operational_events (event_type);
CREATE INDEX IF NOT EXISTS operational_events_created_at_idx ON operational_events (created_at);

-- Add comment explaining the status field
COMMENT ON COLUMN rounds.status IS 'Round status: active (in progress), resolved (completed normally), cancelled (killed via kill switch)';
