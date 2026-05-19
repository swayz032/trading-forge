-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0118 — W23G.4: transcript_fetch_outcomes table
-- 2026-05-19
--
-- Context: Two-pass YouTube search (captioned + uncaptioned recovery) generates
-- retry attempts per video. This table persists per-video fetch outcomes so the
-- operator can monitor transcript success rate per cycle and tune retry policy.
--
-- spec in WAVE-23G-PREMIUM-YIELD-PLAN.md §W23G.4
--
-- Outcome taxonomy:
--   captioned_succeeded — lang:"en" succeeded on first try
--   captioned_failed    — lang:"en" threw; no-lang (auto-captions) succeeded
--   auto_recovered      — later attempt (2 or 3) succeeded after earlier failure
--   all_failed          — all maxAttempts exhausted with no usable transcript
--
-- source_pass:
--   captioned   — video came from Pass 1 (videoCaption=closedCaption filter)
--   uncaptioned — video came from Pass 2 (no caption filter, recovery pass)
--
-- Idempotent: CREATE TABLE / INDEX IF NOT EXISTS — safe to re-apply.
-- Operator:   npm run db:migrate (or apply manually on Railway Postgres).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS transcript_fetch_outcomes (
  id               BIGSERIAL PRIMARY KEY,
  video_id         TEXT        NOT NULL,
  outcome          TEXT        NOT NULL,           -- captioned_succeeded | captioned_failed | auto_recovered | all_failed
  attempt_count    SMALLINT    NOT NULL,
  total_duration_ms INT        NOT NULL,
  source_pass      TEXT        NOT NULL,           -- "captioned" | "uncaptioned"
  source_query     TEXT        NULL,
  error_message    TEXT        NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transcript_outcomes_created
  ON transcript_fetch_outcomes (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_transcript_outcomes_outcome
  ON transcript_fetch_outcomes (outcome, created_at DESC);
