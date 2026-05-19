-- Migration 0024: Paper position state persistence + session trade counter
--
-- H2: Add trail_hwm and bars_held to paper_positions so trail-stop high-water
--     marks and bars-held counters survive server restarts.  The in-memory maps
--     remain the hot path; DB is written on every update and read at startup.
--
-- H3: Add total_trades to paper_sessions so the promotion-gate has a reliable
--     trade count that stays in sync with paper_trades rows (incremented inside
--     the closePosition transaction).

ALTER TABLE "paper_positions"
  ADD COLUMN IF NOT EXISTS "trail_hwm" numeric,
  ADD COLUMN IF NOT EXISTS "bars_held" integer NOT NULL DEFAULT 0;

ALTER TABLE "paper_sessions"
  ADD COLUMN IF NOT EXISTS "total_trades" integer NOT NULL DEFAULT 0;
