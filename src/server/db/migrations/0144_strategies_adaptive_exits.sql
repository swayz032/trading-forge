-- Migration 0144 — strategies.exit_plan_config (Wave 25 Pass 7 adaptive exit engine)
-- idx: 146 (journal entry follows)
--
-- Adds per-strategy exit plan configuration for the Wave 25 adaptive exit engine.
-- Default NULL → framework-overlay reads exit_style="static_styleC" (legacy) for
-- existing strategies.  New strategies get exit_style="adaptive" via service code.
--
-- exit_plan_config JSONB shape:
-- {
--   "exit_style": "adaptive" | "static_styleC",
--   "scaling_overrides": null | {
--     "TRENDING_UP":   [0.2, 0.3, 0.5],
--     "TRENDING_DOWN": [0.2, 0.3, 0.5],
--     "EXPANSION":     [0.2, 0.3, 0.5],
--     "RANGE_BOUND":   [0.5, 0.3, 0.2],
--     "COMPRESSION":   [0.5, 0.3, 0.2],
--     "HIGH_VOL_MACRO":[0.6, 0.3, 0.1],
--     "LOW_LIQ_CHOP":  [0.5, 0.5, 0.0]
--   },
--   "runner_trail_overrides": null | {
--     "TRENDING_UP": "anchored_vwap",
--     "RANGE_BOUND": "developing_poc"
--   },
--   "pre_lunch_threshold_r": 0.3,
--   "delta_div_partial_pct": 0.25
-- }
--
-- Idempotent: ADD COLUMN IF NOT EXISTS.

ALTER TABLE strategies
  ADD COLUMN IF NOT EXISTS exit_plan_config JSONB DEFAULT NULL;

COMMENT ON COLUMN strategies.exit_plan_config IS
  'Wave 25 Pass 7 adaptive exit engine config.  '
  'exit_style: "adaptive" | "static_styleC" (default static_styleC when null).  '
  'scaling_overrides: per-regime [tp1_pct, tp2_pct, runner_pct] overrides.  '
  'runner_trail_overrides: per-regime trail method override.  '
  'pre_lunch_threshold_r: minimum profit R for pre-lunch partial (default 0.3).  '
  'delta_div_partial_pct: fraction to close on delta divergence (default 0.25).';
