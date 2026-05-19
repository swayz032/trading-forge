-- Migration 0088: Synthetic Black Swan Engine (W19 / A14)
--
-- Purpose: Hold the synthetic-regime bank produced by the TimeGrad-style
-- generator (`synthetic_regime_bank`) and the per-strategy survival
-- evaluation rows (`synthetic_black_swan_runs`).
--
-- Lifecycle integration:
--   Phase 0 (Day 0–60): challenger_only / shadow. Service writes results;
--     lifecycle gate logs an advisory at PAPER → DEPLOY_READY but never blocks.
--   Phase 1 (Day 60+): hard gate at PAPER → DEPLOY_READY when
--     survival_rate < 0.60 over 1,000 synthetic regimes.
--
-- Pending-row contract (mirrors `frankenstein_test_runs` / `quantum_run_costs`):
--   `status` starts 'pending' before the Python evaluator runs.
--   Resolved to 'completed' or 'failed' (with `error_message`) after spawn.
--   Stale-pending sweeper auto-marks rows older than 1 hour as 'failed'.
--
-- Additive only: no ALTER on existing tables, no destructive ops.
-- FK ON DELETE CASCADE matches the established pattern across the codebase
-- so downstream rows do not orphan when a parent strategy/backtest is purged.
--
-- Apply via direct SQL on Railway (drizzle-kit broken for this repo):
--   psql $DATABASE_URL -c "$(cat 0088_synthetic_black_swan_runs.sql)"

CREATE TABLE IF NOT EXISTS synthetic_regime_bank (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol                          text NOT NULL,
  timeframe                       text NOT NULL,
  regime_label                    text NOT NULL,                 -- crash | low_vol_then_explode | rate_shock | composite | ...
  conditioning_vector_compressed  bytea NOT NULL,                -- gzip of float32 conditioning vector
  conditioning_dim                integer NOT NULL,
  s3_path                         text NOT NULL,                 -- s3://.../futures/{symbol}/synthetic/{regime_label}/{id}.parquet
  num_bars                        integer NOT NULL,
  stylized_fact_passed            boolean NOT NULL,              -- did this regime pass calibration tests?
  generator_model_version         text NOT NULL,                 -- tracks which trained model produced it
  created_at                      timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_synth_bank_symbol_tf
  ON synthetic_regime_bank(symbol, timeframe);
CREATE INDEX IF NOT EXISTS idx_synth_bank_regime
  ON synthetic_regime_bank(regime_label);
CREATE INDEX IF NOT EXISTS idx_synth_bank_passed
  ON synthetic_regime_bank(stylized_fact_passed)
  WHERE stylized_fact_passed = true;

CREATE TABLE IF NOT EXISTS synthetic_black_swan_runs (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id              uuid NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
  backtest_id              uuid NOT NULL REFERENCES backtests(id) ON DELETE CASCADE,
  status                   text NOT NULL DEFAULT 'pending',      -- pending | completed | failed
  num_regimes_tested       integer,
  num_regimes_survived     integer,
  survival_rate            numeric(5,4),                          -- 0.0000–1.0000
  worst_regime_id          uuid REFERENCES synthetic_regime_bank(id),
  worst_regime_drawdown    numeric,
  worst_regime_label       text,
  result_summary           jsonb,                                 -- per-regime detail for top-K worst
  error_message            text,
  execution_time_ms        integer,
  generator_model_version  text,
  created_at               timestamp NOT NULL DEFAULT now(),
  resolved_at              timestamp
);

-- Hot-path index: gate read joins via backtest_id ("did this backtest run A14?")
CREATE INDEX IF NOT EXISTS idx_blackswan_backtest
  ON synthetic_black_swan_runs(backtest_id);

-- Strategy history scan ("all A14 runs for this strategy, newest first")
CREATE INDEX IF NOT EXISTS idx_blackswan_strategy
  ON synthetic_black_swan_runs(strategy_id, created_at DESC);

-- Partial index for the gate filter: "completed runs ranked by survival_rate".
-- Bounded by status='completed' so the index stays small even when many
-- pending/failed rows accumulate.
CREATE INDEX IF NOT EXISTS idx_blackswan_completed
  ON synthetic_black_swan_runs(status, survival_rate)
  WHERE status = 'completed';

COMMENT ON TABLE synthetic_regime_bank IS
  'W19 / A14: Synthetic OHLCV regime bank produced by TimeGrad-style generator. '
  'Only rows with stylized_fact_passed=true are eligible for survival evaluation. '
  'See CLAUDE.md "Synthetic Black Swan Survival" section for governance.';

COMMENT ON TABLE synthetic_black_swan_runs IS
  'W19 / A14: Per-strategy survival evaluation against the synthetic regime bank. '
  'Pending-row contract: row inserted before Python evaluator spawn, updated to '
  'completed/failed on resolve. Stale-pending sweeper auto-fails rows > 1 hour old. '
  'Phase 0 (Day 0–60): advisory only at PAPER → DEPLOY_READY. '
  'Phase 1 (Day 60+): hard gate when survival_rate < 0.60.';
