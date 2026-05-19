-- Add performance indexes for common query patterns
CREATE INDEX IF NOT EXISTS "monte_carlo_runs_backtest_id_idx" ON "monte_carlo_runs" USING btree ("backtest_id");
CREATE INDEX IF NOT EXISTS "stress_test_runs_backtest_id_idx" ON "stress_test_runs" USING btree ("backtest_id");
CREATE INDEX IF NOT EXISTS "strategies_lifecycle_state_idx" ON "strategies" USING btree ("lifecycle_state");
CREATE INDEX IF NOT EXISTS "alerts_type_idx" ON "alerts" USING btree ("type");
CREATE INDEX IF NOT EXISTS "alerts_severity_idx" ON "alerts" USING btree ("severity");
CREATE INDEX IF NOT EXISTS "watchlist_active_idx" ON "watchlist" USING btree ("active");
