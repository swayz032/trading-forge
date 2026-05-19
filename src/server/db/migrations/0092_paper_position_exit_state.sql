-- Migration 0092: Paper position exit state columns for Track 3 Style D/C dispatch
-- Adds per-position exit lifecycle state: style, TP fill flags, BE flag, trail method, last eval time.
-- Backwards-compat: all columns have safe defaults so pre-existing rows work without hydration.
-- DOWN migration: see final comment block.

ALTER TABLE paper_positions
  ADD COLUMN IF NOT EXISTS current_exit_style TEXT NOT NULL DEFAULT 'D',
  ADD COLUMN IF NOT EXISTS tp1_filled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS tp2_filled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS be_stop_applied BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS current_trail_method TEXT,
  ADD COLUMN IF NOT EXISTS last_handler_eval_at TIMESTAMPTZ;

COMMENT ON COLUMN paper_positions.current_exit_style IS
  'Exit style selected at entry: D (default) or C (regime runner). Drives Style D/C handler dispatch on every bar.';
COMMENT ON COLUMN paper_positions.tp1_filled IS
  'True once TP1 partial close has been executed (50% for Style D, 33% for Style C). Guards idempotent TP1 dispatch.';
COMMENT ON COLUMN paper_positions.tp2_filled IS
  'True once TP2 partial close has been executed (Style C only: 33% at +2.0R). Guards idempotent TP2 dispatch.';
COMMENT ON COLUMN paper_positions.be_stop_applied IS
  'True once break-even stop (BE+1 tick) has been applied after TP1. Guards idempotent BE dispatch.';
COMMENT ON COLUMN paper_positions.current_trail_method IS
  'Active trail method: chandelier | swing_low_2bar | tighter_of_both | developing_poc. Null until first trail update.';
COMMENT ON COLUMN paper_positions.last_handler_eval_at IS
  'Timestamp of last Style D/C handler evaluation for this position. Null for positions opened before 0092.';

-- Index for fast "open positions needing eval" queries
CREATE INDEX IF NOT EXISTS paper_positions_exit_eval_idx
  ON paper_positions (session_id, last_handler_eval_at)
  WHERE closed_at IS NULL;

-- ── DOWN migration ───────────────────────────────────────────────────────────
-- To revert this migration:
--   DROP INDEX IF EXISTS paper_positions_exit_eval_idx;
--   ALTER TABLE paper_positions
--     DROP COLUMN IF EXISTS current_exit_style,
--     DROP COLUMN IF EXISTS tp1_filled,
--     DROP COLUMN IF EXISTS tp2_filled,
--     DROP COLUMN IF EXISTS be_stop_applied,
--     DROP COLUMN IF EXISTS current_trail_method,
--     DROP COLUMN IF EXISTS last_handler_eval_at;
