-- W19 Schema 2: Daily Settlement Prices and Open Interest from Databento Statistics schema
-- Used for: (1) backtest PnL reconciliation vs CME official settlement,
--           (2) stress test scenarios with real settlement prices,
--           (3) OI-based liquidity filter (skip contracts with declining OI).
--
-- Apply via direct SQL on Railway (drizzle-kit broken for this repo):
--   psql $DATABASE_URL -c "$(cat 0086_daily_statistics.sql)"

CREATE TABLE IF NOT EXISTS daily_statistics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,                   -- e.g. 'ES', 'NQ', 'MES', 'MNQ', 'MCL'
  trade_date date NOT NULL,               -- the trading day this settlement applies to
  settlement_price numeric,               -- CME official daily settlement price
  open_interest bigint,                   -- open interest at settlement
  session_high numeric,                   -- intraday high for the session
  session_low numeric,                    -- intraday low for the session
  volume bigint,                          -- total volume for the session
  pulled_at timestamp DEFAULT now() NOT NULL,
  UNIQUE(symbol, trade_date)              -- one row per symbol per trading day
);

-- Fast symbol+date range queries (reconciliation and OI filter)
CREATE INDEX IF NOT EXISTS idx_daily_stats_symbol_date
  ON daily_statistics(symbol, trade_date DESC);

COMMENT ON TABLE daily_statistics IS
  'W19 Schema 2: CME daily settlement prices and open interest from Databento Statistics schema. '
  'Used for PnL reconciliation (settlement vs backtest close), stress test price anchoring, '
  'and OI liquidity filter (block entries on contracts with >20% OI decline over 5 days).';
