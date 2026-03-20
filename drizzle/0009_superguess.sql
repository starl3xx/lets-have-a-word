-- Milestone 15: Superguess Sessions
-- High-stakes late-game mechanic: exclusive 25-guess, 10-minute window

CREATE TABLE IF NOT EXISTS superguess_sessions (
  id SERIAL PRIMARY KEY,
  round_id INTEGER NOT NULL REFERENCES rounds(id),
  fid INTEGER NOT NULL,
  tier VARCHAR(20) NOT NULL,                          -- 'tier_1' | 'tier_2' | 'tier_3' | 'tier_4'
  word_amount_paid VARCHAR(78) NOT NULL,              -- $WORD amount in wei
  usd_equivalent DECIMAL(10, 2) NOT NULL,             -- USD value at time of purchase
  burned_amount VARCHAR(78) NOT NULL,                 -- 50% burned
  staking_amount VARCHAR(78) NOT NULL,                -- 50% to staking rewards
  burn_tx_hash VARCHAR(66),
  staking_tx_hash VARCHAR(66),
  status VARCHAR(20) NOT NULL DEFAULT 'active',       -- 'active' | 'won' | 'exhausted' | 'expired' | 'cancelled'
  guesses_used INTEGER NOT NULL DEFAULT 0,
  guesses_allowed INTEGER NOT NULL DEFAULT 25,
  started_at TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP NOT NULL,
  completed_at TIMESTAMP,
  cooldown_ends_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Partial unique index: only one active session per round at a time
CREATE UNIQUE INDEX superguess_sessions_round_active_unique
  ON superguess_sessions (round_id)
  WHERE status = 'active';

-- Lookup indexes
CREATE INDEX superguess_sessions_round_idx ON superguess_sessions (round_id);
CREATE INDEX superguess_sessions_fid_idx ON superguess_sessions (fid);
CREATE INDEX superguess_sessions_status_idx ON superguess_sessions (status);
