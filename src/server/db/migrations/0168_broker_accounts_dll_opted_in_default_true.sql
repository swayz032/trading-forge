-- Migration 0168: broker_accounts.dll_opted_in default → true + backfill
--
-- Operator decision 2026-06-22: "just cut it on now." Standing policy is to ALWAYS
-- add the Topstep voluntary Daily Loss Limit at Combine checkout, which doubles the
-- XFA per-request payout cap ($50K: Standard $2K→$4K, Consistency $3K→$6K).
--
-- Safe because:
--   - The payout cap is a withdrawal-policy/reporting value — nothing automated acts
--     on it (the operator requests payouts manually via the Topstep dashboard).
--   - The actual DLL protection (67% halt / 95% force-close) is separate and already
--     always-on in the risk engine, independent of this flag.
--   - MFFU carries the flag but ignores it (cap is always $2,000 — no promo).
--
-- Only real-world dependency: the operator must tick the DLL box at Topstep signup.
-- This flag REFLECTS that choice; it cannot make Topstep grant the cap.
--
-- Idempotent: SET DEFAULT is naturally idempotent; the UPDATE is safe to re-run.

ALTER TABLE broker_accounts
  ALTER COLUMN dll_opted_in SET DEFAULT true;

UPDATE broker_accounts
  SET dll_opted_in = true
  WHERE dll_opted_in = false;
