-- Migration 0069: strategy_lockouts table (Tier 5.3 — W5b 24h lockout layer)
--
-- Purpose: persist 24-hour trading lockout state after a compliance kill fires.
-- Written by strategy-lockout-service.ts when it receives a compliance.daily_loss_kill
-- audit event. Queried by paper-signal-service.ts before emitting any entry signal.
--
-- Design notes:
--   - locked_until stores the wall-clock expiry (UTC). Service checks NOW() < locked_until.
--   - triggered_by_kill_id links to audit_log.id for full audit chain.
--   - reason is a controlled enum string (daily_loss_kill | manual | etc).
--   - Multiple rows per strategy are allowed (history preserved). The service
--     queries the most recent active lockout (locked_until > now()).

CREATE TABLE strategy_lockouts (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id           uuid REFERENCES strategies(id) NOT NULL,
  locked_until          timestamp NOT NULL,
  reason                text NOT NULL,        -- daily_loss_kill | manual | etc
  triggered_by_kill_id  uuid,                 -- audit_log.id of the kill event (nullable — manual lockouts have none)
  created_at            timestamp DEFAULT now() NOT NULL
);

-- Efficient active-lockout query:
--   SELECT * FROM strategy_lockouts
--   WHERE strategy_id = $1 AND locked_until > now()
--   ORDER BY locked_until DESC LIMIT 1
CREATE INDEX idx_strategy_lockouts_strategy_active
  ON strategy_lockouts (strategy_id, locked_until DESC);
