-- Migration 0145: paper_positions.exit_plan + runtime_state JSONB columns
-- Wave 25.5 Track 1 — Gap A (position-open exit plan wiring)
--
-- exit_plan:       Persisted ExitPlan JSONB at position open when exit_style="adaptive".
--                  NULL for static_styleC positions — backward-compat preserved.
-- runtime_state:   Per-bar mutable state for adaptive runner trail methods:
--                    anchored_vwap: { sum_pv, sum_v }
--                    structure_trail: { current_swing_low, current_swing_high }
--                  Stored inside exit_plan JSONB to avoid schema churn.
--                  Updated in-place by updatePositionPrices on each bar.
--
-- Idempotent (safe to re-run after partial apply).

ALTER TABLE paper_positions
  ADD COLUMN IF NOT EXISTS exit_plan JSONB DEFAULT NULL;

-- Partial index: fast lookup for positions that have an adaptive exit plan.
-- Only covers non-NULL rows (open adaptive positions are the hot path).
CREATE INDEX IF NOT EXISTS idx_paper_positions_exit_plan_present
  ON paper_positions ((1))
  WHERE exit_plan IS NOT NULL;
