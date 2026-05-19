-- Wave 6 Fix 1 — lifecycle_transitions.correlation_id
-- Closes §2 90-day reconstruction promise at lifecycle boundary.
-- Wave 5 audit confirmed the column was missing from this table.
--
-- Every lifecycle_transitions row now carries the same correlation_id
-- that the parallel audit_log row writes, enabling full 90-day trace
-- reconstruction with a single correlation_id index scan across both tables.
--
-- Idempotent: IF NOT EXISTS guards on both the column and indexes.

ALTER TABLE lifecycle_transitions
  ADD COLUMN IF NOT EXISTS correlation_id TEXT NULL;

-- Primary lookup: "show me all lifecycle events for this correlation context"
CREATE INDEX IF NOT EXISTS idx_lifecycle_transitions_correlation_id
  ON lifecycle_transitions (correlation_id)
  WHERE correlation_id IS NOT NULL;

-- Composite for audit_log join queries: strategy audit events by correlation window
CREATE INDEX IF NOT EXISTS idx_lifecycle_transitions_correlation_strategy
  ON lifecycle_transitions (correlation_id, strategy_id)
  WHERE correlation_id IS NOT NULL;
