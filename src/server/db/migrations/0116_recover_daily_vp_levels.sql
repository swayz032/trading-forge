-- Wave 23 Recovery — re-create daily_volume_profile_levels table
-- This table existed in the pre-corruption working tree but never made it
-- into a committed migration. The corruption event of 2026-05-19 02:57
-- erased the in-memory table — volume-profile-service.ts references it,
-- so Phase 9 backend startup failed with "dailyVolumeProfileLevels not
-- exported from schema.js" until this table was added.

CREATE TABLE IF NOT EXISTS daily_volume_profile_levels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol TEXT NOT NULL,
  session_date DATE NOT NULL,
  poc NUMERIC(20, 8) NOT NULL,
  vah NUMERIC(20, 8) NOT NULL,
  val NUMERIC(20, 8) NOT NULL,
  naked_pocs JSONB NOT NULL DEFAULT '[]'::jsonb,
  profile_shape TEXT NOT NULL,
  shape_confidence NUMERIC(5, 4) NOT NULL,
  ib_high NUMERIC(20, 8),
  ib_low NUMERIC(20, 8),
  ib_extension_status TEXT,
  open_classification TEXT,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS daily_vp_levels_symbol_session_idx
  ON daily_volume_profile_levels (symbol, session_date);

CREATE INDEX IF NOT EXISTS daily_vp_levels_symbol_idx
  ON daily_volume_profile_levels (symbol);

-- Audit row: entity_id is UUID-typed; schema migrations have no entity row → NULL
INSERT INTO audit_log (action, entity_type, entity_id, decision_authority, result, status, created_at)
VALUES (
  'db_migration.applied',
  'schema',
  NULL,
  'system',
  '{"migration": "0116_recover_daily_vp_levels", "table_created": "daily_volume_profile_levels", "wave": 23, "reason": "recovery from 2026-05-19 corruption"}'::jsonb,
  'success',
  NOW()
);
