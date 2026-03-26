-- Paper Trading Full-Potential Upgrade (Phase 1)
-- Firm-aware sessions, signal log persistence, cooldown persistence,
-- consistency rule tracking, rolling metrics

-- Gap 1: Firm-specific sessions
ALTER TABLE "paper_sessions" ADD COLUMN IF NOT EXISTS "firm_id" text;

-- Gap 3: Cooldown persistence
ALTER TABLE "paper_sessions" ADD COLUMN IF NOT EXISTS "last_signal_time" timestamp;
ALTER TABLE "paper_sessions" ADD COLUMN IF NOT EXISTS "cooldown_until" timestamp;

-- Gap 4: Consistency rule tracking
ALTER TABLE "paper_sessions" ADD COLUMN IF NOT EXISTS "daily_pnl_breakdown" jsonb DEFAULT '{}';

-- Gap 5: Rolling metrics snapshot
ALTER TABLE "paper_sessions" ADD COLUMN IF NOT EXISTS "metrics_snapshot" jsonb DEFAULT '{}';

-- Gap 2: Signal log persistence (detailed signal logs with indicator snapshots)
CREATE TABLE IF NOT EXISTS "paper_signal_logs" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "session_id" uuid NOT NULL REFERENCES "paper_sessions"("id") ON DELETE CASCADE,
    "symbol" text NOT NULL,
    "direction" text NOT NULL,
    "signal_type" text,
    "confidence" numeric,
    "price" numeric,
    "indicator_snapshot" jsonb,
    "acted" boolean DEFAULT false,
    "reason" text,
    "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "paper_signal_logs_session_idx" ON "paper_signal_logs" ("session_id");
CREATE INDEX IF NOT EXISTS "paper_signal_logs_created_idx" ON "paper_signal_logs" ("created_at");
