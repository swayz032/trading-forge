-- migration 0122_bias_state_position_lock
-- W23H.E: 10 AM regime-flip position lock column
-- Tracks when the 10 AM refresh changed the active strategy while a position on
-- the PRIOR strategy was open. While the lock is active, the prior strategy's
-- open position continues to run on its own exit rules, but NO new entries are
-- allowed for the new active strategy until the open position closes.
--
-- Safe default: FALSE — existing rows are unlocked (no position lock active).
-- Idempotent: ADD COLUMN IF NOT EXISTS guard.

ALTER TABLE bias_state
  ADD COLUMN IF NOT EXISTS position_lock_active BOOLEAN NOT NULL DEFAULT FALSE;
