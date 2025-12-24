-- Migration: 0012_admin_wallet_actions.sql
-- Admin Wallet Actions audit trail table

CREATE TABLE IF NOT EXISTS admin_wallet_actions (
  id SERIAL PRIMARY KEY,
  action_type VARCHAR(50) NOT NULL,
  amount_eth VARCHAR(50) NOT NULL,
  amount_wei VARCHAR(78) NOT NULL,
  from_address VARCHAR(42) NOT NULL,
  to_address VARCHAR(42) NOT NULL,
  tx_hash VARCHAR(66),
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  initiated_by_fid INTEGER NOT NULL,
  initiated_by_address VARCHAR(42) NOT NULL,
  note VARCHAR(500),
  metadata JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  confirmed_at TIMESTAMP
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS admin_wallet_actions_type_idx ON admin_wallet_actions(action_type);
CREATE INDEX IF NOT EXISTS admin_wallet_actions_created_at_idx ON admin_wallet_actions(created_at);
CREATE INDEX IF NOT EXISTS admin_wallet_actions_initiated_by_idx ON admin_wallet_actions(initiated_by_fid);
