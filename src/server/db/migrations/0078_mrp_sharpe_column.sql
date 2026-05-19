-- Migration 0078: B10 — Minimum Regime Performance (MRP) column
--
-- Adds mrp_sharpe (numeric) and mrp_regime_breakdown (jsonb) to the backtests table.
--
-- mrp_sharpe: the MINIMUM Sharpe ratio across all macro-regime groups in a backtest.
--   Per Alexander-Fabozzi (2026): best single metric for detecting regime-conditional
--   fragility. A strategy with mrp_sharpe < 0.5 works only in favourable regimes —
--   it will fail when the market regime rotates.
--
-- mrp_regime_breakdown: {regime: sharpe} dict for audit and dashboard display.
--   Example: {"RISK_ON": 1.8, "RISK_OFF": 0.3, "TRANSITION": 0.9}
--   The minimum value across all keys is mrp_sharpe.
--
-- Null means the computation has not run yet (e.g., backtests pre-B10 or backtests
-- with no trade macroRegime data). The lifecycle gate handles null gracefully as
-- "no data — log advisory, never block".
--
-- Apply via direct SQL on Railway (drizzle-kit generate is disabled per project convention).

ALTER TABLE backtests
  ADD COLUMN IF NOT EXISTS mrp_sharpe numeric,
  ADD COLUMN IF NOT EXISTS mrp_regime_breakdown jsonb;

COMMENT ON COLUMN backtests.mrp_sharpe IS
  'B10: Minimum Regime Performance — worst per-regime Sharpe across macro regimes. Null until computed post-backtest.';

COMMENT ON COLUMN backtests.mrp_regime_breakdown IS
  'B10: per-regime Sharpe breakdown {regime: sharpe}. The minimum value equals mrp_sharpe.';
