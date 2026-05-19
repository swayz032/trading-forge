-- FIX 2 (B1 MED-HIGH): Add previous_unrealized_pnl column to paper_positions.
--
-- Purpose: enables a race-safe delta-only SQL-atomic equity update in
-- updatePositionPrices().  Previously the function did a full table-scan
-- recompute of currentEquity and wrote it back, racing with the atomic
-- `currentEquity + netPnl` UPDATE in closePosition().  A concurrent close
-- could clobber the atomic value with a stale full-recompute.
--
-- With this column: updatePositionPrices() applies
--   currentEquity = currentEquity + (newUnrealized - prevUnrealized)
-- and then writes the new unrealizedPnl value as prevUnrealized — both atomic.
-- No full scan needed; no race with closePosition().

ALTER TABLE paper_positions
  ADD COLUMN IF NOT EXISTS previous_unrealized_pnl NUMERIC DEFAULT 0;
