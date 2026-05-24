-- Migration 0135: Weighted Confluence Scoring columns (Wave 25 Pass 1, W25.1, 2026-05-24)
--
-- Adds three queryable columns to the `strategies` table to support opt-in weighted
-- probabilistic scoring (Path C) in Stage 2 of the A+ confluence gate.
--
-- Design intent:
--   entry_quality JSONB in strategies.config already carries `confluence_factors`,
--   `min_factors_satisfied`, and `confirming_indicators`.  These three new TOP-LEVEL
--   columns expose the scoring fields at the row level so queries can filter strategies
--   by scoring mode without parsing JSONB.
--
--   use_weighted_scoring = FALSE (default) preserves the existing boolean path
--   (Path A per-strategy or Path B canonical-5) for ALL pre-Wave-25 strategies.
--   Set to TRUE on a per-strategy basis to opt into Path C.
--
--   confluence_score_threshold: operator-tunable threshold, [0.00, 1.00].
--     NULL → evaluateWeightedConfluence() uses code default (0.72).
--
--   confluence_score_weights: JSONB map of factor→weight overrides.
--     NULL → evaluateWeightedConfluence() uses env default or code defaults.
--     Example: { "market_structure_aligned": 0.30, "killzone_active": 0.05 }
--     Sum of provided weights need not equal 1.0; evaluator re-normalises.
--
-- Backfill: NONE.  Default FALSE leaves all existing strategies on the boolean path.
-- All changes idempotent (ADD COLUMN IF NOT EXISTS).

ALTER TABLE strategies
  ADD COLUMN IF NOT EXISTS use_weighted_scoring    BOOLEAN      DEFAULT FALSE;

ALTER TABLE strategies
  ADD COLUMN IF NOT EXISTS confluence_score_threshold  NUMERIC(3,2);

ALTER TABLE strategies
  ADD COLUMN IF NOT EXISTS confluence_score_weights    JSONB;

-- Partial index: only index the small subset that opts in, avoiding full-table cost.
CREATE INDEX IF NOT EXISTS strategies_weighted_scoring_idx
  ON strategies (id)
  WHERE use_weighted_scoring = TRUE;

-- Comment for future operators
COMMENT ON COLUMN strategies.use_weighted_scoring IS
  'Wave 25: when TRUE, Stage 2 uses evaluateWeightedConfluence() (Path C) instead of boolean counting.';
COMMENT ON COLUMN strategies.confluence_score_threshold IS
  'Wave 25: weighted-score gate threshold in [0,1]. NULL = code default 0.72.';
COMMENT ON COLUMN strategies.confluence_score_weights IS
  'Wave 25: JSON map of factor->weight overrides. NULL = env/code defaults. Evaluator re-normalises sum.';
