-- 0174_paper_sessions_proven_trades.sql
-- Balanced scaling plan: proven_trades_count is a monotonic cumulative count of
-- closed WINNING trades (net realized P&L > 0) per paper session.
-- Used by computeRiskDerivedContracts() (consumer side) to gate the proven-trades ramp.
-- Invariant: counter only ever increments, never decreases (enforced in service layer).
-- Idempotent: ADD COLUMN IF NOT EXISTS is safe to run multiple times.
ALTER TABLE paper_sessions
  ADD COLUMN IF NOT EXISTS proven_trades_count INTEGER NOT NULL DEFAULT 0;
