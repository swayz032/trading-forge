-- Migration 0148: Add compliance_mode column to backtests table
-- Wave 27.5 Pass C.2 — Compliance Gate Enforcement Mode Env Knob (H4)
--
-- Purpose: persist the resolved compliance_mode ("shadow" | "enforce") at
-- backtest INSERT time so the audit trail records whether a given backtest
-- was run in research mode (shadow) or institutional enforcement mode.
--
-- Default: "enforce" — institutional default per operator mandate.
-- Research runs that explicitly opt-out via config.compliance_mode="shadow"
-- will record "shadow" here so operators can audit which results are based
-- on shadow-mode (potentially over-optimistic) backtest P&L.
--
-- Resolution order (highest wins):
--   1. BacktestRequest config field compliance_mode
--   2. BACKTEST_COMPLIANCE_MODE env var
--   3. hardcoded default "enforce"
--
-- Idempotent: ADD COLUMN IF NOT EXISTS is a no-op on re-apply.

ALTER TABLE backtests
    ADD COLUMN IF NOT EXISTS compliance_mode TEXT DEFAULT 'enforce';

COMMENT ON COLUMN backtests.compliance_mode IS
    '"shadow" = violations logged, trades NOT blocked (research mode). '
    '"enforce" = violating trades SKIPPED + audit row emitted (institutional default). '
    'Resolved at INSERT time from per-backtest config override, then env BACKTEST_COMPLIANCE_MODE, '
    'then hardcoded "enforce". Shadow mode MUST be explicit — silence = enforcement. '
    'Added Wave 27.5 Pass C.2 (migration 0148).';
