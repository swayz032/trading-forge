-- Migration 0180: Add correlation_id to paper_trades and paper_positions for end-to-end
-- signal→trade traceability (BL-9).
--
-- A closed paper trade currently cannot be traced to its originating signal.  Adding
-- correlation_id closes the signal→entry→close audit chain so any trade can be
-- reconstructed end-to-end (matching lifecycle_transitions.correlation_id and
-- audit_log.correlation_id patterns already in production).
--
-- paper_positions.correlation_id persists the id generated in openPosition() so that
-- closePosition() can recover it when called externally (force-close, time-stop, or any
-- path that does not carry the original signal context).
--
-- Both columns are nullable TEXT (not UUID) for maximum backward-compat flexibility:
-- pre-migration rows stay NULL; new rows are populated at position-open.

ALTER TABLE paper_trades
  ADD COLUMN IF NOT EXISTS correlation_id TEXT;

ALTER TABLE paper_positions
  ADD COLUMN IF NOT EXISTS correlation_id TEXT;
