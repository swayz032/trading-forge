-- Migration 0104: Concept-Name Fingerprint Redesign (Pass 20)
--
-- Changes the fingerprint strategy for strategy_pending_buckets from
--   sha256(market|entry_archetype|exit_type)  → old scheme (Pass 18)
-- to
--   sha256(market|normalized_concept_name)    → new scheme (Pass 20)
--
-- Why: the old scheme collapses ALL opening_range_breakout strategies on MES
-- into ONE bucket (breakout archetype, atr_multiple exit), hiding nuances like
-- "1-min ORB" vs "15-min ORB". The concept-name scheme preserves these.
--
-- Additive only: no existing bucket rows are deleted. Existing rows keep their
-- fingerprint_hash value (old scheme) until they expire or are manually migrated.
-- New buckets from Pass 20+ use the concept-name scheme.
--
-- Also adds:
--   concept_name TEXT — the canonical concept name stored on the bucket row
--   layer_coverage_json JSONB — tracks which scout layers (web/youtube/reddit) have confirmed
--
-- Forward-only per repo convention. Idempotent (IF NOT EXISTS / DO $$ everywhere).

-- ─── Add concept_name column ────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'strategy_pending_buckets'
      AND column_name = 'concept_name'
  ) THEN
    ALTER TABLE strategy_pending_buckets
      ADD COLUMN concept_name TEXT;
  END IF;
END;
$$;

-- ─── Add layer_coverage_json column ─────────────────────────────────────────
-- Tracks which scout layers have confirmed the strategy concept.
-- Shape: {"web": bool, "youtube": bool, "reddit": bool}
-- Graduation requires all 3 layers true (Pass 20+ buckets).
-- Legacy Pass 18/19 buckets: null → graduation uses old distinct_providers logic.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'strategy_pending_buckets'
      AND column_name = 'layer_coverage_json'
  ) THEN
    ALTER TABLE strategy_pending_buckets
      ADD COLUMN layer_coverage_json JSONB;
  END IF;
END;
$$;

-- ─── Add index on (market, concept_name) ────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'idx_buckets_market_concept'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_buckets_market_concept
      ON strategy_pending_buckets(market, concept_name)
      WHERE concept_name IS NOT NULL;
  END IF;
END;
$$;

-- ─── Recompute fingerprint_hash for existing rows that have concept_name set ─
-- This is a no-op on a fresh DB where no concept_name rows exist yet.
-- If concept_name was previously backfilled, this updates the fingerprint.
-- Uses the same normalization as normalizeConceptName() in TypeScript:
--   lower(regexp_replace(concept_name, '[^a-z0-9]', '', 'gi'))
-- where 'gi' = global + case-insensitive.
-- The old UNIQUE constraint on fingerprint_hash must be dropped first because
-- concept-name hashes may differ from the archetype-based hashes.
-- We use a partial update: only rows with concept_name NOT NULL.
--
-- deep-scan fresh-bootstrap fix: digest() is a pgcrypto function, and pgcrypto is not
-- CREATE EXTENSION'd until 0128_hmac_secret_encryption.sql (journal idx 130), which runs
-- AFTER this migration (idx 107) — a genuine forward-reference on the extension, not just
-- a table. Guarded via a pg_extension existence check so the UPDATE is skipped (not a hard
-- failure) when pgcrypto isn't installed yet; PL/pgSQL only resolves digest() when the
-- branch actually executes, so an unmet guard never triggers "function does not exist".
-- This is also correct on a fresh bootstrap in the intended sense: the migration's own
-- comment already says the UPDATE is meant to be a no-op with no concept_name rows present.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pgcrypto') THEN
    UPDATE strategy_pending_buckets
    SET fingerprint_hash = encode(
      digest(
        market || '|' || lower(regexp_replace(concept_name, '[^a-z0-9]', '', 'gi')),
        'sha256'
      ),
      'hex'
    )
    WHERE concept_name IS NOT NULL;
  END IF;
END
$$;

-- ─── Add layer column to strategy_pending_mentions ───────────────────────────
-- Records which scout layer this mention came from (web | youtube | reddit).
-- Default 'web' for backward compatibility with Pass 18/19 organic mentions.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'strategy_pending_mentions'
      AND column_name = 'scout_layer'
  ) THEN
    ALTER TABLE strategy_pending_mentions
      ADD COLUMN scout_layer TEXT NOT NULL DEFAULT 'web';
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'idx_mentions_layer'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_mentions_layer
      ON strategy_pending_mentions(bucket_id, scout_layer);
  END IF;
END;
$$;
