-- Migration 0153: CPCV min-paths enforcement index
-- Wave 26 Pass G Pass E — institutional CPCV n_paths floor (≥ 15)
--
-- Adds a covering index on walk_forward_windows for fast CPCV n_paths lookup
-- that the promotion gate orchestrator uses to check CPCV coverage.
--
-- Background:
--   walk_forward_results JSONB on `backtests` includes a `wf_metadata` sub-object
--   that contains mode='cpcv' + n_paths (from _run_walk_forward_cpcv).  The gate
--   reads this column via a simple JSON extraction, not a separate table.
--
--   The comment below documents the expected wf_metadata shape; the index is on
--   backtests(strategy_id, created_at DESC) to support the fast "latest CPCV run"
--   lookup for the orchestrator.
--
-- wf_metadata shape (embedded in backtests.walk_forward_results):
--   {
--     "mode": "cpcv",
--     "n_folds": 6,
--     "n_paths": 15,          <── gate checks this
--     "embargo_pct": ...,
--     "purge_window": ...,
--     "psr": ...,
--     "dsr": ...
--   }
--
-- IDEMPOTENT: re-running on an existing DB is a no-op.

-- Fast latest-CPCV-run lookup per strategy (used by promotion gate orchestrator)
CREATE INDEX IF NOT EXISTS backtests_strategy_cpcv_lookup_idx
    ON backtests (strategy_id, created_at DESC)
    WHERE (walk_forward_results->>'wf_metadata') IS NOT NULL
       OR (walk_forward_results->'wf_metadata'->>'mode') IS NOT NULL;

-- Sparse index for CPCV-mode rows specifically (supports "has CPCV with n_paths?" queries)
CREATE INDEX IF NOT EXISTS backtests_cpcv_mode_idx
    ON backtests (strategy_id, created_at DESC)
    WHERE walk_forward_results->'wf_metadata'->>'mode' = 'cpcv';
