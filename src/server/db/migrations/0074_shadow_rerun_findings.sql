-- Migration 0074: shadow_rerun_findings table (A11 — Shadow Re-Run Pattern, W12 Team A)
--
-- Purpose: When a math fix is applied (bug fix, model change, engine update), re-run
-- all PAPER+ strategies' historical backtests with the new code and surface any whose
-- promotion decision would have flipped. This table stores the diff per-strategy.
--
-- PAPER+ scope: PAPER, DEPLOY_READY, DEPLOYED, DECLINING, RETIRED, GRAVEYARD
-- These are strategies that produced real evidence and were promoted past TESTING.
-- Without this table, a math fix could silently affect already-promoted strategies
-- with no way to know whose gate decisions changed.
--
-- Design notes:
--   - old_result_hash / new_result_hash: SHA-256 from backtest_provenance. If same
--     hash, the code change had no effect on that strategy's output (info).
--   - status_flipped: did the promotion gate decision change? If old metrics passed
--     the gate (PF >= 1.75, Sharpe >= 1.5) but new metrics fail (or vice versa),
--     this is critical — the strategy was promoted or rejected on wrong math.
--   - severity tiers:
--       info     — same result_hash, code change had no effect on this strategy
--       warning  — different result_hash, different metrics, but same gate decision
--       critical — different result_hash AND gate decision would have flipped
--   - old_pf, new_pf etc. are captured from backtest.profit_factor /
--     backtest_provenance at shadow re-run time. Nullable — older backtests may
--     lack provenance rows (recorded but incomplete).
--   - run_reason: free-text explaining why this shadow re-run was triggered
--     (e.g. "bug fix: WF intraday DD calculation corrected in commit abc123").
--
-- Idempotency: running shadow re-run twice with the same code_git_sha and same
-- old provenance produces identical findings (same input → same output).
-- The UNIQUE index on (strategy_id, backtest_id, new_code_git_sha) prevents
-- duplicate rows for the same (strategy, backtest, code version) triple.

CREATE TABLE shadow_rerun_findings (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_at              timestamp DEFAULT now() NOT NULL,
  run_reason          text NOT NULL,                -- why this shadow re-run was triggered
  strategy_id         uuid REFERENCES strategies(id) NOT NULL,
  backtest_id         uuid REFERENCES backtests(id) NOT NULL,
  old_code_git_sha    text NOT NULL,                -- git SHA of the code that produced old_result_hash
  new_code_git_sha    text NOT NULL,                -- git SHA of the code used in shadow re-run
  old_result_hash     text NOT NULL,                -- result_hash from backtest_provenance
  new_result_hash     text NOT NULL,                -- result_hash from shadow re-run
  old_pf              numeric,                      -- profit_factor from original backtest
  new_pf              numeric,                      -- profit_factor from shadow re-run
  old_sharpe          numeric,                      -- sharpe_ratio from original backtest
  new_sharpe          numeric,                      -- sharpe_ratio from shadow re-run
  old_max_dd          numeric,                      -- max_drawdown from original backtest
  new_max_dd          numeric,                      -- max_drawdown from shadow re-run
  status_flipped      boolean NOT NULL,             -- did promotion decision change? (critical indicator)
  severity            text NOT NULL DEFAULT 'info'  -- info | warning | critical
);

-- Recency index for "show latest shadow re-run findings" dashboard queries
CREATE INDEX idx_shadow_rerun_run_at
  ON shadow_rerun_findings(run_at DESC);

-- Strategy-level lookup: "which shadow re-runs affected this strategy?"
CREATE INDEX idx_shadow_rerun_strategy
  ON shadow_rerun_findings(strategy_id, run_at DESC);

-- Critical-first dashboard view: unresolved critical findings top of list
CREATE INDEX idx_shadow_rerun_severity
  ON shadow_rerun_findings(severity, status_flipped)
  WHERE severity IN ('warning', 'critical');

-- Idempotency guard: one finding per (strategy, backtest, new code version)
-- Prevents duplicate rows when shadow re-run is triggered twice on same SHA.
CREATE UNIQUE INDEX idx_shadow_rerun_unique_finding
  ON shadow_rerun_findings(strategy_id, backtest_id, new_code_git_sha);
