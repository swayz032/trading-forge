-- ═══════════════════════════════════════════════════════════════════════════════
-- 0062: Pine Version Default v6 → v5 (schema ↔ runtime alignment)
-- ═══════════════════════════════════════════════════════════════════════════════
-- The Pine compiler (src/server/services/pine-export-service.ts +
-- src/engine/pine_compiler.py) emits Pine v5 strategy/indicator artifacts.
-- The schema default for strategy_exports.pine_version and
-- strategy_export_artifacts.pine_version was historically "v6" — an aspirational
-- target. No v6-only feature is used in the emitted code, and existing artifacts
-- already contain a "//@version=5" annotation, so the row default is the only
-- thing out of sync.
--
-- This migration:
--   1. Switches the column DEFAULT to 'v5' so future inserts that omit the field
--      record the truth.
--   2. Backfills existing rows that carry 'v6' so dashboard/export consumers
--      stop reading a misleading version string.
--
-- Idempotent: SET DEFAULT is always safe; the UPDATE only touches rows still
-- on 'v6' (no-op if backfill already ran or no v6 rows exist).

ALTER TABLE "strategy_exports" ALTER COLUMN "pine_version" SET DEFAULT 'v5';
--> statement-breakpoint

ALTER TABLE "strategy_export_artifacts" ALTER COLUMN "pine_version" SET DEFAULT 'v5';
--> statement-breakpoint

UPDATE "strategy_exports" SET "pine_version" = 'v5' WHERE "pine_version" = 'v6';
--> statement-breakpoint

UPDATE "strategy_export_artifacts" SET "pine_version" = 'v5' WHERE "pine_version" = 'v6';
