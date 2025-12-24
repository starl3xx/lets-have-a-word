-- Migration: Round Economics Config Snapshots
-- Milestone 9.6: Store per-round economics configuration for historical comparison

CREATE TABLE IF NOT EXISTS round_economics_config (
  id SERIAL PRIMARY KEY,
  round_id INTEGER NOT NULL REFERENCES rounds(id) UNIQUE,
  config JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS round_economics_config_round_idx ON round_economics_config(round_id);
