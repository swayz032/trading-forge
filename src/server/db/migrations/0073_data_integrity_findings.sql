-- Migration 0073: data_integrity_findings table (A8 — Data Integrity Service)
--
-- Consolidates the original A8 (reconciliation) and A10 (drift detection) specs
-- into a single findings table. One nightly cron, one table, one alert path.
--
-- check_type discriminator:
--   reconciliation   — independent sources should agree (audit_log vs lifecycle_transitions,
--                       paper_trades vs paper_positions, etc.)
--   drift_detection  — same input should produce same output (PSI on metric distributions
--                       from backtest_provenance)
--
-- severity tiers:
--   info     — healthy status (0 issues found), routine observation
--   warning  — minor drift (PSI 0.1–0.2), minor reconciliation gaps
--   critical — serious issue (PSI > 0.5, missing lifecycle_transitions for executed
--              strategy, orphaned paper_trades, etc.)
--
-- affected_entity_id is nullable — some checks affect the whole system, not a single entity.
-- resolved starts false; operator flips to true after investigating.

CREATE TABLE data_integrity_findings (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_at               timestamp DEFAULT now() NOT NULL,
  check_type           text NOT NULL,        -- reconciliation | drift_detection
  check_name           text NOT NULL,        -- specific subtype (audit_log_lifecycle_gap, psi_sharpe, etc.)
  severity             text NOT NULL,        -- info | warning | critical
  affected_entity_type text,                 -- strategy | backtest | paper_session | paper_trade | null
  affected_entity_id   uuid,                 -- nullable — null for system-wide checks
  details              jsonb,                -- structured finding detail (counts, entity_ids, psi_value, etc.)
  resolved             boolean DEFAULT false NOT NULL
);

-- Primary operational query: unresolved findings needing attention
CREATE INDEX idx_data_integrity_unresolved
  ON data_integrity_findings(check_type, severity)
  WHERE resolved = false;

-- Recency index for "latest run" queries
CREATE INDEX idx_data_integrity_run_at
  ON data_integrity_findings(run_at DESC);

-- Entity lookup: "all findings for this backtest/strategy"
CREATE INDEX idx_data_integrity_entity
  ON data_integrity_findings(affected_entity_type, affected_entity_id)
  WHERE affected_entity_id IS NOT NULL;
