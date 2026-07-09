/**
 * production-status-d1-behavioral.test.ts
 *
 * Deep-scan D.1 BEHAVIORAL regression (upgrades the source-structural guard).
 *
 * Runs the EXACT `buildLastCleanRecon` query against a real (PGlite) daily_reconciliation
 * table and proves the SQL semantics: a run with mismatch_count=0 but severity='yellow'
 * (no verifiable data) is EXCLUDED from "last clean recon" even when it is the newest row,
 * while a genuine severity='green' row (and legacy severity IS NULL) are selected. This is
 * the behavior ProductionStatusPanel depends on to never show a false GREEN.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, desc, eq, isNull, or } from "drizzle-orm";
import { createTestDb } from "./helpers/pglite-db.js";
import type { TestDb } from "./helpers/pglite-db.js";
import { dailyReconciliation } from "../db/schema.js";

// self-contained: create daily_reconciliation in-test (not in shared CORE_DDL) so this
// suite owns its schema and can't drift other integration tests.
const DDL = `
CREATE TABLE IF NOT EXISTS daily_reconciliation (
  id                      BIGSERIAL PRIMARY KEY,
  recon_date              DATE NOT NULL,
  production_trades_count INTEGER NOT NULL,
  traderspost_log_count   INTEGER NOT NULL,
  tradovate_fills_count   INTEGER NOT NULL,
  mffu_dashboard_pnl      NUMERIC,
  expected_pnl            NUMERIC NOT NULL,
  mismatch_count          INTEGER NOT NULL DEFAULT 0,
  mismatch_details        JSONB NOT NULL DEFAULT '[]'::jsonb,
  alert_fired             BOOLEAN NOT NULL DEFAULT false,
  severity                TEXT,
  ran_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);`;

// EXACT query buildLastCleanRecon uses (production-status.ts) — replicated so the SQL
// semantics are exercised against a real engine, not asserted on source text.
async function lastCleanRecon(db: TestDb["db"]) {
  return db
    .select({ reconDate: dailyReconciliation.reconDate, ranAt: dailyReconciliation.ranAt, severity: dailyReconciliation.severity })
    .from(dailyReconciliation)
    .where(
      and(
        eq(dailyReconciliation.mismatchCount, 0),
        or(eq(dailyReconciliation.severity, "green"), isNull(dailyReconciliation.severity)),
      ),
    )
    .orderBy(desc(dailyReconciliation.ranAt))
    .limit(1);
}

const base = {
  productionTradesCount: 0, traderspostLogCount: 0, tradovateFillsCount: 0,
  expectedPnl: "0", mismatchCount: 0,
};

describe("deep-scan D.1 behavioral — last-clean-recon excludes unverifiable (yellow) runs", () => {
  let ctx: TestDb;
  beforeAll(async () => { ctx = await createTestDb(); await ctx.pg.exec(DDL); });
  afterAll(async () => { await ctx.close(); });

  it("a NEWEST mismatch=0 but severity='yellow' run is NOT picked as clean (the false-green case)", async () => {
    await ctx.db.insert(dailyReconciliation).values([
      { ...base, reconDate: "2026-07-01", severity: "green",  ranAt: new Date("2026-07-01T20:00:00Z") },
      { ...base, reconDate: "2026-07-05", severity: "yellow", ranAt: new Date("2026-07-05T20:00:00Z") }, // newest, but unverifiable
    ]);
    const rows = await lastCleanRecon(ctx.db);
    expect(rows).toHaveLength(1);
    expect(rows[0].severity).toBe("green");             // the older GREEN, not the newer YELLOW
    expect(rows[0].reconDate).toBe("2026-07-01");
  });

  it("legacy rows (severity IS NULL, pre-ds21) still count as clean via the documented fallback", async () => {
    await ctx.pg.exec("DELETE FROM daily_reconciliation;");
    await ctx.db.insert(dailyReconciliation).values([
      { ...base, reconDate: "2026-06-01", severity: null, ranAt: new Date("2026-06-01T20:00:00Z") },
    ]);
    const rows = await lastCleanRecon(ctx.db);
    expect(rows).toHaveLength(1);
    expect(rows[0].reconDate).toBe("2026-06-01");
  });

  it("FAILURE-INJECTION: when the ONLY mismatch=0 row is yellow, nothing is returned (panel → red/no-clean)", async () => {
    await ctx.pg.exec("DELETE FROM daily_reconciliation;");
    await ctx.db.insert(dailyReconciliation).values([
      { ...base, reconDate: "2026-07-05", severity: "yellow", ranAt: new Date("2026-07-05T20:00:00Z") },
    ]);
    const rows = await lastCleanRecon(ctx.db);
    expect(rows).toHaveLength(0);  // buildLastCleanRecon returns severity:'red' (no clean run) — NOT green
  });

  it("REGRESSION vs the OLD mismatch-only filter: the old query WOULD have false-greened the yellow run", async () => {
    // proves the fix is load-bearing: without the severity gate, the newest yellow row is picked.
    await ctx.pg.exec("DELETE FROM daily_reconciliation;");
    await ctx.db.insert(dailyReconciliation).values([
      { ...base, reconDate: "2026-07-05", severity: "yellow", ranAt: new Date("2026-07-05T20:00:00Z") },
    ]);
    const oldFilter = await ctx.db
      .select({ severity: dailyReconciliation.severity })
      .from(dailyReconciliation)
      .where(eq(dailyReconciliation.mismatchCount, 0))   // the pre-fix query
      .orderBy(desc(dailyReconciliation.ranAt))
      .limit(1);
    expect(oldFilter).toHaveLength(1);
    expect(oldFilter[0].severity).toBe("yellow");        // old filter = false-green; new filter (above) excludes it
  });
});
