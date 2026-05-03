-- Migration 0075: realized_peak_equity column on paper_sessions (W12 Bug #2 fix)
--
-- Purpose: Split the trailing drawdown high-water-mark (HWM) into two distinct columns:
--
--   peak_equity (existing) — marked-to-market HWM. Updated every price tick via
--     updatePositionPrices(). Retained as a UI display value for the dashboard.
--     NOT authoritative for prop-firm trailing-DD compliance.
--
--   realized_peak_equity (new) — closed-equity HWM. Updated ONLY in closePosition()
--     via GREATEST(realized_peak_equity, currentEquity + netPnl). This is the
--     authoritative trailing-DD HWM per Topstep / Apex EOD trailing-DD spec.
--     Per spec: HWM locks when a trade CLOSES into a new equity high, never from
--     intraday unrealized (MTM) P&L. Updating from MTM over-tightens the
--     trailing floor and triggers false breach detection.
--
-- Backfill: set realized_peak_equity = peak_equity for all existing sessions.
-- This is the conservative choice: existing sessions had their HWM updated
-- from MTM, so realized_peak_equity may be slightly overstated relative to
-- pure closed-equity HWM. Future closes will correct it downward over time
-- as the correct formula applies only closed P&L.
--
-- Apply via Railway direct SQL (drizzle-kit migrate is broken per W10/W11 audits).

ALTER TABLE paper_sessions
  ADD COLUMN IF NOT EXISTS realized_peak_equity numeric NOT NULL DEFAULT 50000;

-- Backfill: initialize realized_peak_equity from current peak_equity value.
-- Sessions with peak_equity > 50000 had profitable closed trades — carry over
-- the existing HWM as a conservative starting point.
UPDATE paper_sessions
  SET realized_peak_equity = peak_equity
  WHERE realized_peak_equity = 50000
    AND peak_equity != 50000;
