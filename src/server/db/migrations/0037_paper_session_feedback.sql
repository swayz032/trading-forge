-- Migration: 0037_paper_session_feedback
-- Phase 4.6: Structured learning evidence per closed paper session.
--
-- After each session closes, the system computes:
--   - win rate by session window (ASIA/LONDON/NY_OPEN/NY_CORE/NY_CLOSE/OVERNIGHT)
--   - signal accuracy (% of signals that produced winning trades)
--   - stop tightness: median MAE vs stop distance (proxy: avg loss size)
--   - average R:R realized vs planned (MFE/|MAE| ratio per trade)
--   - best/worst session windows by total P&L
--   - overall session-level P&L summary and trade count
--
-- The critic queries this table via GET /api/paper/sessions/:id/feedback
-- to use empirical paper evidence in the next optimization cycle.

CREATE TABLE IF NOT EXISTS "paper_session_feedback" (
  "id"                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "session_id"              uuid NOT NULL REFERENCES "paper_sessions"("id") ON DELETE CASCADE,
  "strategy_id"             uuid REFERENCES "strategies"("id"),

  -- ─── Session-level summary ────────────────────────────────────────────────
  "total_trades"            integer NOT NULL DEFAULT 0,
  "total_pnl"               numeric,          -- net P&L for the session
  "win_rate"                numeric,          -- fraction [0,1] of winning trades
  "avg_rr_realized"         numeric,          -- mean(MFE / |MAE|) per trade — null if no MAE data
  "profit_factor"           numeric,          -- gross_profit / gross_loss

  -- ─── Stop tightness ───────────────────────────────────────────────────────
  -- median MAE expressed as a dollar amount; a large MAE relative to avg loss
  -- means the stop was too tight (trades nearly stopped out then recovered)
  "median_mae"              numeric,          -- median |MAE| across trades ($)
  "avg_loss"                numeric,          -- mean P&L of losing trades ($, negative)
  "stop_tightness_ratio"    numeric,          -- |median_mae / avg_loss| — >1.0 means stops were too tight

  -- ─── Win rate by session window ───────────────────────────────────────────
  -- JSONB map: { "NY_OPEN": 0.67, "LONDON": 0.40, ... }
  -- Only includes windows that had >= 1 trade
  "win_rate_by_session"     jsonb,

  -- ─── P&L by session window ────────────────────────────────────────────────
  -- JSONB map: { "NY_OPEN": 345.50, "LONDON": -112.00, ... }
  "pnl_by_session"          jsonb,

  -- ─── Trade count by session window ────────────────────────────────────────
  "trade_count_by_session"  jsonb,

  -- ─── Best / worst windows ─────────────────────────────────────────────────
  "best_session_window"     text,             -- e.g. "NY_OPEN"
  "worst_session_window"    text,

  -- ─── Signal accuracy by side ─────────────────────────────────────────────
  -- JSONB map: { "long": 0.60, "short": 0.52 }
  "win_rate_by_side"        jsonb,

  -- ─── MFE analysis ─────────────────────────────────────────────────────────
  "median_mfe"              numeric,          -- median MFE ($) — how far winners ran
  "avg_mfe_on_winners"      numeric,          -- mean MFE on winning trades only
  "mfe_capture_rate"        numeric,          -- avg_win / avg_mfe_on_winners — did we capture gains efficiently?

  -- ─── Metadata ─────────────────────────────────────────────────────────────
  "computed_at"             timestamp NOT NULL DEFAULT now(),
  "session_start"           timestamp,
  "session_end"             timestamp,
  "has_mae_data"            boolean NOT NULL DEFAULT false,  -- false = MAE/MFE columns not available; ratios are estimates
  "notes"                   text                             -- human-readable summary for critic
);

CREATE INDEX IF NOT EXISTS "paper_session_feedback_session_idx"   ON "paper_session_feedback"("session_id");
CREATE INDEX IF NOT EXISTS "paper_session_feedback_strategy_idx"  ON "paper_session_feedback"("strategy_id");
CREATE INDEX IF NOT EXISTS "paper_session_feedback_computed_idx"  ON "paper_session_feedback"("computed_at" DESC);
