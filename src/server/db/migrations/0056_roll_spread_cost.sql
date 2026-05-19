-- Migration 0055: Add roll_spread_cost column to paper_trades
-- Records the estimated calendar spread cost applied when a paper position
-- held across one or more CME contract roll dates.
-- Nullable: null = cost not yet evaluated (pre-migration rows) or 0 = no roll crossed.
-- Parity: closes the paper/backtest gap where backtest uses ratio-adjusted
-- continuous contracts (no roll cost) but paper holds real contracts across rolls.
ALTER TABLE paper_trades ADD COLUMN IF NOT EXISTS roll_spread_cost NUMERIC;
