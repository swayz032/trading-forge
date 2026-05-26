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

-- 2. Seed the two A/B TradersPost sub-accounts in broker_accounts
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
