-- C2: Prop Firm Account Suspension Detection (W15 Team B)
-- Stores health check results for each prop firm API poll (every 15 min).
-- Detects auth failures / "suspended" responses → blocks new orders for affected firm.
-- Evidence layer for payout disputes: dashboard snapshots stored separately via
-- dashboard-snapshot-service.ts (Playwright screenshots, not persisted in DB).

CREATE TABLE IF NOT EXISTS prop_firm_health_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id text NOT NULL,
  checked_at timestamp NOT NULL DEFAULT now(),
  status text NOT NULL,
  response_code integer,
  response_body_snippet text,
  alert_fired boolean DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_prop_firm_health_firm_time
  ON prop_firm_health_checks(firm_id, checked_at DESC);

CREATE INDEX IF NOT EXISTS idx_prop_firm_health_alerts
  ON prop_firm_health_checks(alert_fired, checked_at DESC)
  WHERE alert_fired = true;
