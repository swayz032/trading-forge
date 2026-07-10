-- W23G.11 (2026-05-19): Multi-indicator + multi-timeframe DSL support
-- strategies.config is JSONB; no DDL needed for new keys — the new fields
-- (confirming_indicators, bias_timeframe, bias_condition, min_factors_satisfied,
-- primary_indicator, execution_timeframe) are purely JSONB extensions.
-- This migration adds observability indexes only.

-- Index: strategies that have confirming_indicators (confluence strategies)
-- deep-scan grammar fix: Postgres's index_elem grammar requires an extra wrapping
-- paren when the indexed expression is itself a boolean predicate ending in
-- IS [NOT] NULL — `ON t ((expr) IS NOT NULL)` is a syntax error ("syntax error at
-- or near IS", verified empirically against PGlite); the fix is the double-paren
-- form `ON t (((expr) IS NOT NULL))`. CREATE INDEX IF NOT EXISTS keeps this
-- idempotent-safe to re-apply regardless of hash.
CREATE INDEX IF NOT EXISTS idx_strategies_has_confluence
  ON strategies (((config->'confirming_indicators') IS NOT NULL))
  WHERE (config->'confirming_indicators') IS NOT NULL;

-- Index: strategies that have a bias_timeframe (multi-timeframe strategies)
CREATE INDEX IF NOT EXISTS idx_strategies_has_mtf
  ON strategies ((config->>'bias_timeframe'))
  WHERE config->>'bias_timeframe' IS NOT NULL;
