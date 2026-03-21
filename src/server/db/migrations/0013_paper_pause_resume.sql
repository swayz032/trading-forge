-- Paper Trading Pause/Resume (Gap 9)
-- Missing from 0011: paused_at column for pause/resume session support

ALTER TABLE "paper_sessions" ADD COLUMN IF NOT EXISTS "paused_at" timestamp;
