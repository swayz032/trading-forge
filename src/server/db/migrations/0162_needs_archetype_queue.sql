-- Wave 26 Pass J Phase 3 (2026-05-26) — needs_archetype_queue table
--
-- When transcript_extractor extracts a strategy whose entry_indicator maps to
-- NEITHER a canonical indicator (from kb/indicator-catalog.md) NOR a known
-- archetype (from ARCHETYPE_REGISTRY), the graduator emits
-- `entry_indicator: "uncatalogued:<speaker_term>"` AND inserts a row here
-- instead of silently dropping the strategy.
--
-- This is the bookkeeping table the operator + Claude use to decide WHICH
-- speaker vocabulary deserves promotion to a real canonical archetype.
-- Strategy threshold: extraction_count ≥ 3 (don't create archetypes from
-- one-off speaker idiosyncrasies; do create them from concepts that show up
-- repeatedly across multiple sources).
--
-- Schema choices:
--   - bucket_id is nullable because a strategy may be queued without a
--     pending-bucket parent (direct operator-ingest path).
--   - extraction_count auto-increments on UPSERT of the same speaker_term.
--   - status enum: pending (default) / archetype_created (operator promoted
--     the term) / rejected (operator decided the term isn't worth modeling).
--   - INDEX on (speaker_term, status) supports "top-N pending archetype
--     requests" dashboard query.
--   - INDEX on (created_at DESC) supports time-window analytics.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + UNIQUE INDEX IF NOT EXISTS.
-- Safe to re-apply.

CREATE TABLE IF NOT EXISTS needs_archetype_queue (
  id                     BIGSERIAL PRIMARY KEY,
  bucket_id              UUID NULL,
  speaker_term           TEXT NOT NULL,
  verbatim_description   TEXT NULL,
  transcript_quote       TEXT NULL,
  source_url             TEXT NULL,
  extraction_count       INTEGER NOT NULL DEFAULT 1,
  proposed_archetype_name TEXT NULL,
  status                 TEXT NOT NULL DEFAULT 'pending',
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT needs_archetype_queue_status_check
    CHECK (status IN ('pending', 'archetype_created', 'rejected'))
);

CREATE UNIQUE INDEX IF NOT EXISTS needs_archetype_queue_term_idx
  ON needs_archetype_queue (speaker_term);

CREATE INDEX IF NOT EXISTS needs_archetype_queue_status_idx
  ON needs_archetype_queue (status, extraction_count DESC);

CREATE INDEX IF NOT EXISTS needs_archetype_queue_created_at_idx
  ON needs_archetype_queue (created_at DESC);

COMMENT ON TABLE needs_archetype_queue IS
  'Wave 26 Pass J Phase 3 — speaker-vocabulary terms extracted from transcripts that don''t map to a canonical indicator or known archetype. Operator/Claude reviews terms with extraction_count >= 3 to decide whether to promote them to a real canonical archetype in ARCHETYPE_REGISTRY.';
