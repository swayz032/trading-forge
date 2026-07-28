-- 0208 (R-363/R-377 item 2): give firm_id='paper' rows a broker_type with NO live egress path.
--
-- Migration 0159 seeded two A/B paper-routing rows (slumdawg-baseline,
-- slumdawg-rl-challenger) with firm_id='paper' and stated a COMPLIANCE CONTRACT in
-- its own header: "'paper' rows in broker_accounts are NEVER routed to funded
-- brokers." NOTHING ENFORCED IT. Worse, 0190's topology CHECK *required* the unsafe
-- mapping: its second arm is (firm <> 'topstep' AND broker_type = 'traderspost'),
-- and 'paper' is not 'topstep', so the constraint MANDATED that paper rows be typed
-- as live TradersPost accounts. `broker-router.ts` then treats them as exactly that.
-- Root cause (R-354): 'paper' is a MODE masquerading as an IDENTITY — the column
-- means "which funded firm", the value means "not a firm at all", so every consumer
-- that reads the field CORRECTLY mishandles it.
--
-- FIX SHAPE (R-363 §4, mirroring what makes TopstepX the strongest shut in the
-- system): make the discriminator itself carry the safety. broker_type='paper_sim'
-- matches neither dispatch branch in routeOrder(), so it falls to the dispatch tail
-- (broker-router.ts, `unknown_broker_type`) which returns success:false and writes an
-- audit row — i.e. these accounts become UNROUTABLE BY STRUCTURE, not by a branch
-- someone remembered to write. It also drops them out of the boot probe's own
-- selection query (WHERE broker_type = 'traderspost'), closing that path a second,
-- independent way by data shape rather than by flag.
--
-- ORDERING IS MANDATORY AND THE OBVIOUS SEQUENCE IS ILLEGAL (R-363 §5): the UPDATE
-- cannot precede the topology DROP (Postgres rejects it against the old CHECK) and
-- the re-ADD cannot precede the UPDATE (same). One transaction, four steps, in order.
--
-- NOT VALID is DELIBERATE and stated per R-363 §4: it matches 0190's own choice and
-- enforces on WRITE, which is what protects going forward. VALIDATE was considered
-- and rejected — it would scan existing rows, and a single non-conforming row
-- anywhere would fail the migration on a FAIL-CLOSED boot runner and take the API
-- down. Enforcement-on-write is the option that cannot crash-loop the tower.
--
-- Idempotent throughout (DROP IF EXISTS + ADD, pg_constraint guard, WHERE-narrowed
-- UPDATE that matches zero rows on re-run); safe to re-apply. No flag gate needed:
-- this REMOVES an egress capability rather than adding behaviour.

-- 1. DROP the topology constraint. Must come first — it currently forbids the very
--    value step 3 writes.
ALTER TABLE broker_accounts
  DROP CONSTRAINT IF EXISTS broker_accounts_firm_broker_topology_chk;

-- 2. Widen the broker_type IN-list (0098) to admit the no-egress type.
--    DROP-then-ADD: Postgres has no ADD CONSTRAINT IF NOT EXISTS.
ALTER TABLE broker_accounts
  DROP CONSTRAINT IF EXISTS broker_accounts_broker_type_check;

ALTER TABLE broker_accounts
  ADD CONSTRAINT broker_accounts_broker_type_check
  CHECK (broker_type IN ('traderspost', 'topstepx', 'paper_sim'));

-- 3. Retype the paper rows. Narrowed to rows still carrying the live type, so a
--    re-run matches zero rows.
UPDATE broker_accounts
   SET broker_type = 'paper_sim'
 WHERE regexp_replace(lower(firm_id), '_[0-9]+k$', '') = 'paper'
   AND broker_type = 'traderspost';

-- 4. RE-ADD the amended topology constraint: EXHAUSTIVE and DEFAULT-DENY. Three
--    arms, each admitting exactly ONE broker_type; any firm/type pair matching no
--    arm is rejected. The tier-stripping regexp_replace is preserved from 0190.
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
        (regexp_replace(lower(firm_id), '_[0-9]+k$', '')  = 'paper'   AND broker_type = 'paper_sim')
        OR
        (regexp_replace(lower(firm_id), '_[0-9]+k$', '') NOT IN ('topstep', 'paper')
           AND broker_type = 'traderspost')
      ) NOT VALID;
  END IF;
END $$;
