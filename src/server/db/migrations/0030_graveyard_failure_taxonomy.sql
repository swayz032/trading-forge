-- Migration: 0030_graveyard_failure_taxonomy
-- Adds failure taxonomy columns and searchable metrics to strategy_graveyard.
-- Enables graveyard-gate to filter by category and expose structured failure data
-- to the critic, scout, and portfolio optimizer without parsing backtestSummary.

ALTER TABLE "strategy_graveyard"
  ADD COLUMN IF NOT EXISTS "failure_category" text,
  ADD COLUMN IF NOT EXISTS "failure_severity" numeric,
  ADD COLUMN IF NOT EXISTS "searchable_metrics" jsonb;

CREATE INDEX IF NOT EXISTS "graveyard_failure_category_idx"
  ON "strategy_graveyard" ("failure_category");
