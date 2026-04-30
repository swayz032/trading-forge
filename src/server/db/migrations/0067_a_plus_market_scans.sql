-- Migration 0066: A+ Market Auditor scan table (Tier 3.3 W3b)
-- One scan row per calendar day (UNIQUE on scan_date).
-- Pending-row contract: status="pending" on insert; updated to
-- "completed" or "failed" on resolve. See a-plus-auditor-service.ts.

CREATE TABLE a_plus_market_scans (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_date             date        NOT NULL,
  winner_market         text,                     -- MES | MNQ | MCL | null (observation mode)
  observation_mode      boolean     NOT NULL DEFAULT false,
  edge_scores           jsonb       NOT NULL DEFAULT '{}'::jsonb,
  -- {MES: {vol, p_target, noise, entangle, composite,
  --        passes_p_target_gate, passes_noise_gate}, MNQ: {...}, MCL: {...}}
  lead_market           text,                     -- MES | MNQ | MCL | DXY | null
  lag_window_minutes    integer,
  entanglement_strength numeric,
  status                text        NOT NULL DEFAULT 'pending',  -- pending | completed | failed
  error_message         text,
  scan_duration_ms      integer,
  hardware              text,                     -- default.qubit | fallback_classical | fallback_unavailable
  seed                  integer,
  created_at            timestamp   NOT NULL DEFAULT now(),
  UNIQUE (scan_date)
);

CREATE INDEX idx_a_plus_market_scans_date
  ON a_plus_market_scans (scan_date DESC);

CREATE INDEX idx_a_plus_market_scans_status
  ON a_plus_market_scans (status)
  WHERE status = 'pending';
