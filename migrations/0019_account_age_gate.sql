-- Migration: Add FID registration date tracking for account-age gate
-- Date: 2026-04-21
-- Description: Caches Farcaster FID registration timestamp (from Hub onChainEvents REGISTER event)
--              so gameplay can be gated on minimum account age. Immutable once set — registration
--              date never changes. `checked_at` lets the gate retry transient Hub failures without
--              re-querying for every request.

ALTER TABLE users
ADD COLUMN fid_registered_at timestamp,
ADD COLUMN fid_registered_at_checked_at timestamp;

CREATE INDEX users_fid_registered_at_idx ON users (fid_registered_at);

COMMENT ON COLUMN users.fid_registered_at IS 'Farcaster FID registration timestamp from Hub onChainEvents (immutable once set)';
COMMENT ON COLUMN users.fid_registered_at_checked_at IS 'Last attempt to resolve fid_registered_at — null means never tried';
