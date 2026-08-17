-- Reward gate entry floor (2026-08-17)
--
-- The token bar a player first passed the gate at, ratcheted down whenever
-- they later pass a cheaper bar. Eligibility checks pass at
-- min(current bar, this floor): a price crash — which raises the token bar —
-- can never lock out a paid-up holder while they keep their tokens. Selling
-- below the floor forfeits it.
--
-- Additive and nullable: safe to apply before the code deploys.

ALTER TABLE users ADD COLUMN reward_gate_bar_tokens bigint;
ALTER TABLE users ADD COLUMN reward_gate_qualified_at timestamp;
