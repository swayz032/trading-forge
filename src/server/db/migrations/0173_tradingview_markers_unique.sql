-- 0173_tradingview_markers_unique.sql
-- Pass 7 Track A.1: Prevent duplicate tradingview_markers rows on TradingView retry
-- TradingView retries alerts; without this index, each retry creates a new row
-- causing reconciliation, critique attribution, and consistency tracker to over-count.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tradingview_markers_dedup
  ON tradingview_markers (account_id, strategy_id, bar_timestamp, signal);
