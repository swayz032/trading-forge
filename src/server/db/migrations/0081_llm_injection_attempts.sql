-- Migration 0079: LLM Injection Attempts Table
-- C3 Prompt Injection Defense (W15 Team A)
--
-- Records all detected prompt injection attempts from scout-fetched content.
-- Used for:
--   - Operational monitoring: how many injection attempts per source/day?
--   - Source reputation scoring: which providers are being weaponized?
--   - Incident investigation: reproduce what the LLM was sent before it misbehaved
--   - OWASP LLM01 compliance evidence trail
--
-- Write path: fire-and-forget from llm-input-sanitizer.ts (never blocks pipeline)
-- Read path: GET /api/admin/injection-attempts (dashboard query)

CREATE TABLE IF NOT EXISTS llm_injection_attempts (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    detected_at     timestamp   NOT NULL DEFAULT now(),
    -- Which source/provider produced the injected content
    source          text        NOT NULL,  -- e.g. "brave", "reddit", "tavily", "youtube"
    source_url      text,                  -- original URL (nullable — not all sources have URLs)
    -- First 200 chars surrounding the detected injection (for investigation)
    content_snippet text,
    -- Comma-separated list of detected injection types (e.g. "override_instructions,html_injection")
    injection_type  text,
    -- Highest severity among all detections in this content
    severity        text        NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low')),
    -- Whether the content was blocked from reaching the LLM
    blocked         boolean     DEFAULT true
);

-- Index for per-source monitoring queries
CREATE INDEX IF NOT EXISTS idx_llm_injection_attempts_source
    ON llm_injection_attempts (source, detected_at DESC);

-- Index for severity-based alerting queries
CREATE INDEX IF NOT EXISTS idx_llm_injection_attempts_severity
    ON llm_injection_attempts (severity, detected_at DESC)
    WHERE blocked = false;

-- Index for time-range dashboard queries
CREATE INDEX IF NOT EXISTS idx_llm_injection_attempts_detected_at
    ON llm_injection_attempts (detected_at DESC);

-- Canonical monitoring query:
--   SELECT source, severity, count(*) AS attempts, count(*) FILTER (WHERE NOT blocked) AS bypassed
--   FROM llm_injection_attempts
--   WHERE detected_at > now() - interval '7 days'
--   GROUP BY source, severity
--   ORDER BY severity, attempts DESC;
