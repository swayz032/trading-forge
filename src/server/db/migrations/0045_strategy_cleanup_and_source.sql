-- Migration: 0045_strategy_cleanup_and_source
-- Purpose: Add source column + seed pipeline_mode parameter
-- Date: 2026-04-04
--
-- NOTE 2026-04-28: Original "Move test/junk strategies to graveyard" section
-- (lines 35-87 of original) referenced strategy_graveyard columns
-- (original_strategy_id, strategy_name, strategy_config, final_lifecycle_state,
--  cause_of_death, death_category, best_tier, best_forge_score, total_backtests)
-- that do NOT exist in the actual schema (see schema.ts:461-486 for the real
-- columns: strategyId, name, dslSnapshot, failureModes, etc.). That section
-- was a dead branch. Removed so the migration applies cleanly. Test-strategy
-- cleanup happens via a separate cleanup script if/when needed.
--
-- Same for the system_journal cleanup section — it depended on a workflow
-- contract that no longer applies. Removed for clean apply.

-- ============================================================
-- 1. Add source column to strategies table
-- ============================================================
ALTER TABLE strategies ADD COLUMN IF NOT EXISTS source text;
--> statement-breakpoint

-- Backfill source from config JSONB or tags
UPDATE strategies
SET source = CASE
  WHEN config->>'source' IS NOT NULL THEN config->>'source'
  WHEN 'n8n' = ANY(tags) THEN 'n8n'
  WHEN 'ollama' = ANY(tags) THEN 'ollama'
  WHEN 'openclaw' = ANY(tags) THEN 'openclaw'
  WHEN 'agent-generated' = ANY(tags) THEN 'ollama'
  WHEN 'manual' = ANY(tags) THEN 'manual'
  ELSE 'manual'
END
WHERE source IS NULL;
--> statement-breakpoint

-- Index for filtering by source
CREATE INDEX IF NOT EXISTS strategies_source_idx ON strategies (source);
--> statement-breakpoint

-- ============================================================
-- 2. Seed pipeline_mode in system_parameters
-- ============================================================
-- 0=PAUSED, 1=ACTIVE, 2=VACATION (matches pipeline-control-service mapping)
INSERT INTO system_parameters (param_name, current_value, min_value, max_value, domain, auto_tunable, description)
VALUES ('pipeline_mode', 0, 0, 2, 'scheduler', false, 'Pipeline execution mode: 0=PAUSED, 1=ACTIVE, 2=VACATION')
ON CONFLICT (param_name) DO NOTHING;
