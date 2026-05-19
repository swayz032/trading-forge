-- Add missing indexes for paper trade queries and backtest composite lookups

-- Paper trades: symbol, exit time, and created_at for scheduler queries
CREATE INDEX IF NOT EXISTS paper_trades_symbol_idx ON paper_trades (symbol);
CREATE INDEX IF NOT EXISTS paper_trades_exit_time_idx ON paper_trades (exit_time);
CREATE INDEX IF NOT EXISTS paper_trades_created_idx ON paper_trades (created_at);

-- Backtests: composite indexes for common (strategyId + status) and (strategyId + tier) queries
CREATE INDEX IF NOT EXISTS backtests_strategy_status_idx ON backtests (strategy_id, status);
CREATE INDEX IF NOT EXISTS backtests_strategy_tier_idx ON backtests (strategy_id, tier);
