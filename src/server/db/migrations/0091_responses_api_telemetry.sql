-- Migration 0091 — Pass 9 Branch A Responses API telemetry columns.
--
-- Additive only. Three nullable columns on `ai_inference_log` so the
-- model-router can distinguish Chat Completions vs Responses API calls
-- post-canary. Pre-Pass-9 rows have NULL across all three (the legacy
-- Chat Completions path is implied by api_path IS NULL).
--
-- Safe to run on production: nullable, no defaults that would rewrite
-- existing rows, no constraints that would reject historic data.

ALTER TABLE "ai_inference_log"
  ADD COLUMN IF NOT EXISTS "api_path" text;

ALTER TABLE "ai_inference_log"
  ADD COLUMN IF NOT EXISTS "reasoning_tokens" integer;

ALTER TABLE "ai_inference_log"
  ADD COLUMN IF NOT EXISTS "used_strict_schema" boolean;

-- Path-aware aggregate query support: operators compare cost + quality
-- between paths. Filtered index on non-null api_path keeps the index
-- small (Chat Completions historic rows are NULL).
CREATE INDEX IF NOT EXISTS "ai_inference_api_path_idx"
  ON "ai_inference_log" ("api_path", "created_at" DESC)
  WHERE "api_path" IS NOT NULL;
