-- Migration 0101: Autopilot tables for operator-absent mode (Track 7)
-- UP ─────────────────────────────────────────────────────────────────────────

-- system_health_heartbeat: written every 15 min during RTH to prove the
-- backend is alive. Dead-man's check reads the most recent row.
CREATE TABLE IF NOT EXISTS system_health_heartbeat (
  id        BIGSERIAL PRIMARY KEY,
  ts        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status    TEXT NOT NULL DEFAULT 'alive',  -- 'alive' | 'shutdown'
  source    TEXT NOT NULL DEFAULT 'backend'
);

CREATE INDEX idx_heartbeat_ts_desc
  ON system_health_heartbeat (ts DESC);

-- operator_absent_periods: records each absence window so the promotion
-- audit trail is queryable ("which promotions happened while absent?").
CREATE TABLE IF NOT EXISTS operator_absent_periods (
  id         BIGSERIAL PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at   TIMESTAMPTZ,                        -- NULL = currently absent
  reason     TEXT,
  ended_by   TEXT                                -- 'env_unset' | 'manual_api' | 'system_restart'
);

-- Partial index: fast lookup of the active (open) absence period
CREATE INDEX idx_operator_absent_active
  ON operator_absent_periods (started_at DESC)
  WHERE ended_at IS NULL;

-- operator_absent_since on system_state (additive nullable column).
-- Null = not absent. Non-null = absence started at that timestamp.
ALTER TABLE system_state
  ADD COLUMN IF NOT EXISTS operator_absent_since TIMESTAMPTZ;

-- DOWN ────────────────────────────────────────────────────────────────────────
-- To reverse:
--   DROP TABLE IF EXISTS system_health_heartbeat;
--   DROP TABLE IF EXISTS operator_absent_periods;
--   ALTER TABLE system_state DROP COLUMN IF EXISTS operator_absent_since;
