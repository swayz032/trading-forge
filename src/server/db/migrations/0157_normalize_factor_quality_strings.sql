-- Wave 26 Pass H Phase 1 (2026-05-26) — normalize double-JSON-encoded factor_quality
--
-- Root cause: scripts/wave26-pass-g-b3-backfill-factor-quality-audit.ts wrote
--   ${JSON.stringify(s.quality)}::jsonb
-- where s.quality is a bare string like "rich". postgres-js auto-encodes JS strings
-- at the parameter boundary, and JSON.stringify adds another encode → the stored
-- JSONB value became a JSONB string containing literal quote characters (e.g.
-- the JSONB string `"rich"` instead of bare `rich`). config->'entry_quality'->>'factor_quality'
-- consequently returns `"rich"` (with quotes) instead of `rich`, breaking
-- distribution queries + downstream consumers that do string-equality on bare values.
--
-- Fix:
--   1. Backfill writer corrected to use to_jsonb(${quality}::text) (commit alongside
--      this migration).
--   2. This migration strips leading + trailing literal quote characters from
--      the affected rows so the stored JSONB string equals the bare value.
--
-- Idempotent: the regex only matches strings that begin AND end with a literal `"`
-- character — re-running does nothing because after the first run no row matches
-- the IN clause AND the regex would also no-op (`^"(.*)"$` doesn't match `rich`).
--
-- Safe-by-construction: the migration touches ONLY rows where the stored text
-- (after `->>`) is exactly `"rich"`, `"thin"`, or `"fallback_only"` (with quote
-- characters). Bare `rich` / `thin` / `fallback_only` rows are NOT touched.

UPDATE strategies
SET config = jsonb_set(
  config,
  '{entry_quality,factor_quality}',
  to_jsonb(REGEXP_REPLACE(config->'entry_quality'->>'factor_quality', '^"(.*)"$', '\1'))
)
WHERE config->'entry_quality'->>'factor_quality' IN ('"rich"', '"thin"', '"fallback_only"');
