-- Migration 0146: Add firm_rules_version column to backtests table
-- Wave 27.5 Pass A.1 — CRITICAL #1: Firm-Rule Parameter Drift Check
--
-- Purpose: stamp the SHA-256 (16-char prefix) fingerprint of the firm rules
-- config at backtest time so Monte Carlo can assert rules haven't drifted
-- between the backtest run and the MC run.  Mismatch → MC refuses to run
-- and emits a CRITICAL audit row.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS is a no-op on re-apply.

ALTER TABLE backtests
    ADD COLUMN IF NOT EXISTS firm_rules_version TEXT;

COMMENT ON COLUMN backtests.firm_rules_version IS
    'SHA-256 (16-char hex prefix) of FIRM_CONFIGS + FIRM_RULES at backtest time. '
    'Computed by firm_rules_version.py::compute_firm_rules_version(). '
    'MC engine asserts this matches current rules before running; '
    'mismatch triggers monte_carlo.firm_rule_version_mismatch audit row and '
    'returns {status: "rule_version_mismatch"} error result.';
