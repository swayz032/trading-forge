-- Migration 0179: Add stop-price tracking columns to paper_positions
--
-- Three new columns enable two correctness fixes:
--
-- BL-1 (intrabar stop breach): initial_stop_price is set at position open and
--   compared to adversePrice (bar low/high) each bar so a stop is closed at the
--   stop level, not only when the bar's CLOSE crosses it.
--
-- H-1 (chandelier/structure trail): high_since_entry_price and
--   low_since_entry_price are running max/min of bar highs/lows since entry,
--   updated every bar in updatePositionPrices.  The chandelier formula uses
--   highSinceEntry - 2*ATR (for longs), not entryPrice - 2*ATR.
--   Without these columns the trail was permanently anchored at BE level.

ALTER TABLE paper_positions
  ADD COLUMN IF NOT EXISTS initial_stop_price NUMERIC,
  ADD COLUMN IF NOT EXISTS high_since_entry_price NUMERIC,
  ADD COLUMN IF NOT EXISTS low_since_entry_price NUMERIC;
