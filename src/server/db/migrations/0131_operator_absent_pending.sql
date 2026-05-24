-- migration 0131: operator_absent_pending column on system_state
--
-- Wave 24 Pass 1.5 Item 6 (CATASTROPHIC fix): auto-flip operator_absent_since
-- from heartbeat-stale signal. Adds a 24h confirmation window via a separate
-- _pending column so a one-day absence doesn't flip the flag (anti-flap).
--
-- State machine driven by runOperatorAbsenceAutoDetect() in
-- dead-mans-heartbeat-service.ts:
--
--   no activity ≥ 24h:
--     _pending IS NULL  → set _pending = NOW()
--     _pending IS NOT NULL AND age(_pending) ≥ 24h → set operator_absent_since = NOW()
--
--   activity observed:
--     POST /api/admin/operator-mark-present → clear BOTH columns
--
-- Idempotent — additive nullable column, safe to re-run.
--
-- Rollback (NEVER run in prod without manual review):
--   ALTER TABLE system_state DROP COLUMN IF EXISTS operator_absent_pending;
--
-- 0101 already added operator_absent_since; this is the second of the two columns.

ALTER TABLE system_state
  ADD COLUMN IF NOT EXISTS operator_absent_pending TIMESTAMPTZ;

COMMENT ON COLUMN system_state.operator_absent_pending IS
  'Wave 24 Pass 1.5: confirmation-window timestamp. Set when 24h of operator silence is detected. Promoted to operator_absent_since after another 24h of silence. Cleared by POST /api/admin/operator-mark-present.';
