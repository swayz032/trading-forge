-- Migration 0103: Cross-Source Strategy Validation
-- Pass 18 — Pending bucket pattern for cross-validated strategy graduation.
--
-- Two tables:
--   strategy_pending_buckets  — one row per fingerprint (coarse dedup key)
--   strategy_pending_mentions — one row per independent source extraction
--
-- Graduation: when a bucket accumulates ≥3 distinct source_providers AND
-- source_count ≥3, the route graduates it to /scout-ideas/strict.
--
-- Forward-only per repo convention. Idempotent (IF NOT EXISTS everywhere).

-- ─── strategy_pending_buckets ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS strategy_pending_buckets (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint_hash      TEXT NOT NULL,
  market                TEXT NOT NULL,          -- MES | MNQ | MCL
  entry_archetype       TEXT NOT NULL,          -- breakout | mean_reversion | trend_follow | ...
  exit_type             TEXT NOT NULL,          -- atr_multiple | trailing_stop | fixed_target | ...
  source_count          INT  NOT NULL DEFAULT 0,
  distinct_providers    INT  NOT NULL DEFAULT 0,
  status                TEXT NOT NULL DEFAULT 'pending',
  -- pending | graduating | graduated | expired | killed
  first_seen_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  graduated_at          TIMESTAMPTZ,
  graduated_strategy_id UUID REFERENCES strategies(id),
  CONSTRAINT strategy_pending_buckets_market_check
    CHECK (market IN ('MES','MNQ','MCL')),
  CONSTRAINT strategy_pending_buckets_source_count_check
    CHECK (source_count >= 0),
  CONSTRAINT strategy_pending_buckets_distinct_providers_check
    CHECK (distinct_providers >= 0)
);

-- Unique on fingerprint_hash so upsert can use ON CONFLICT (fingerprint_hash)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'strategy_pending_buckets_fingerprint_hash_key'
  ) THEN
    ALTER TABLE strategy_pending_buckets
      ADD CONSTRAINT strategy_pending_buckets_fingerprint_hash_key
      UNIQUE (fingerprint_hash);
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'idx_buckets_status_lastseen'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_buckets_status_lastseen
      ON strategy_pending_buckets(status, last_seen_at DESC);
  END IF;
END;
$$;

-- ─── strategy_pending_mentions ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS strategy_pending_mentions (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id                   UUID NOT NULL REFERENCES strategy_pending_buckets(id) ON DELETE CASCADE,
  source_provider             TEXT NOT NULL,
  -- youtube | reddit | tavily | brave | parallel | scrapingbee | apify | tf_search | exa | manual
  source_url                  TEXT NOT NULL,
  extracted_idea              JSONB NOT NULL,   -- the strict scout shape
  is_cross_validation_result  BOOL NOT NULL DEFAULT FALSE,
  cross_validator_confidence  NUMERIC(3,2),
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT strategy_pending_mentions_bucket_url_unique
    UNIQUE (bucket_id, source_url)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'idx_mentions_bucket'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_mentions_bucket ON strategy_pending_mentions(bucket_id);
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'idx_mentions_recent'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_mentions_recent ON strategy_pending_mentions(created_at DESC);
  END IF;
END;
$$;
