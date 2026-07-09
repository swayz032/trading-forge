-- ds21-w2 (deep-scan #21 Band D): add correlation_id to paper_signal_logs so per-bar signal
-- telemetry participates in the bar→handler→DB→SSE→audit trace-reconstruction chain (§2 mandate).
-- Nullable + idempotent; legacy rows and insert sites without correlationId in scope stay null.
ALTER TABLE paper_signal_logs ADD COLUMN IF NOT EXISTS correlation_id TEXT;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS paper_signal_logs_correlation_idx ON paper_signal_logs (correlation_id);
