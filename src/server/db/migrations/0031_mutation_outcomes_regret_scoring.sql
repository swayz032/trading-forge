-- Migration: 0031_mutation_outcomes_regret_scoring
-- Phase 2.2: Mutation Impact Tracking — new mutation_outcomes table
-- Phase 2.4: Regret Scoring — new columns on skip_decisions and deepar_forecasts

-- ─── Phase 2.2: Mutation Outcomes ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "mutation_outcomes" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "strategy_id"      uuid REFERENCES "strategies"("id"),
  "parent_archetype" text,
  "mutation_type"    text,
  "param_name"       text,
  "direction"        text,
  "magnitude"        numeric,
  "parent_metrics"   jsonb,
  "child_metrics"    jsonb,
  "improvement"      numeric,
  "regime"           text,
  "success"          boolean,
  "created_at"       timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "mutation_outcomes_strategy_idx"
  ON "mutation_outcomes" ("strategy_id");

CREATE INDEX IF NOT EXISTS "mutation_outcomes_type_idx"
  ON "mutation_outcomes" ("mutation_type");

CREATE INDEX IF NOT EXISTS "mutation_outcomes_success_idx"
  ON "mutation_outcomes" ("success");

CREATE INDEX IF NOT EXISTS "mutation_outcomes_regime_idx"
  ON "mutation_outcomes" ("regime");

-- ─── Phase 2.4: Regret Scoring — skip_decisions ──────────────────────────────
ALTER TABLE "skip_decisions"
  ADD COLUMN IF NOT EXISTS "regret_score"      numeric,
  ADD COLUMN IF NOT EXISTS "opportunity_cost"  numeric;

-- ─── Phase 2.4: Regret Scoring — deepar_forecasts ────────────────────────────
ALTER TABLE "deepar_forecasts"
  ADD COLUMN IF NOT EXISTS "regret_score"      numeric,
  ADD COLUMN IF NOT EXISTS "magnitude_error"   numeric;
