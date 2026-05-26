-- Migration 0153: Add AUTOPAUSE_DD_VELOCITY pipeline mode encoding
--
-- pipeline_mode is stored as a numeric string in system_parameters.current_value.
-- Existing encoding (migration 0045):
--   0 = PAUSED
--   1 = ACTIVE
--   2 = VACATION
-- This migration adds:
--   3 = AUTOPAUSE_DD_VELOCITY  — system-triggered pause due to drawdown velocity breach
--
-- Recovery from AUTOPAUSE_DD_VELOCITY is manual operator only.
-- The dd-velocity-gate.ts service writes this mode; the admin clear endpoint
-- (POST /api/admin/pipeline/resume) is the only sanctioned recovery path.
--
-- No schema table change required — system_parameters.current_value is TEXT
-- and accepts any string. This migration is a comment/doc migration that ensures
-- the boot-migration-runner records the mode extension in the migration history.
--
-- Idempotent: safe to run multiple times (no DDL changes).

DO $$
BEGIN
  -- Document the new mode encoding in system_parameters description if the row exists.
  UPDATE system_parameters
  SET description = 'Pipeline execution mode: 0=PAUSED, 1=ACTIVE, 2=VACATION, 3=AUTOPAUSE_DD_VELOCITY'
  WHERE param_name = 'pipeline_mode';
  -- If no row exists yet, the default insert path in pipeline-control-service.ts will
  -- create it with the updated description at next setMode() call.
END;
$$;
