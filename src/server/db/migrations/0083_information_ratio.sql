-- A13: Information Ratio metric (W18 Team A Step 1)
-- Adds information_ratio column to backtests table.
--
-- IR = E[R_p - R_b] / σ_diff * sqrt(252)
-- where R_p = strategy daily P&L, R_b = benchmark daily return (SPX for
-- index futures ES/NQ/MES/MNQ; crude price for MCL), σ_diff = std dev of
-- (R_p - R_b) active return series.
--
-- Null when:
--   - Benchmark data unavailable or fewer than 2 bars
--   - Pre-A13 backtests (not retroactively populated)
--
-- Apply via direct SQL on Railway (drizzle-kit broken for this repo):
--   psql $DATABASE_URL -c "$(cat 0083_information_ratio.sql)"
--
-- Drizzle schema counterpart: backtests.informationRatio (schema.ts)

ALTER TABLE backtests ADD COLUMN IF NOT EXISTS information_ratio numeric;

COMMENT ON COLUMN backtests.information_ratio IS
  'A13 IR: annualised (R_p - R_b) / σ_diff * sqrt(252). '
  'Benchmark: SPX close-to-close for ES/NQ/MES/MNQ; crude for MCL. '
  'Null for pre-A13 backtests or when < 2 benchmark bars available.';
