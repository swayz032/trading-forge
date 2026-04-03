-- Add commission tracking columns to paper_trades
-- pnl column is redefined to store NET P&L (after commission deduction).
-- gross_pnl stores the pre-commission P&L for audit/analytics reference.
-- commission stores the round-trip commission cost (entry + exit sides × contracts).

ALTER TABLE "paper_trades"
  ADD COLUMN IF NOT EXISTS "gross_pnl" numeric,
  ADD COLUMN IF NOT EXISTS "commission" numeric(12, 4) DEFAULT 0;

-- Back-fill gross_pnl for existing rows: existing pnl values were gross (no commission was deducted),
-- so gross_pnl = pnl and commission remains 0 (accurate — no commission was applied before this migration).
UPDATE "paper_trades"
SET "gross_pnl" = "pnl"
WHERE "gross_pnl" IS NULL;
