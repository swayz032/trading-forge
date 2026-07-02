-- Migration 0185: carter_memory — persistent continuity store for the Carter voice agent
-- Boot-migration-runner keyed on meta/_journal.json idx 188 / tag 0185_carter_memory
--
-- Carter remembers across calls: decisions, preferences, facts, open threads (voice-written
-- via the `remember` tool) plus best-effort call summaries (webhook-written on post_call_transcription).
-- The `recall` tool reads it back, newest-first, optionally filtered by topic.
--
-- IDEMPOTENT: CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS
-- Proved idempotent by re-apply (CREATE ... IF NOT EXISTS is a no-op on second run).

CREATE TABLE IF NOT EXISTS carter_memory (
  id             BIGSERIAL PRIMARY KEY,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  kind           TEXT NOT NULL,                        -- 'decision' | 'preference' | 'fact' | 'open_thread' | 'call_summary'
  topic          TEXT,                                 -- optional free-text grouping key (ILIKE-searched by recall)
  content        TEXT NOT NULL,                        -- the remembered text (bounded ~4000 chars by the remember tool)
  correlation_id TEXT,                                 -- optional end-to-end trace id (conversation_id on webhook writes)
  source         TEXT NOT NULL DEFAULT 'voice'         -- 'voice' (remember tool) | 'webhook' (call summary)
);

-- Newest-first recall (served by queryMemories ORDER BY created_at DESC)
CREATE INDEX IF NOT EXISTS carter_memory_created_at_idx ON carter_memory (created_at DESC);
-- Filter by memory kind
CREATE INDEX IF NOT EXISTS carter_memory_kind_idx ON carter_memory (kind);
