CREATE TABLE IF NOT EXISTS youtube_evidence_archive (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id text NOT NULL UNIQUE,
  youtube_url text NOT NULL,
  title text NOT NULL,
  channel text,
  transcript_text text,
  transcript_sha256 text,
  transcript_chars integer NOT NULL DEFAULT 0 CHECK (transcript_chars >= 0),
  source_provider text NOT NULL,
  source_query text,
  source_pass text,
  transcript_status text NOT NULL DEFAULT 'pending'
    CHECK (transcript_status IN ('available', 'pending', 'unavailable', 'too_short')),
  discovered_at timestamptz NOT NULL DEFAULT now(),
  transcript_fetched_at timestamptz,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT youtube_evidence_transcript_integrity CHECK (
    (transcript_status = 'available' AND transcript_text IS NOT NULL AND transcript_sha256 IS NOT NULL AND transcript_chars > 0)
    OR transcript_status <> 'available'
  )
);

CREATE INDEX IF NOT EXISTS idx_youtube_evidence_discovered
  ON youtube_evidence_archive (discovered_at DESC);
CREATE INDEX IF NOT EXISTS idx_youtube_evidence_status
  ON youtube_evidence_archive (transcript_status, discovered_at DESC);

REVOKE ALL ON youtube_evidence_archive FROM PUBLIC;
