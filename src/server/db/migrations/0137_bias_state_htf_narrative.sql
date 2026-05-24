-- Migration 0137: Add htf_narrative JSONB column to bias_state (Wave 25 P2.A3 W25.5, 2026-05-24)
--
-- Adds a nullable JSONB column to persist the HTF narrative state computed by
-- htf_narrative.py (backtest-core P2.A1+A2) per session. The TypeScript
-- bias-state-service persists the HtfNarrative value here when the Python compute
-- returns a non-null result.
--
-- Design intent:
--   compute_htf_narrative() (Python) produces an HtfNarrative dataclass covering:
--     AsianRange { high, low, range_size, formed_at_bar_idx }
--     LondonBias { direction, swept_pdh, swept_pdl }
--     NYBias     { direction, open_above_overnight_range, open_below_overnight_range }
--     DailyDealing { dealing_range_high, dealing_range_low, current_quadrant }
--
--   bias-state-service.ts serialises it via dataclasses.asdict() and writes it here
--   when populating a new bias_state row. The column is consumed by the weighted
--   confluence scorer (W25.1 confluence-score.ts) via market_structure_aligned and
--   future HTF-bias-alignment factors.
--
-- JSON shape (matches HtfNarrative dataclass after dataclasses.asdict()):
--   {
--     "asian_range": {
--       "high": float | null,
--       "low": float | null,
--       "range_size": float | null,
--       "formed_at_bar_idx": int | null
--     },
--     "london_bias": {
--       "direction": "bullish" | "bearish" | null,
--       "swept_pdh": bool,
--       "swept_pdl": bool
--     },
--     "ny_bias": {
--       "direction": "bullish" | "bearish" | null,
--       "open_above_overnight_range": bool,
--       "open_below_overnight_range": bool
--     },
--     "daily_dealing": {
--       "dealing_range_high": float | null,
--       "dealing_range_low": float | null,
--       "current_quadrant": "premium_upper" | "premium_lower" | "discount_upper" | "discount_lower" | "equilibrium" | null
--     },
--     "computed_at_bar_idx": int
--   }
--
-- Backward compatibility:
--   NULL default — all existing bias_state rows are UNAFFECTED.
--   Strategies on Path A (per_strategy boolean) or Path B (canonical_5) continue
--   to operate without htf_narrative. Only strategies declaring 5-TF hierarchy
--   (W25.4) will populate this column.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS prevent errors
-- on repeat apply.

ALTER TABLE bias_state
  ADD COLUMN IF NOT EXISTS htf_narrative JSONB DEFAULT NULL;

-- Partial index: only indexes rows where htf_narrative is populated —
-- keeps index size small since most pre-Wave-25 rows will be NULL.
CREATE INDEX IF NOT EXISTS idx_bias_state_htf_narrative
  ON bias_state (id)
  WHERE htf_narrative IS NOT NULL;

COMMENT ON COLUMN bias_state.htf_narrative IS
  'Wave 25 P2.A3 W25.5: JSON-serialised HtfNarrative from htf_narrative.py. '
  'NULL for pre-Wave-25 rows and when 5-TF data unavailable. '
  'Shape: {asian_range:{high,low,range_size,formed_at_bar_idx}, '
  'london_bias:{direction,swept_pdh,swept_pdl}, '
  'ny_bias:{direction,open_above_overnight_range,open_below_overnight_range}, '
  'daily_dealing:{dealing_range_high,dealing_range_low,current_quadrant}, '
  'computed_at_bar_idx}';
