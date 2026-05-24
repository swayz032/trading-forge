-- Migration 0134: Add structure_state JSONB column to bias_state (Wave 25 W25.2, 2026-05-24)
--
-- Adds a nullable JSONB column to store the independent structure validation
-- snapshot (StructureState) computed by structure_engine.py BEFORE any entry
-- trigger evaluates.
--
-- Design intent:
--   compute_structure_state() produces a StructureState dataclass; bias-state-service.ts
--   serialises it via dataclasses.asdict() and writes it here when populating a new
--   bias_state row. Stage 2 weighted scoring (W25.1 confluence-score.ts) reads
--   structure_state to compute the market_structure_aligned factor (weight 0.20).
--
-- JSON shape (matches StructureState dataclass field order):
--   {
--     "bos_recent": bool,
--     "bos_direction": "bullish" | "bearish" | null,
--     "choch_recent": bool,
--     "choch_direction": "bullish" | "bearish" | null,
--     "mss_recent": bool,
--     "mss_direction": "bullish" | "bearish" | null,
--     "mss_displacement_atr_mult": float | null,
--     "displacement_active": bool,
--     "premium_discount_zone": "premium" | "discount" | "equilibrium",
--     "htf_bias_aligned": bool,
--     "last_break_direction": "bullish" | "bearish" | null,
--     "last_break_age_bars": int | null,
--     "swing_high": float | null,
--     "swing_low": float | null,
--     "computed_at_bar_idx": int
--   }
--
-- Backward compatibility:
--   NULL default — existing bias_state rows are UNAFFECTED.
--   Strategies on Path A (per_strategy boolean) or Path B (canonical_5) continue
--   to work without structure_state. Only Path C (weighted scoring, W25.1)
--   consumes this column.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS prevents errors on repeat apply.

ALTER TABLE bias_state
  ADD COLUMN IF NOT EXISTS structure_state JSONB;

-- Index on non-null rows only — keeps it small (only rows with structure engine data)
CREATE INDEX IF NOT EXISTS bias_state_structure_state_idx
  ON bias_state (id)
  WHERE structure_state IS NOT NULL;

COMMENT ON COLUMN bias_state.structure_state IS
  'Wave 25 W25.2: JSON-serialised StructureState from structure_engine.py. '
  'NULL for pre-Wave-25 rows and when MTF data is unavailable. '
  'Shape: {bos_recent, bos_direction, choch_recent, choch_direction, '
  'mss_recent, mss_direction, mss_displacement_atr_mult, displacement_active, '
  'premium_discount_zone, htf_bias_aligned, last_break_direction, '
  'last_break_age_bars, swing_high, swing_low, computed_at_bar_idx}';
