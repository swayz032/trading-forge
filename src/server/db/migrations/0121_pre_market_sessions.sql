-- Migration 0121: pre_market_sessions table
-- W23H.2 — Pre-market routine persistence
-- Idempotent: CREATE IF NOT EXISTS throughout

CREATE TABLE IF NOT EXISTS pre_market_sessions (
  id BIGSERIAL PRIMARY KEY,
  session_date DATE NOT NULL,
  symbol TEXT NOT NULL,
  overnight_range_points NUMERIC,
  vix_bucket TEXT,
  vix_proxy_atr_percentile NUMERIC,
  economic_calendar_clear BOOLEAN,
  blackout_windows JSONB,
  opening_gap_pct NUMERIC,
  vwap_anchor NUMERIC,
  pdh NUMERIC,
  pdl NUMERIC,
  pwh NUMERIC,
  pwl NUMERIC,
  htf_bias TEXT,
  written_bias TEXT,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pre_market_sessions_unique UNIQUE (session_date, symbol)
);

CREATE INDEX IF NOT EXISTS idx_pre_market_sessions_date ON pre_market_sessions (session_date DESC);
CREATE INDEX IF NOT EXISTS idx_pre_market_sessions_symbol ON pre_market_sessions (symbol, session_date DESC);
