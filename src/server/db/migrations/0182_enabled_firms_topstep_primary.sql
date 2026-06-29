-- 0182_enabled_firms_topstep_primary.sql
--
-- Deep-scan 2026-06-28: Topstep is the PRIMARY firm; MFFU is a SECONDARY/fallback
-- the operator does NOT currently have an account for. Migration 0117 bootstrapped
-- instance_config.enabled_firms = '["mffu","topstep"]', which made:
--   - startup-config-check warn "no enabled broker_accounts row for [mffu]" every boot
--   - broker-router + compliance-gate treat MFFU as an active, required firm
-- i.e. MFFU kept surfacing as a "blocker" even though the operator runs Topstep only.
--
-- Flip the singleton instance_config row to Topstep-only. MFFU is re-enabled
-- (append "mffu" to enabled_firms) ONLY when the operator opens an MFFU account.
--
-- Idempotent + safe: updates only the bootstrap singleton (id=1) and only while it
-- still contains mffu, so a deliberate later re-enable is never clobbered (and the
-- migration runs once via the journal regardless).

UPDATE instance_config
SET enabled_firms = '["topstep"]'::jsonb
WHERE id = 1
  AND enabled_firms @> '["mffu"]'::jsonb;
