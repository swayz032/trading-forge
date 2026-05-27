-- Migration 0163: relax broker_accounts.firm_id CHECK to allow 'paper' sentinel
-- Wave 26 Pass K Phase 4 (2026-05-26)
--
-- BACKGROUND:
--   Migration 0098 (Track 1 broker accounts table) added:
--     CHECK (firm_id IN ('mffu', 'topstep'))
--   Wave 29 Pass C migration 0159 added 2 seed rows:
--     INSERT INTO broker_accounts (firm_id, broker_type, account_id_external, enabled)
--     VALUES ('paper', 'traderspost', 'slumdawg-baseline', true),
--            ('paper', 'traderspost', 'slumdawg-rl-challenger', true)
--   The 'paper' value violates the 0098 CHECK constraint, so 0159 failed at the
--   INSERT statement, rolling back the migration ENTIRELY (the ADD COLUMN
--   paper_account_routing line didn't apply either). Tonight's Slumdawg
--   diagnostic session caught this when graduation insert started failing on
--   the missing `strategies.paper_account_routing` column.
--
-- DECISION (operator-authorized):
--   Relax the CHECK to allow 'paper' as a sentinel meaning "TradersPost paper-
--   trading sub-account, NOT a real funded prop-firm account". The broker_accounts
--   table is the natural place to track routing destinations for the A/B paper
--   routing in Wave 29 Pass C (slumdawg-baseline vs slumdawg-rl-challenger).
--
-- COMPLIANCE CONTRACT (operator + future agents):
--   - 'paper' rows in broker_accounts are NEVER routed to funded brokers.
--   - Topstep/MFFU compliance gates (CLAUDE.md §6, 2026-compliance CI gate)
--     filter on firm_id IN ('mffu', 'topstep') and do NOT apply to 'paper' rows.
--   - Per-account rule enforcement (instance_config.enabled_firms) continues
--     to use the strict {mffu, topstep} set.
--   - Adding any new firm_id value (e.g. 'tradeify' returning, etc.) requires
--     CLAUDE.md §6 update + check:2026-compliance review.
--
-- IDEMPOTENT: drops constraint by name (IF EXISTS) then re-creates with extended set.

ALTER TABLE broker_accounts
  DROP CONSTRAINT IF EXISTS broker_accounts_firm_id_check;

ALTER TABLE broker_accounts
  ADD CONSTRAINT broker_accounts_firm_id_check
  CHECK (firm_id IN ('mffu', 'topstep', 'paper'));

-- Seed the Wave 29 Pass C A/B routing rows that 0159 failed to insert.
-- ON CONFLICT DO NOTHING — idempotent re-run safe.
INSERT INTO broker_accounts (
  firm_id, broker_type, account_id_external, enabled
) VALUES
  ('paper', 'traderspost', 'slumdawg-baseline',      true),
  ('paper', 'traderspost', 'slumdawg-rl-challenger', true)
ON CONFLICT DO NOTHING;
