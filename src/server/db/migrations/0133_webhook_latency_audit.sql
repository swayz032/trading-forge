-- Migration 0133: Webhook Latency Audit Index (Wave 25 Gap 4, 2026-05-24)
--
-- The webhook latency monitor service reads audit_log rows with
-- action = 'webhook.broker_ack' filtered by created_at > NOW() - 1h.
-- Without an index on (action, created_at), this is a full table scan.
--
-- Latency values are stored in audit_log.result JSONB as:
--   { fire_to_ack_ms: <number>, source: 'traderspost' | 'direct' }
-- No schema column is added — the JSONB result blob is the carrier.
-- This is idempotent per standard IF NOT EXISTS guard.
--
-- NOTE: audit_log already has:
--   idx_audit_log_created_at_desc (created_at DESC) — from migration 0058
--   audit_action_idx              (action)           — from migration 0058
-- This composite index accelerates the latency monitor's hot query
-- (action = 'webhook.broker_ack' AND created_at > NOW() - 1h).

CREATE INDEX IF NOT EXISTS audit_log_action_created_at_idx
  ON audit_log (action, created_at DESC);
