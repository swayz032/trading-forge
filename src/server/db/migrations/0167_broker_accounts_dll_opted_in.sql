-- Migration 0167: broker_accounts.dll_opted_in
-- Topstep voluntary-DLL → doubled payout cap (effective 2026-06-02).
--
-- Adding a voluntary Daily Loss Limit at Combine checkout doubles the per-request
-- payout cap on the resulting Express Funded Account (XFA):
--   $50K Standard:     base $2,000 → with-DLL $4,000
--   $50K Consistency:  base $3,000 → with-DLL $6,000
-- Live Funded Account (LFA) is uncapped regardless.
-- MFFU is NOT affected — its cap is always $2,000.
--
-- Conservative default: false (base cap applies until operator explicitly opts in).
-- Operator IS opting in for their Topstep account(s) per 2026-06-22 operator mandate.
--
-- SAFETY NOTE: the voluntary DLL dollar amount must be >= the firm DLL our risk
-- engine models ($1,000 at 50K) so our 67% halt point fires before Topstep's DLL.
-- Operator must confirm the exact $ amount selected at checkout.

ALTER TABLE broker_accounts
  ADD COLUMN IF NOT EXISTS dll_opted_in BOOLEAN NOT NULL DEFAULT false;
