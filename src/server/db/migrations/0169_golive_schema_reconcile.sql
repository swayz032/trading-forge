-- Migration 0169 — go-live schema reconcile (autonomous-readiness fix, 2026-06-22)
--
-- Two tables/columns that subsystems already depend on were never created in prod
-- because their original migrations (0149, 0101) were rewritten / recorded as applied
-- without the DDL landing, and the boot-migration-runner keys idempotency on the
-- journal (won't re-run them). This migration recreates them additively + idempotently
-- so the autonomous apply path produces a correct prod schema at go-live.
--
-- 1. strategy_health_scores (migration 0149) — the composite-health aggregator writes
--    here every cycle; missing table => fail-soft no-op (no composite data persisted).
--    Full def mirrors 0149_strategy_health_scores.sql.
-- 2. system_state.operator_absent_since (migration 0101) — VERIFIED missing in prod
--    (information_schema count = 0) despite 0101 recorded as applied. Its absence makes
--    readSystemState() throw on every 30-min heartbeat tick, permanently breaking the
--    48h operator-absent auto-detect / vacation autopilot (CLAUDE.md §3).
--
-- IDEMPOTENT: CREATE TABLE IF NOT EXISTS + ADD COLUMN IF NOT EXISTS. Safe to re-run.

CREATE TABLE IF NOT EXISTS strategy_health_scores (
    id                          BIGSERIAL PRIMARY KEY,
    strategy_id                 UUID NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
    evaluated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    composite_score             REAL,
    verdict                     TEXT,
    subsystem_scores            JSONB NOT NULL,
    computed_from_n_subsystems  INTEGER NOT NULL,
    weights_version_id          TEXT NOT NULL,
    staleness_age_hours         REAL,
    disagreements               JSONB,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_strategy_health_scores_strategy_created
    ON strategy_health_scores (strategy_id, created_at DESC);

ALTER TABLE system_state
    ADD COLUMN IF NOT EXISTS operator_absent_since TIMESTAMPTZ;
