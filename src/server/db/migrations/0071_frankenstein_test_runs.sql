-- Migration 0071: frankenstein_test_runs table (A4 — Frankenstein Test)
--
-- Purpose: store randomization detection test results. If a strategy shows edge
-- on shuffled/GBM data, the backtester has a lookahead or future-data leak bug.
--
-- Pass criteria (locked from plan):
--   p95_sharpe < 0.3 AND median_pf IN [0.85, 1.15]
--
-- Gate: TESTING→PAPER lifecycle transition reads passed=true before promoting.
-- Unlike adversarial_stress_runs (Phase 0 shadow), this IS a hard gate.
--
-- Pending-row contract: status starts "pending" before Python subprocess runs.
-- Updated to "completed" or "failed" on resolve.
--
-- test_mode values:
--   full_shuffle            — bars shuffled uniformly at random (100 iterations)
--   benchmark_relative      — excess returns above benchmark shuffled (long-only strategies)
--   calendar_preserving     — shuffle within day-of-week buckets (calendar-effect strategies)
--   synthetic_gbm           — replace data with GBM random walk at matched mean/vol (50 iterations)

CREATE TABLE frankenstein_test_runs (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  backtest_id          uuid REFERENCES backtests(id) NOT NULL,
  strategy_id          uuid REFERENCES strategies(id) NOT NULL,
  test_mode            text NOT NULL,       -- full_shuffle | benchmark_relative | calendar_preserving | synthetic_gbm
  n_shuffles           integer NOT NULL,
  p95_sharpe           numeric NOT NULL,    -- 95th percentile of |Sharpe| across shuffles
  median_pf            numeric NOT NULL,    -- median profit factor across shuffles
  passed               boolean NOT NULL,   -- p95_sharpe < 0.3 AND median_pf IN [0.85, 1.15]
  sharpe_distribution  jsonb,              -- array of Sharpe values from all shuffles
  pf_distribution      jsonb,              -- array of PF values from all shuffles
  failure_examples     jsonb,              -- shuffles that showed anomalous edge
  status               text NOT NULL DEFAULT 'pending',  -- pending | completed | failed
  error_message        text,
  wall_clock_ms        integer,
  created_at           timestamp DEFAULT now() NOT NULL
);

-- Efficient lookup by backtest (most common: "did this backtest pass Frankenstein?")
CREATE INDEX idx_frankenstein_backtest
  ON frankenstein_test_runs(backtest_id, created_at DESC);

-- Lookup by strategy (all historical Frankenstein runs for a strategy)
CREATE INDEX idx_frankenstein_strategy
  ON frankenstein_test_runs(strategy_id, created_at DESC);

-- Partial index for fast gate check: find the latest completed pass/fail for a backtest
CREATE INDEX idx_frankenstein_passed_status
  ON frankenstein_test_runs(passed, status)
  WHERE status = 'completed';
