-- Migration 0093: daily_volume_profile_levels
-- Track 2 (Volume Profile EXPANDED) — service layer persistence.
-- Stores POC/VAH/VAL, naked POCs, profile shape, IB, and open classification
-- per symbol per session date. Computed daily at 5:30 PM ET after RTH close.

-- UP
CREATE TABLE daily_volume_profile_levels (
  id BIGSERIAL PRIMARY KEY,
  symbol TEXT NOT NULL,
  session_date DATE NOT NULL,
  poc NUMERIC(12,4) NOT NULL,
  vah NUMERIC(12,4) NOT NULL,
  val NUMERIC(12,4) NOT NULL,
  naked_pocs JSONB NOT NULL DEFAULT '[]',          -- [{price: float, source_date: date}]
  profile_shape TEXT NOT NULL,                      -- 'D' | 'b' | 'P' | 'Thin'
  shape_confidence NUMERIC(5,4) NOT NULL,
  ib_high NUMERIC(12,4),
  ib_low NUMERIC(12,4),
  ib_extension_status TEXT,                         -- 'IB_HOLD' | 'IB_EXTENSION_UP' | 'IB_EXTENSION_DOWN' | 'IB_EXTENSION_BOTH'
  open_classification TEXT,                         -- 'Open-In-Value' | 'Open-Outside-Value-Up' | 'Open-Outside-Value-Down' | 'Open-Outside-Range'
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(symbol, session_date)
);

CREATE INDEX idx_vp_levels_symbol_date ON daily_volume_profile_levels(symbol, session_date DESC);
CREATE INDEX idx_vp_levels_shape ON daily_volume_profile_levels(profile_shape);

-- DOWN
-- DROP INDEX IF EXISTS idx_vp_levels_shape;
-- DROP INDEX IF EXISTS idx_vp_levels_symbol_date;
-- DROP TABLE IF EXISTS daily_volume_profile_levels;
