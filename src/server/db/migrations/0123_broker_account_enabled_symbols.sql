-- migration 0123_broker_account_enabled_symbols
-- W23H.H: per-account symbol whitelist (default MES-only for Combine safety)
-- Operators must explicitly opt in to enable MNQ or MCL per broker account.
-- Default ['MES'] prevents accidental correlated-equity drawdown on a Combine.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS guard.

ALTER TABLE broker_accounts
  ADD COLUMN IF NOT EXISTS enabled_symbols TEXT[] NOT NULL DEFAULT ARRAY['MES'];
