-- Migration 0159: A/B paper routing — Wave 29 Pass C.3
-- Adds per-strategy paper account routing column and seeds the two sub-accounts.
-- Idempotent: safe to re-run.

-- 1. Add paper_account_routing column to strategies
--    Enum values: 'baseline' | 'rl-challenger'
--    Default 'baseline' preserves existing behavior for all pre-C.3 strategies.
ALTER TABLE strategies
  ADD COLUMN IF NOT EXISTS paper_account_routing TEXT NOT NULL DEFAULT 'baseline';

-- Add a check constraint to enforce the enum (idempotent via DO block)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'strategies_paper_account_routing_check'
  ) THEN
    ALTER TABLE strategies
      ADD CONSTRAINT strategies_paper_account_routing_check
      CHECK (paper_account_routing IN ('baseline', 'rl-challenger'));
  END IF;
END
$$;

-- 2. Relax broker_accounts.firm_id CHECK to allow 'paper' sentinel.
--    Wave hardening 2026-06-22 inlined from migration 0163 (deleted as part of this
--    inline). Without this relaxation, the seed INSERT below violates the 0098
--    CHECK (firm_id IN ('mffu', 'topstep')) and rolls back the ENTIRE migration,
--    so the ADD COLUMN paper_account_routing above never lands either, cascading
--    a graduation-path failure (was caught by the Slumdawg diagnostic 2026-05-26).
--
--    COMPLIANCE CONTRACT (operator + future agents):
--      - 'paper' rows in broker_accounts are NEVER routed to funded brokers.
--      - Topstep/MFFU compliance gates (CLAUDE.md §6, 2026-compliance CI gate)
--        filter on firm_id IN ('mffu', 'topstep') and do NOT apply to 'paper' rows.
--      - Per-account rule enforcement (instance_config.enabled_firms) continues
--        to use the strict {mffu, topstep} set.
--      - Adding any new firm_id value (e.g. 'tradeify' returning, etc.) requires
--        CLAUDE.md §6 update + check:2026-compliance review.
--
--    Idempotent: DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT is safe on re-apply.
ALTER TABLE broker_accounts
  DROP CONSTRAINT IF EXISTS broker_accounts_firm_id_check;

ALTER TABLE broker_accounts
  ADD CONSTRAINT broker_accounts_firm_id_check
  CHECK (firm_id IN ('mffu', 'topstep', 'paper'));

-- 3. Seed the two A/B TradersPost sub-accounts in broker_accounts
--    firm_id = 'paper' marks these as paper-trading-only (never routed to funded account).
--    ON CONFLICT DO NOTHING makes this idempotent.
--    account_id_external stores the TradersPost sub-account slug used for webhook routing.
INSERT INTO broker_accounts (
  firm_id,
  broker_type,
  account_id_external,
  enabled
) VALUES
  ('paper', 'traderspost', 'slumdawg-baseline',      true),
  ('paper', 'traderspost', 'slumdawg-rl-challenger', true)
ON CONFLICT DO NOTHING;
