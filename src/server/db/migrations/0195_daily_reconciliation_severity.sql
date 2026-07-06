-- ds21 (deep-scan #21 Bands A+D): persist the authoritative reconciliation severity.
-- Previously severity was computed at run time but only written to audit_log JSON, never to
-- the daily_reconciliation row; the dashboard read path (getDailyReconciliationStatus, feeding
-- the primary ProductionStatusPanel) recomputed severity from mismatch_count alone → green
-- whenever mismatch_count=0, discarding the degraded-mode/independent-source clamp and
-- resurrecting a false-green. Persisting severity lets the read path return the real value.
-- Idempotent; nullable so legacy rows (written before this column) fall back to the recompute.
ALTER TABLE daily_reconciliation ADD COLUMN IF NOT EXISTS severity TEXT;
