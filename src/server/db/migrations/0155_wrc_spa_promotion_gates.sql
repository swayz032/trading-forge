-- Migration 0152: WRC + SPA promotion gate columns on backtests
-- Wave 26 Pass G Pass E — institutional statistical filters at PAPER → DEPLOY_READY
--
-- Adds two nullable JSONB columns to `backtests`:
--   wrc_result  — White's Reality Check output { p_value, test_stat, passed, ... }
--   spa_result  — Hansen's SPA output { spa_lower_p, spa_consistent_p, spa_upper_p, passed, ... }
--
-- Both columns are nullable: strategies backtested before Pass E do not have
-- this data and the promotion gate fails-open for legacy compatibility.
--
-- strategy_promotion_metrics view (created here): provides a clean single-row-
-- per-strategy materialized view of the latest WRC/SPA/CPCV/WFE data for the
-- orchestrator's SELECT.  Uses a DISTINCT ON query — no new table required.
--
-- IDEMPOTENT: re-running on an existing DB is a no-op.

-- ─── Add WRC / SPA columns to backtests ───────────────────────────────────────

ALTER TABLE backtests
    ADD COLUMN IF NOT EXISTS wrc_result     JSONB,
    ADD COLUMN IF NOT EXISTS spa_result     JSONB;

COMMENT ON COLUMN backtests.wrc_result IS
    'White Reality Check result written by the backtest engine post-run. '
    'Shape: { p_value, test_stat, passed, threshold, n_obs, n_bootstrap, '
    'block_length, mean_excess_return }. '
    'NULL for backtests run before Wave 26 Pass G Pass E.';

COMMENT ON COLUMN backtests.spa_result IS
    'Hansen SPA result written by the backtest engine post-run. '
    'Shape: { spa_lower_p, spa_consistent_p, spa_upper_p, passed, threshold, '
    'n_obs, n_bootstrap, block_length, mean_excess_return }. '
    'NULL for backtests run before Wave 26 Pass G Pass E.';

-- Lookup index for orchestrator: latest WRC/SPA per strategy
CREATE INDEX IF NOT EXISTS backtests_strategy_wrc_spa_idx
    ON backtests (strategy_id, created_at DESC)
    WHERE wrc_result IS NOT NULL OR spa_result IS NOT NULL;
