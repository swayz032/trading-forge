-- Migration 0061: Paper session governor state persistence (P0-4)
-- Adds governor_state JSONB column so the in-process governor state machine
-- survives server restarts without resetting to "normal".
-- Schema: { state: "normal"|"alert"|"cautious"|"defensive"|"lockout"|"recovery",
--           consecutiveLosses: number, sessionLossPct: number, lastUpdatedAt: ISO_string }
-- Index on state field for efficient "how many sessions are in lockout?" queries.

ALTER TABLE paper_sessions ADD COLUMN IF NOT EXISTS governor_state JSONB;
CREATE INDEX IF NOT EXISTS idx_paper_sessions_governor_state ON paper_sessions ((governor_state->>'state'));
