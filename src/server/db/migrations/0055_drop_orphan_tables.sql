-- 0055: Drop orphan tables (verified zero readers/writers in 2026-04 audit)
--
-- These tables were declared in schema but never wired into any code path:
--   - market_data_meta: never written or read (resolveDataRange uses DuckDB queryInfo
--     against S3 directly; symbol selection happens via strategy.symbol + firm-config)
--   - watchlist: never written or read (no service, no route, no scheduler reference)
--   - portfolio_snapshots: written by portfolio-optimizer-service.ts but never read
--     (the SSE broadcast carries the snapshot to consumers; no historical query path)
--
-- Drop with IF EXISTS for idempotency. CASCADE for dependent indexes/constraints.
-- See feedback memory: drops are conservative — re-grepped Node, Python, n8n, frontend
-- and dist before removal.

DROP TABLE IF EXISTS "market_data_meta" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "watchlist" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "portfolio_snapshots" CASCADE;
