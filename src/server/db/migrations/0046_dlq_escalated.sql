-- Wave 1.3: Add escalated column to dead_letter_queue
ALTER TABLE "dead_letter_queue" ADD COLUMN IF NOT EXISTS "escalated" boolean DEFAULT false NOT NULL;
CREATE INDEX IF NOT EXISTS "dlq_escalated_idx" ON "dead_letter_queue" ("escalated");
