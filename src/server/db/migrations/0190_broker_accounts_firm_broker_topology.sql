-- Migration 0190: broker_accounts firm↔broker_type topology CHECK constraint
-- deep-scan #15 FIX M3 (2026-07-03)
--
-- Enforces the CLAUDE.md §7 execution-routing invariant AT THE DATABASE LEVEL,
-- not just at runtime dispatch (broker-router.ts firm_broker_mismatch F-3):
--
--   normalized firm 'topstep'  ⇒ broker_type MUST be 'topstepx'   (NEVER traderspost)
--   normalized firm (any other,⇒ broker_type MUST be 'traderspost'
--     e.g. 'mffu')
--
-- "normalized firm" strips an account-tier suffix (e.g. '_50k', '_100k') and
-- lowercases — matching broker-router.ts `invariantFirmKey` derivation exactly.
--
-- A Topstep row mis-seeded as broker_type='traderspost' is BOTH a topology
-- violation (Topstep uses TopstepX ONLY since the 2026-01-12 Tradovate/NinjaTrader
-- lockdown) AND a compliance violation (orders crossing the wrong broker/firm
-- boundary). The runtime guard catches it at route time; this constraint refuses
-- the bad row at write time so it can never be persisted in the first place.
--
-- SAFETY: added as NOT VALID so pre-existing (possibly-violating) rows are not
-- rejected at migration time — the constraint enforces on all future INSERT/UPDATE
-- while leaving legacy rows for the runtime firm_broker_mismatch guard to surface.
-- (Validating existing rows would fail the deploy if a mis-seeded row already
-- exists — exactly the drift this constraint exists to stop going forward.)
--
-- IDEMPOTENT: guarded by pg_constraint existence check — safe to re-run.
-- Boot-migration-runner keyed on meta/_journal.json idx 193 / tag
-- 0190_broker_accounts_firm_broker_topology.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'broker_accounts_firm_broker_topology_chk'
  ) THEN
    ALTER TABLE broker_accounts
      ADD CONSTRAINT broker_accounts_firm_broker_topology_chk
      CHECK (
        (regexp_replace(lower(firm_id), '_[0-9]+k$', '')  = 'topstep' AND broker_type = 'topstepx')
        OR
        (regexp_replace(lower(firm_id), '_[0-9]+k$', '') <> 'topstep' AND broker_type = 'traderspost')
      ) NOT VALID;
  END IF;
END $$;
