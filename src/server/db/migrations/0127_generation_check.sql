-- 0127_generation_check.sql
--
-- Track A F-9: domain CHECK on strategies.generation
--
-- generation enumerates scout → graduator lineage depth:
--   0 = root (direct scout extract)
--   1 = first child (graduator-produced)
--   2 = grandchild
--   3 = great-grandchild (terminal — Wave 23 caps lineage depth)
--
-- Without this CHECK the column accepts any int, including -1 and 999, which
-- silently breaks lineage analytics and graduator routing.
--
-- Idempotent: re-running on a DB that already has the constraint is a no-op.
-- Wrapped in DO $$ ... EXCEPTION WHEN duplicate_object THEN NULL block so
-- repeat applies (operator re-running migrations, drift recovery) don't error.

DO $$
BEGIN
  ALTER TABLE strategies
    ADD CONSTRAINT strategies_generation_check
    CHECK (generation BETWEEN 0 AND 3);
EXCEPTION
  WHEN duplicate_object THEN
    -- Constraint already exists — re-apply is a no-op
    NULL;
  WHEN undefined_column THEN
    -- generation column not present (very old DB snapshot); migration is a
    -- no-op until the column-creating migration is applied
    NULL;
END $$;
