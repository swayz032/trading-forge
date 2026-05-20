-- Migration 0124: Normalize compliance_rulesets.firm column to lowercase
--
-- F-5 fix: compliance-refresh-service.ts wrote Titlecase firm IDs ("MFFU",
-- "Topstep") while paper-execution-service.ts queried with lowercase ("mffu",
-- "topstep"). The case mismatch caused ALL compliance rulesets to never be
-- found, silently bypassing MFFU 2% per-trade checks on every order.
--
-- This migration normalises any existing rows in the DB so the service restart
-- (which writes fresh lowercase rows) does not need to wait for the next
-- checkComplianceRuleDrift() cycle.
--
-- OPERATOR: run `npm run db:migrate` before the next trading session.
--           Safe to re-run — LOWER(firm) is idempotent.

UPDATE compliance_rulesets
SET firm = LOWER(firm)
WHERE firm IN ('MFFU', 'Topstep', 'TPT', 'Apex', 'FFN', 'Alpha', 'Tradeify', 'Earn2Trade');

-- Also normalize compliance_drift_log for consistency
UPDATE compliance_drift_log
SET firm = LOWER(firm)
WHERE firm IN ('MFFU', 'Topstep', 'TPT', 'Apex', 'FFN', 'Alpha', 'Tradeify', 'Earn2Trade');
