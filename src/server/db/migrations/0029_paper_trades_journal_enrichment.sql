-- Migration 0029: Phase 1.1 — Paper Trade Journal Enrichment
--
-- Adds 10 analytics columns to paper_trades for promotion-gate inputs,
-- parity diagnostics, and post-trade analysis.
--
-- Adds fill_probability to paper_positions so closePosition() can copy
-- the entry-time fill probability into the trade journal.
--
-- All columns are nullable — existing rows are unaffected.
-- IF NOT EXISTS guards protect against any manual pre-migration.
--
-- Known gaps (null until future phases):
--   mae              — requires per-bar watermark tracking (Phase 1.2)
--   mfe              — requires per-bar watermark tracking (Phase 1.2)
--   event_active     — requires Python calendar_filter integration (currently
--                      connected via runPythonModule; fills null if call fails)

-- ─── paper_trades enrichment columns ──────────────────────────────────────

ALTER TABLE "paper_trades"
  ADD COLUMN IF NOT EXISTS "mae"               numeric,
  ADD COLUMN IF NOT EXISTS "mfe"               numeric,
  ADD COLUMN IF NOT EXISTS "hold_duration_ms"  integer,
  ADD COLUMN IF NOT EXISTS "hour_of_day"       integer,
  ADD COLUMN IF NOT EXISTS "day_of_week"       integer,
  ADD COLUMN IF NOT EXISTS "session_type"      text,
  ADD COLUMN IF NOT EXISTS "macro_regime"      text,
  ADD COLUMN IF NOT EXISTS "event_active"      boolean,
  ADD COLUMN IF NOT EXISTS "skip_signal"       text,
  ADD COLUMN IF NOT EXISTS "fill_probability"  numeric;

-- ─── paper_positions: capture fill probability at entry ───────────────────
-- Allows closePosition() to propagate the entry-time fill probability into
-- the paper_trades journal row without re-computing it at close time.

ALTER TABLE "paper_positions"
  ADD COLUMN IF NOT EXISTS "fill_probability"  numeric;

-- ─── Indexes for analytics queries ────────────────────────────────────────
-- session_type is the primary cut for paper/backtest parity reports.
-- skip_signal supports context-gate effectiveness analysis.

CREATE INDEX IF NOT EXISTS "paper_trades_session_type_idx"  ON "paper_trades" ("session_type");
CREATE INDEX IF NOT EXISTS "paper_trades_skip_signal_idx"   ON "paper_trades" ("skip_signal");
CREATE INDEX IF NOT EXISTS "paper_trades_macro_regime_idx"  ON "paper_trades" ("macro_regime");
