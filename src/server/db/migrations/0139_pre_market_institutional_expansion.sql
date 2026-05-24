-- Migration 0139 — Pre-Market Institutional Expansion (W25.5a)
-- Adds 18 nullable institutional fields to pre_market_sessions.
-- All columns are ADD COLUMN IF NOT EXISTS (idempotent).
-- idx 141 in _journal.json.

ALTER TABLE pre_market_sessions
  -- ── Tier 1: Internals snapshot at open (from Massive WS W25.5b) ──────────
  ADD COLUMN IF NOT EXISTS tick_open               NUMERIC,
  ADD COLUMN IF NOT EXISTS add_open                NUMERIC,
  ADD COLUMN IF NOT EXISTS vold_open               NUMERIC,
  ADD COLUMN IF NOT EXISTS trin_open               NUMERIC,

  -- ── Tier 1: Cross-asset direction (from existing Databento DXY / ZN feeds) ─
  ADD COLUMN IF NOT EXISTS dxy_direction           TEXT,
  ADD COLUMN IF NOT EXISTS us10y_direction         TEXT,
  ADD COLUMN IF NOT EXISTS cross_asset_aligned     BOOLEAN,

  -- ── Tier 1: Calendar extensions ──────────────────────────────────────────
  ADD COLUMN IF NOT EXISTS bond_auction_today      BOOLEAN,
  ADD COLUMN IF NOT EXISTS extended_calendar_events JSONB,

  -- ── Tier 1: Naked POCs (from volume-profile-service last 5–10 sessions) ───
  ADD COLUMN IF NOT EXISTS nearby_naked_pocs       JSONB,

  -- ── Tier 1: London range (03:00–08:00 ET, from 5m bars) ──────────────────
  ADD COLUMN IF NOT EXISTS london_range_high       NUMERIC,
  ADD COLUMN IF NOT EXISTS london_range_low        NUMERIC,
  ADD COLUMN IF NOT EXISTS london_range_points     NUMERIC,

  -- ── Tier 2: Flag-only levels (no gate) ───────────────────────────────────
  ADD COLUMN IF NOT EXISTS pmh                     NUMERIC,
  ADD COLUMN IF NOT EXISTS pml                     NUMERIC,
  ADD COLUMN IF NOT EXISTS pwh_iso                 NUMERIC,
  ADD COLUMN IF NOT EXISTS pwl_iso                 NUMERIC,
  ADD COLUMN IF NOT EXISTS first_30min_volume_ratio NUMERIC;

-- CHECK constraints for direction columns (flag invalid values at DB layer)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'pre_market_sessions'
      AND constraint_name = 'pre_market_sessions_dxy_direction_check'
  ) THEN
    ALTER TABLE pre_market_sessions
      ADD CONSTRAINT pre_market_sessions_dxy_direction_check
        CHECK (dxy_direction IS NULL OR dxy_direction IN ('up', 'down', 'flat'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'pre_market_sessions'
      AND constraint_name = 'pre_market_sessions_us10y_direction_check'
  ) THEN
    ALTER TABLE pre_market_sessions
      ADD CONSTRAINT pre_market_sessions_us10y_direction_check
        CHECK (us10y_direction IS NULL OR us10y_direction IN ('up', 'down', 'flat'));
  END IF;
END;
$$;
