-- Migration 0058: Pine export content_hash, config_snapshot, backtest_id columns
-- FIX 3: content_hash was computed by pine_compiler.py (line 648) but never written to DB,
-- making re-export drift undetectable.  This migration adds the missing columns.

-- strategy_exports: content_hash, config_snapshot, backtest_id
ALTER TABLE strategy_exports
    ADD COLUMN IF NOT EXISTS content_hash text,
    ADD COLUMN IF NOT EXISTS config_snapshot jsonb,
    ADD COLUMN IF NOT EXISTS backtest_id uuid REFERENCES backtests(id) ON DELETE SET NULL;

-- strategy_export_artifacts: content_hash (per-artifact hash for granular drift detection)
ALTER TABLE strategy_export_artifacts
    ADD COLUMN IF NOT EXISTS content_hash text;

-- Index on content_hash for fast drift-check lookups
CREATE INDEX IF NOT EXISTS strat_exports_content_hash_idx ON strategy_exports (content_hash);
CREATE INDEX IF NOT EXISTS strat_export_artifacts_content_hash_idx ON strategy_export_artifacts (content_hash);
CREATE INDEX IF NOT EXISTS strat_exports_backtest_idx ON strategy_exports (backtest_id);
