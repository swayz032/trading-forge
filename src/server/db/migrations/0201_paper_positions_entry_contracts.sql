-- 0201 (fresh-scan HIGH#5, 2026-07-12): record the position's ENTRY (original) contract count on
-- paper_positions so the Style C scale-out splits 33/33/34 of the ORIGINAL size instead of cascading
-- 33% of a SHRINKING remainder. The old logic (TP1 floor(N*0.33) → decrement → TP2 floor(remainder*0.33))
-- booked ~22/22/56 for N=9 vs the backtester's 33/33/34, over-weighting the runner (the leg most exposed
-- to give-back on the Chandelier trail + 15:55 flatten) and diverging paper P&L from the backtest the
-- strategy was validated on — feeding B14/WFE promotion inputs + the slumdawg A/B deltas.
-- Nullable + idempotent (ADD COLUMN IF NOT EXISTS); safe to re-apply. Legacy/in-flight rows stay NULL
-- and the scale-out falls back to the pre-fix remainder behavior for them (no backfill — only positions
-- opened after this deploy carry the value, and open positions at deploy are few/none pre-live).
ALTER TABLE paper_positions ADD COLUMN IF NOT EXISTS entry_contracts INTEGER;
