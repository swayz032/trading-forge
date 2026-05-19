-- Phase 1.5: Add MAE/MFE watermark columns to paper_positions
--
-- mae: Maximum Adverse Excursion ($) — worst (most negative) unrealized P&L
--      seen during the trade life.  Updated on each bar by updatePositionPrices.
--      Negative for losing direction, 0 if price never moved against entry.
--
-- mfe: Maximum Favorable Excursion ($) — best (most positive) unrealized P&L
--      seen during the trade life.  Updated on each bar by updatePositionPrices.
--      Positive for winning direction, 0 if price never moved in favor of entry.
--
-- Both values are copied to paper_trades.mae / paper_trades.mfe at position close
-- so the full trade journal has per-trade excursion data for promotion-gate analytics.

ALTER TABLE paper_positions
  ADD COLUMN IF NOT EXISTS mae NUMERIC,
  ADD COLUMN IF NOT EXISTS mfe NUMERIC;
