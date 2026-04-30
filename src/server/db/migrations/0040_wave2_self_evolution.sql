-- Wave 2: Self-Evolution — model tracking in system journal
ALTER TABLE "system_journal" ADD COLUMN IF NOT EXISTS "generated_by_model" text;
ALTER TABLE "system_journal" ADD COLUMN IF NOT EXISTS "generated_by_provider" text;
