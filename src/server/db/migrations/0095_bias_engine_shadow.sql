-- Migration: 0095_bias_engine_shadow
-- Track 5 — Phase D Readiness: passive instrumentation tables for bias engine SHADOW mode.
-- These tables accumulate decision evidence so the calibration harness can run on Day 60+.
-- No behavioral changes to bias_engine or playbook_router.

-- ─── bias_decisions ─────────────────────────────────────────────────────────
-- One row per route_playbook() call (when BIAS_ENGINE_MODE != 'OFF').
-- Captures full feature snapshot, raw HMM probs, router decision, and mode.
CREATE TABLE bias_decisions (
  id                    BIGSERIAL PRIMARY KEY,
  symbol                TEXT NOT NULL,
  decision_timestamp    TIMESTAMPTZ NOT NULL,
  feature_snapshot      JSONB NOT NULL,        -- Full bias state input (HTF, session, macro, VP, etc.)
  feature_versions      JSONB NOT NULL,        -- {bias_engine: "1.x", playbook_router: "1.x", vp: "1.0"}
  classifier_version    TEXT NOT NULL,
  raw_state_probs       JSONB NOT NULL,        -- {trend: 0.71, range: 0.18, ...} from HMM (or classical equiv)
  calibrated_confidence NUMERIC(5,4),          -- post-Platt (null until calibration runs)
  calibration_version   TEXT,
  router_version        TEXT NOT NULL,
  router_hash           TEXT NOT NULL,
  playbook              TEXT NOT NULL,          -- Selected playbook string
  allowed_strategies    JSONB NOT NULL,         -- list[str]
  hysteresis_applied    BOOLEAN NOT NULL DEFAULT false,
  engine_mode           TEXT NOT NULL,          -- 'OFF' | 'SHADOW' | 'SIZING_ONLY' | 'HARD_GATE'
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(symbol, decision_timestamp, router_version)
);

CREATE INDEX idx_bias_decisions_symbol_ts   ON bias_decisions(symbol, decision_timestamp DESC);
CREATE INDEX idx_bias_decisions_playbook    ON bias_decisions(playbook);
CREATE INDEX idx_bias_decisions_engine_mode ON bias_decisions(engine_mode);

-- ─── bias_calibration_curves ────────────────────────────────────────────────
-- One row per calibration fit run. Stores Platt / isotonic curve parameters
-- and the reliability score so the evaluator can cite calibration quality.
CREATE TABLE bias_calibration_curves (
  id                BIGSERIAL PRIMARY KEY,
  fit_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  window_days       INT NOT NULL,
  curve_method      TEXT NOT NULL,             -- 'platt' | 'isotonic'
  curve_params      JSONB NOT NULL,            -- Method-specific params (intercept/slope for platt; breakpoints for isotonic)
  reliability_score NUMERIC(5,4),             -- ECE or Brier score (lower = better calibration)
  version           TEXT NOT NULL
);

CREATE INDEX idx_bias_calibration_fit_at ON bias_calibration_curves(fit_at DESC);

-- ─── bias_ablation_results ──────────────────────────────────────────────────
-- One row per ablation run comparing mode=OFF vs mode=SHADOW vs mode=SIZING_ONLY.
-- gpt5_verdict is null until the bias_engine_evaluator role runs.
CREATE TABLE bias_ablation_results (
  id                    BIGSERIAL PRIMARY KEY,
  run_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  period_start          DATE NOT NULL,
  period_end            DATE NOT NULL,
  mode_off_sharpe       NUMERIC(8,4),
  mode_gated_sharpe     NUMERIC(8,4),
  sharpe_delta          NUMERIC(8,4),
  cost_multiplier       NUMERIC(4,2),
  pbo_score             NUMERIC(5,4),           -- Probability of Backtest Overfitting (López de Prado)
  gpt5_verdict          TEXT,                   -- 'GRADUATE' | 'STAY_IN_SHADOW' | 'KILL' (null until evaluator runs)
  gpt5_reasoning        TEXT,
  accepted_by_operator  BOOLEAN
);

CREATE INDEX idx_bias_ablation_run_at ON bias_ablation_results(run_at DESC);

-- ─── DOWN migration ──────────────────────────────────────────────────────────
-- To reverse: DROP TABLE bias_ablation_results; DROP TABLE bias_calibration_curves; DROP TABLE bias_decisions;
