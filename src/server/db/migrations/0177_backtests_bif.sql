-- Wave 3 Track 3B: BIF (Bias Information Factor) gate persistence
-- Adds bif and k_eff columns to the backtests table so the promotion gate
-- can read them directly without parsing nested JSONB.
--
-- bif   — Bias Information Factor emitted by the Python WF result (`result.bif`).
--         Lower values indicate better IS→OOS transfer (less overfitting bias).
--         Gate: BIF_WARN_THRESHOLD (default 2.0) / BIF_BLOCK_THRESHOLD (default 4.0).
--         HARD block when bif > 4.0; warn band 2.0–4.0; grandfather pass when null.
--
-- k_eff — Effective parameter count (`result.k_eff`).
--         Companion metric surfaced in the audit payload; does not affect pass/block.
--
-- Both columns are nullable (numeric).  Pre-Wave-3 backtests that never emitted
-- these fields will have null values; the promotion gate treats null as a legacy
-- grandfather pass (never blocks on absent data per paper-parity mandate).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS is safe to re-run.

ALTER TABLE backtests ADD COLUMN IF NOT EXISTS bif numeric;
ALTER TABLE backtests ADD COLUMN IF NOT EXISTS k_eff numeric;
