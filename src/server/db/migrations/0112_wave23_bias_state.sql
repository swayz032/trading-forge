-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0112 — Wave 23.C: bias_state table
-- 2026-05-19
--
-- Context: Wave 23 Track C wires bias_engine.compute_bias() + playbook_router
-- into paper-signal-service at session start. One row per trading session
-- captures the active playbook decision, the selected strategy, and the full
-- evidence so promotion-gate inputs are traceable and auditable.
--
-- The existing bias_decisions table (migration 0095) is a per-call shadow-mode
-- calibration sink. bias_state is a per-session promotion-gate input: one row
-- per RTH session, written at session-open, read at signal time.
--
-- Schema:
--   session_date        DATE (the CME trading day in YYYY-MM-DD format)
--   regime_label        TEXT (e.g. 'TRENDING_UP', 'MEAN_REVERSION_LONG', 'NO_TRADE')
--   playbook            TEXT (playbook selected by route_playbook())
--   active_strategy_id  UUID nullable (strategy chosen for today's regime; null = no match)
--   correlation_id      TEXT (links back to the session-start span)
--   evidence            JSONB (full bias scores, confidence, VP levels, etc.)
--   created_at          TIMESTAMPTZ
--
-- Unique constraint: one row per session_date (ON CONFLICT DO UPDATE).
-- Fail-open: the write is non-blocking; a failure does NOT block signal execution.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS.
-- Operator: npm run db:migrate (or Railway Postgres apply).
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

CREATE TABLE IF NOT EXISTS bias_state (
  id                   BIGSERIAL PRIMARY KEY,
  session_date         DATE NOT NULL,
  regime_label         TEXT NOT NULL,
  playbook             TEXT NOT NULL,
  active_strategy_id   UUID REFERENCES strategies(id) ON DELETE SET NULL,
  correlation_id       TEXT,
  evidence             JSONB NOT NULL DEFAULT '{}',
  computed_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(session_date)
);

CREATE INDEX IF NOT EXISTS bias_state_session_date_idx  ON bias_state(session_date DESC);
CREATE INDEX IF NOT EXISTS bias_state_regime_label_idx  ON bias_state(regime_label);
CREATE INDEX IF NOT EXISTS bias_state_active_strategy_idx ON bias_state(active_strategy_id);

COMMIT;
