-- Migration 0150: Migrate multi_confluence_short_setup strategies to ict_bias_aligned_continuation archetype
--
-- Context (2026-05-26):
-- Three strategies graduated with entry_indicator="ema_crossover" and direction="short"
-- because Gemma couldn't fit the 4H bias → 15m BOS → 5m FVG pattern into any existing archetype.
-- The new ict_bias_aligned_continuation archetype (Wave 26 Pass G) is the correct home.
--
-- Changes per strategy:
--   config.entry_indicator:        "ema_crossover"                    → "archetype:ict_bias_aligned_continuation"
--   config.strategy.entry_long:    "high < low" (sentinel)            → "high < low" (sentinel, unchanged — archetype path)
--   config.strategy.entry_short:   "ema_9 crosses_below ema_21"      → "high < low" (sentinel — archetype path)
--   config.direction:              "short"                            → "both"
--   config.primary_indicator:      "ema_crossover"                    → "archetype:ict_bias_aligned_continuation"
--   config.metadata.routing_mode:  "parametric_indicator"             → "structural_archetype"
--   config.entry_archetype:        (absent)                           → "ict_bias_aligned_continuation"
--
-- Affected strategies:
--   multi_confluence_short_setup_mes_5m  (e80fe4a7-f446-464b-8d50-bc5b16325d26)
--   multi_confluence_short_setup_mnq_5m  (22ed1ab9-c4d2-4c19-a4cf-96ecc0cd0892)
--   multi_confluence_short_setup_mcl_5m  (9f7393de-e621-48c7-adfd-1bb37998b4f8)
--
-- Idempotent: safe to re-run — JSONB path updates are no-ops if the value already matches.
--
-- Note on MCL: MCL uses 18 base contracts (MES/MNQ use 6). The liquidity_comfort_cap
-- for MCL is 30. These values are set by framework-overlay.ts at graduation time and
-- are preserved here as-is — this migration only touches entry routing fields.

UPDATE strategies
SET config = jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(
          jsonb_set(
            jsonb_set(
              jsonb_set(config,
                '{entry_indicator}',     '"archetype:ict_bias_aligned_continuation"'),
              '{primary_indicator}',     '"archetype:ict_bias_aligned_continuation"'),
            '{direction}',               '"both"'),
          '{entry_archetype}',           '"ict_bias_aligned_continuation"'),
        '{strategy,entry_long}',         '"high < low"'),
      '{strategy,entry_short}',          '"high < low"'),
    '{metadata,routing_mode}',           '"structural_archetype"')
WHERE name IN (
  'multi_confluence_short_setup_mes_5m',
  'multi_confluence_short_setup_mnq_5m',
  'multi_confluence_short_setup_mcl_5m'
);

-- Also clear the confirming_indicators list (it was set to ['structural_setup','regime_match']
-- which is correct for the weighted-scoring path, but the archetype path does not
-- compile confirming_indicators — leave them in place as metadata, just note the archetype.
-- No change needed for confirming_indicators: they are entry_quality metadata, not compiled.

-- Audit: stamp the update so lifecycle knows why the config changed
-- (uses the standard audit_log pattern from CLAUDE.md §10b)
INSERT INTO audit_log (action, decision_authority, input, result, status, created_at)
VALUES (
  'graduation.archetype_retrofix',
  'operator',
  jsonb_build_object(
    'migration',        '0150_multi_confluence_archetype_migration',
    'strategies',       '["multi_confluence_short_setup_mes_5m","multi_confluence_short_setup_mnq_5m","multi_confluence_short_setup_mcl_5m"]',
    'from_indicator',   'ema_crossover',
    'from_direction',   'short',
    'reason',           'Archetype ict_bias_aligned_continuation shipped (Wave 26 Pass G). Gemma extracted 4H-bias+BOS+FVG pattern but had no archetype target — fell back to ema_crossover. Corrected post-archetype-creation.'
  ),
  jsonb_build_object(
    'to_indicator',     'archetype:ict_bias_aligned_continuation',
    'to_direction',     'both',
    'to_routing_mode',  'structural_archetype'
  ),
  'success',
  NOW()
);
