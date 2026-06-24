-- Migration 0151: Re-route 6 mis-mapped MA-as-S/R strategies to bounce_off_level archetype
--
-- Background (2026-05-26): When these 6 strategies were graduated, the MA-as-S/R
-- concept class had no dedicated archetype. The graduator routed them to ema_crossover
-- (a MA-vs-MA cross archetype) which is semantically incorrect — these strategies are
-- price-bounces-off-single-MA (S/R level), not two-MA-cross patterns.
--
-- The fix: bounce_off_level archetype is now live in the engine
-- (src/engine/strategies/bounce_off_level.py) and registered in ARCHETYPE_REGISTRY.
-- This migration flips the 6 affected strategies to use the correct archetype.
--
-- SCHEMA NOTE (2026-05-26 architect close-out): the `strategies` table has NO
-- top-level `entry_indicator` or `strategy_class` columns. Both values live inside
-- the `config` JSONB column. An earlier draft of this file referenced top-level
-- columns and would crash the boot-time migration runner. This corrected version
-- mutates the JSONB only — matching how the rest of the codebase reads the values
-- (graduator + paper-signal-service dispatch on `config.entry_indicator`).
--
-- Idempotent: WHERE clauses filter by the post-mutation JSONB shape; safe to re-run.
-- Strategies are NOT graveyarded — they remain in their current lifecycle state.
-- The backtester will now route them via BounceOffLevelStrategy instead of
-- the dual-EMA compile path.
--
-- Affected strategies:
--   200_ma_ceiling_floor_mes_15m  — 200 SMA as dynamic S/R on MES 15m
--   200_ma_ceiling_floor_mnq_15m  — 200 SMA as dynamic S/R on MNQ 15m
--   200_ma_ceiling_floor_mcl_15m  — 200 SMA as dynamic S/R on MCL 15m
--   trendline_bounce_setup_mes_4h — trendline/MA bounce on MES 4h
--   trendline_bounce_setup_mnq_4h — trendline/MA bounce on MNQ 4h
--   trendline_bounce_setup_mcl_4h — trendline/MA bounce on MCL 4h

-- Step 1: Update config.entry_indicator JSONB from ema_crossover to archetype:bounce_off_level
UPDATE strategies
SET
  config = jsonb_set(
    config,
    '{entry_indicator}',
    '"archetype:bounce_off_level"'
  ),
  updated_at = NOW()
WHERE name IN (
  '200_ma_ceiling_floor_mes_15m',
  '200_ma_ceiling_floor_mnq_15m',
  '200_ma_ceiling_floor_mcl_15m',
  'trendline_bounce_setup_mes_4h',
  'trendline_bounce_setup_mnq_4h',
  'trendline_bounce_setup_mcl_4h'
)
AND (
  config->>'entry_indicator' = 'ema_crossover'
  OR config->>'entry_indicator' IS NULL
);

-- Step 2: Update config.strategy_class JSONB to point at the new Python handler
UPDATE strategies
SET
  config = jsonb_set(
    config,
    '{strategy_class}',
    '"src.engine.strategies.bounce_off_level.BounceOffLevelStrategy"'
  ),
  updated_at = NOW()
WHERE name IN (
  '200_ma_ceiling_floor_mes_15m',
  '200_ma_ceiling_floor_mnq_15m',
  '200_ma_ceiling_floor_mcl_15m',
  'trendline_bounce_setup_mes_4h',
  'trendline_bounce_setup_mnq_4h',
  'trendline_bounce_setup_mcl_4h'
)
AND config->>'entry_indicator' = 'archetype:bounce_off_level';

-- Step 3: Update config.entry_params to match bounce_off_level canonical defaults.
-- The ema_crossover params (fast_period, slow_period) are wrong for this archetype.
-- Replace with bounce_off_level canonical: ma_period derived from strategy name.
UPDATE strategies
SET
  config = jsonb_set(
    config,
    '{entry_params}',
    '{"ma_period": 200, "ma_type": "sma", "direction": "both", "rejection_pattern": "any_close_back_through", "proximity_atr_mult": 1.0}'::jsonb
  ),
  updated_at = NOW()
WHERE name IN (
  '200_ma_ceiling_floor_mes_15m',
  '200_ma_ceiling_floor_mnq_15m',
  '200_ma_ceiling_floor_mcl_15m'
)
AND config->>'entry_indicator' = 'archetype:bounce_off_level';

-- trendline_bounce strategies also use 200 SMA as their primary dynamic level
-- (trendline bounce and MA bounce are compiled via the same engine archetype)
UPDATE strategies
SET
  config = jsonb_set(
    config,
    '{entry_params}',
    '{"ma_period": 200, "ma_type": "sma", "direction": "both", "rejection_pattern": "any_close_back_through", "proximity_atr_mult": 1.5}'::jsonb
  ),
  updated_at = NOW()
WHERE name IN (
  'trendline_bounce_setup_mes_4h',
  'trendline_bounce_setup_mnq_4h',
  'trendline_bounce_setup_mcl_4h'
)
AND config->>'entry_indicator' = 'archetype:bounce_off_level';

-- Step 4: Emit audit_log rows for traceability
-- (Each row represents one strategy that was corrected)
-- FIX 2026-06-22: audit_log has NO `payload` column (cols are input/result) and
-- `status` is NOT NULL. The original (action, decision_authority, payload, created_at)
-- INSERT threw "column payload does not exist", rolling back the whole migration and
-- blocking the boot-migration-runner on EVERY boot (fail-closed) — stranding all
-- later migrations (0166/0167/0168/0169). Corrected to the real schema.
INSERT INTO audit_log (action, decision_authority, input, status, created_at)
SELECT
  'migration.bounce_off_level_archetype_reroute',
  'system',
  jsonb_build_object(
    'strategy_name', name,
    'previous_indicator', 'ema_crossover',
    'new_indicator', 'archetype:bounce_off_level',
    'migration', '0151',
    'reason', 'MA-as-S/R concept incorrectly routed to ema_crossover; corrected to bounce_off_level (2026-05-26)'
  ),
  'success',
  NOW()
FROM strategies
WHERE name IN (
  '200_ma_ceiling_floor_mes_15m',
  '200_ma_ceiling_floor_mnq_15m',
  '200_ma_ceiling_floor_mcl_15m',
  'trendline_bounce_setup_mes_4h',
  'trendline_bounce_setup_mnq_4h',
  'trendline_bounce_setup_mcl_4h'
)
AND config->>'entry_indicator' = 'archetype:bounce_off_level';

-- Verify: operator can check with:
-- SELECT name, config->>'entry_indicator' AS entry_indicator, config->>'strategy_class' AS strategy_class
-- FROM strategies WHERE name LIKE '%ma_ceiling%' OR name LIKE '%trendline_bounce%';
