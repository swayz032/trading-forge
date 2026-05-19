-- Migration: 0033_artifact_content_hash
-- Adds content_hash column to strategy_export_artifacts table.
-- Persists the SHA-256 hash computed by pine_compiler.py for artifact integrity tracking.

ALTER TABLE "strategy_export_artifacts"
  ADD COLUMN IF NOT EXISTS "content_hash" text;
