-- Add wallet_address to round_payouts for audit trail
-- This records the exact wallet address that received each payout
-- Helps debug issues where user's wallet may have changed after payout

ALTER TABLE round_payouts
ADD COLUMN IF NOT EXISTS wallet_address VARCHAR(66);

-- Add comment for documentation
COMMENT ON COLUMN round_payouts.wallet_address IS 'Resolved wallet address at time of payout (for audit trail)';
