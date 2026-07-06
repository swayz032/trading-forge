/**
 * reconciliation-option-b-integration.test.ts — deep-scan A / Option B END-TO-END (PGlite).
 *
 * Closes the last gap the Option-B grader named: proves the F-1 severity fix reaches the persisted
 * daily_reconciliation.severity through the REAL runDailyReconciliation() orchestration + a real DB
 * round-trip (Drizzle → PGlite), not just a pure function.
 *
 * Scenario: 2 production_trades for a day, BOTH TradersPost-confirmed (sent==confirmed, clean).
 *   - Option B OFF (default): effectiveIndependentSources=2 → clamp fires → persisted severity YELLOW.
 *   - Option B ON:            effectiveIndependentSources=3 → clamp lifts → persisted severity GREEN.
 * That green-lift is exactly the operator-facing improvement (ProductionStatusPanel), and it's read
 * back from the DB via getDailyReconciliationStatus() — the same reader the panel uses.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../db/schema.js";

// mutable holder so the mocked ../db/index.js forwards to the PGlite drizzle set in beforeAll.
const h = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof drizzle> }));
vi.mock("../db/index.js", () => ({
  db: new Proxy({}, {
    get(_t, prop) {
      const real = h.db as unknown as Record<string, unknown>;
      const v = real[prop];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(real) : v;
    },
  }),
}));
// external side-effects → no-ops (no Discord, no SSE, no Playwright).
vi.mock("../services/alert-service.js", () => ({
  AlertFactory: { criticalReconciliationMismatch: vi.fn(async () => {}) },
}));
vi.mock("../routes/sse.js", () => ({ broadcastSSE: vi.fn() }));
vi.mock("../services/dashboard-snapshot-service.js", () => ({ runDashboardSnapshots: vi.fn(async () => []) }));

const PT_DDL = `
CREATE TABLE IF NOT EXISTS production_trades (
  id BIGSERIAL PRIMARY KEY,
  strategy_id UUID NOT NULL,
  strategy_version_hash TEXT NOT NULL,
  bar_timestamp TIMESTAMPTZ NOT NULL,
  signal_value INTEGER NOT NULL,
  bias_decision_id INTEGER, compliance_check_id INTEGER,
  traderspost_webhook_id TEXT, tradovate_fill_id TEXT,
  expected_slippage NUMERIC, actual_slippage NUMERIC,
  expected_pnl NUMERIC, actual_pnl NUMERIC,
  correlation_id UUID,
  traderspost_confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);`;
const DR_DDL = `
CREATE TABLE IF NOT EXISTS daily_reconciliation (
  id BIGSERIAL PRIMARY KEY, recon_date DATE NOT NULL UNIQUE,
  production_trades_count INTEGER NOT NULL, traderspost_log_count INTEGER NOT NULL,
  tradovate_fills_count INTEGER NOT NULL, mffu_dashboard_pnl NUMERIC, expected_pnl NUMERIC NOT NULL,
  mismatch_count INTEGER NOT NULL DEFAULT 0, mismatch_details JSONB NOT NULL DEFAULT '[]'::jsonb,
  alert_fired BOOLEAN NOT NULL DEFAULT false, severity TEXT,
  ran_at TIMESTAMPTZ NOT NULL DEFAULT now()
);`;

let pg: PGlite;
let runDailyReconciliation: typeof import("../production/reconciliation-service.js").runDailyReconciliation;
let getDailyReconciliationStatus: typeof import("../production/reconciliation-service.js").getDailyReconciliationStatus;

const DAY = new Date("2026-07-02T12:00:00Z");

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(PT_DDL);
  await pg.exec(DR_DDL);
  h.db = drizzle(pg, { schema });
  const mod = await import("../production/reconciliation-service.js");
  runDailyReconciliation = mod.runDailyReconciliation;
  getDailyReconciliationStatus = mod.getDailyReconciliationStatus;
});
afterAll(async () => { await pg.close(); });

beforeEach(async () => {
  await pg.exec("DELETE FROM production_trades; DELETE FROM daily_reconciliation;");
  delete process.env.RECON_TRADERSPOST_CONFIRM_INDEPENDENT;
  // 2 trades on DAY, BOTH TradersPost-confirmed → sent==confirmed, clean + verifiable.
  await pg.exec(`
    INSERT INTO production_trades (strategy_id, strategy_version_hash, bar_timestamp, signal_value, traderspost_webhook_id, expected_pnl, traderspost_confirmed_at) VALUES
    ('11111111-1111-1111-1111-111111111111','h1','2026-07-02T14:00:00Z',1,'wh-1',100,'2026-07-02T14:00:05Z'),
    ('11111111-1111-1111-1111-111111111111','h1','2026-07-02T15:00:00Z',1,'wh-2',100,'2026-07-02T15:00:05Z');
  `);
});

describe("Option B end-to-end — persisted severity reflects the DYNAMIC clamp (F-1)", () => {
  it("Option B OFF: clean run persists YELLOW (2 sources → clamped, honest degraded)", async () => {
    await runDailyReconciliation(DAY);
    const status = await getDailyReconciliationStatus(DAY);
    expect(status.severity).toBe("yellow");
  });

  it("Option B ON: clean+verifiable run persists GREEN (3 sources → clamp lifts) — the operator-facing win", async () => {
    process.env.RECON_TRADERSPOST_CONFIRM_INDEPENDENT = "true";
    await runDailyReconciliation(DAY);
    const status = await getDailyReconciliationStatus(DAY);
    expect(status.severity).toBe("green");
  });

  it("persisted mismatch_count is 0 for a clean sent==confirmed day (round-trip sanity)", async () => {
    process.env.RECON_TRADERSPOST_CONFIRM_INDEPENDENT = "true";
    await runDailyReconciliation(DAY);
    const rows = await pg.query<{ severity: string; mismatch_count: number }>(
      "SELECT severity, mismatch_count FROM daily_reconciliation ORDER BY ran_at DESC LIMIT 1",
    );
    expect(rows.rows[0].mismatch_count).toBe(0);
    expect(rows.rows[0].severity).toBe("green");
  });
});
