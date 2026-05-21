-- migration 0130: Style C 33/33/33 partial-fill tracking columns
--
-- Adds columns to paper_positions for:
--   1. tp1_filled_at / tp2_filled_at  — timestamps when TP levels were crossed
--      Used by evaluateSignals() (paper-signal-service.ts) for BE-stop move detection.
--   2. tp1_filled / tp2_filled        — boolean idempotency flags for Python exit handler
--      Used by callExitHandler() (paper-execution-service.ts) FILL_TP1/FILL_TP2 decisions.
--   3. be_stop_applied                — boolean flag: break-even stop has been applied
--   4. current_exit_style             — which exit handler is active ('D' or 'C')
--   5. last_handler_eval_at           — last time the Python exit handler evaluated this position
--
-- Style C 33/33/33 (CLAUDE.md §4 canonical, W23F.N 2026-05-19):
--   TP1: 33% off @ +1.0R → tp1_filled set, stop moved to BE+1 tick
--   TP2: 33% off @ +2.0R → tp2_filled set, runner (34%) continues on trail
--   Runner: 34% exits on trailing stop OR 15:55 ET hard time-stop
--
-- All columns are non-destructive (IF NOT EXISTS / nullable defaults).

ALTER TABLE paper_positions
  ADD COLUMN IF NOT EXISTS tp1_filled_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS tp2_filled_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS tp1_filled           BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS tp2_filled           BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS be_stop_applied      BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS current_exit_style   TEXT,
  ADD COLUMN IF NOT EXISTS current_trail_method TEXT,
  ADD COLUMN IF NOT EXISTS last_handler_eval_at TIMESTAMPTZ;

COMMENT ON COLUMN paper_positions.tp1_filled_at IS
  'Timestamp when TP1 (+1R) was first crossed (evaluateSignals() BE-stop move path). '
  'NULL = not yet hit. Drives tp1BeStopMap restoration after server restart.';

COMMENT ON COLUMN paper_positions.tp2_filled_at IS
  'Timestamp when TP2 (+2R) was first crossed. NULL = not yet hit. '
  'Carry-forward: partial contract close not yet implemented.';

COMMENT ON COLUMN paper_positions.tp1_filled IS
  'Boolean idempotency flag: Python exit handler (FILL_TP1_50PCT decision) has run. '
  'Prevents duplicate partial closes from replayed bars.';

COMMENT ON COLUMN paper_positions.tp2_filled IS
  'Boolean idempotency flag: Python exit handler (FILL_TP2 decision) has run.';

COMMENT ON COLUMN paper_positions.be_stop_applied IS
  'True after Python exit handler emitted MOVE_STOP_TO_BE for this position.';

COMMENT ON COLUMN paper_positions.current_exit_style IS
  'Which exit handler is active: "C" (Style C 33/33/33) or "D" (legacy). '
  'NULL defaults to "D" in callExitHandler(). Set at position open by framework-overlay config.';

COMMENT ON COLUMN paper_positions.last_handler_eval_at IS
  'Timestamp of last callExitHandler() evaluation. Used for circuit-breaker reset and audit.';
