/**
 * paper-journal-recon.test.ts — Pass 6 Track A
 *
 * Tests for the paper_journal_recon daily cron (paper-parity reconciliation).
 *
 * Scenarios:
 * 1.  Clean: no DEPLOYED+ strategies — evaluated audit success, no Discord.
 * 2.  Clean: DEPLOYED strategy with matching counts — success audit.
 * 3.  Trade-count mismatch — mismatch_detected critical audit + Discord.
 * 4.  P&L drift exceeding tolerance — critical audit + Discord.
 * 5.  Within-tolerance P&L drift — success audit, no Discord.
 * 6.  Missing TradersPost log row — missing_broker_data warn, no critical.
 * 7a-d. computePnlTolerance: MES/MNQ/MCL per-contract, multi-contract.
 * 8.  computePnlTolerance: 50c floor when tick math is lower.
 * 9.  Strategy fetch failure — fail-CLOSED critical audit + Discord.
 * 10. Two strategies: one mismatch, one clean.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted shared state ─────────────────────────────────────────────────────
// vi.hoisted creates a shared object that vi.mock closures can reference.
// All mutation happens via the shared object fields — never via require() in beforeEach.

const state = vi.hoisted(() => ({
  callIdx: 0,
  responses: [] as unknown[][],
  throwOnCallIdx: -1,
  auditRows: [] as Array<{ action: string; status: string; [key: string]: unknown }>,
  criticalAlerts: [] as Array<{ title: string; body: string }>,
}));

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../../db/index.js", () => ({
  db: {
    select: vi.fn(() => {
      const idx = state.callIdx++;
      if (idx === state.throwOnCallIdx) {
        return {
          from: vi.fn(() => ({
            where: vi.fn(() => { throw new Error("db_error_injected"); }),
            innerJoin: vi.fn(() => ({
              where: vi.fn(() => { throw new Error("db_error_injected"); }),
            })),
          })),
        };
      }
      const response = state.responses[idx] ?? [];
      return {
        from: vi.fn(() => ({
          where: vi.fn(async () => response),
          innerJoin: vi.fn(() => ({
            where: vi.fn(async () => response),
          })),
        })),
      };
    }),
    insert: vi.fn(() => ({
      values: vi.fn((vals: Record<string, unknown>) => {
        if (typeof vals.action === "string") {
          state.auditRows.push({
            action: vals.action,
            status: vals.status as string,
            ...(vals.result as Record<string, unknown>),
          });
        }
        return {
          catch: vi.fn(() => Promise.resolve()),
          then: vi.fn((fn: (v: unknown) => unknown) => Promise.resolve().then(fn)),
          onConflictDoUpdate: vi.fn(() => Promise.resolve()),
        };
      }),
    })),
  },
}));

vi.mock("../../db/schema.js", () => ({
  strategies: {
    tableName: "strategies",
    id: { name: "id" },
    name: { name: "name" },
    symbol: { name: "symbol" },
    lifecycleState: { name: "lifecycle_state" },
  },
  paperTrades: {
    tableName: "paper_trades",
    id: { name: "id" },
    pnl: { name: "pnl" },
    contracts: { name: "contracts" },
    exitTime: { name: "exit_time" },
    entryTime: { name: "entry_time" },
    sessionId: { name: "session_id" },
  },
  paperSessions: {
    tableName: "paper_sessions",
    id: { name: "id" },
    strategyId: { name: "strategy_id" },
  },
  productionTrades: {
    tableName: "production_trades",
    barTimestamp: { name: "bar_timestamp" },
    expectedPnl: { name: "expected_pnl" },
  },
  tradingviewMarkers: {
    tableName: "tradingview_markers",
    strategyId: { name: "strategy_id" },
    barTimestamp: { name: "bar_timestamp" },
  },
  auditLog: { tableName: "audit_log" },
}));

vi.mock("drizzle-orm", () => ({
  eq:      vi.fn((a: unknown, b: unknown) => ({ op: "eq", a, b })),
  and:     vi.fn((...args: unknown[]) => ({ op: "and", args })),
  gte:     vi.fn((a: unknown, b: unknown) => ({ op: "gte", a, b })),
  lt:      vi.fn((a: unknown, b: unknown) => ({ op: "lt", a, b })),
  inArray: vi.fn((col: unknown, vals: unknown) => ({ op: "inArray", col, vals })),
  sql:     vi.fn(() => ({ isSql: true })),
}));

vi.mock("../../lib/logger.js", () => ({
  logger: {
    info:  vi.fn(),
    warn:  vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../../services/notification-service.js", () => ({
  notifyCritical: vi.fn((title: string, body: string) => {
    state.criticalAlerts.push({ title, body });
  }),
  notifyWarning: vi.fn(),
}));

vi.mock("../../lib/notification-helpers.js", () => ({
  appendFamilyGradePostscript: vi.fn(
    (body: string) => `${body} [family-postscript]`
  ),
}));

// ─── Import under test (must come AFTER vi.mock blocks) ──────────────────────

import {
  runPaperJournalRecon,
  computePnlTolerance,
  PAPER_RECON_CONFIG,
} from "../paper-journal-recon.js";

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  state.callIdx = 0;
  state.responses = [];
  state.throwOnCallIdx = -1;
  state.auditRows = [];
  state.criticalAlerts = [];
  vi.clearAllMocks();
  // Re-patch notifyCritical after clearAllMocks (the mock factory reference stays but spy history is reset)
});

// ─── Helper ───────────────────────────────────────────────────────────────────

function setResponses(...responses: unknown[][]) {
  state.responses = responses;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("runPaperJournalRecon — clean runs", () => {

  it("1. no DEPLOYED+ strategies — evaluated audit success, no Discord", async () => {
    setResponses([]);

    const result = await runPaperJournalRecon(new Date("2026-06-23"));

    expect(result.hasDrift).toBe(false);
    expect(result.strategiesEvaluated).toBe(0);
    expect(state.criticalAlerts).toHaveLength(0);

    const evalRow = state.auditRows.find((r) => r.action === "paper_reconciliation.evaluated");
    expect(evalRow).toBeDefined();
    expect(evalRow?.status).toBe("success");
  });

  it("2. DEPLOYED strategy with matching counts and P&L — success audit, no Discord", async () => {
    const strategy = { id: "strat-1", name: "test_strategy", symbol: "MES" };
    const tradeDate = new Date("2026-06-23T15:00:00Z");

    setResponses(
      [strategy],
      [{ id: "trade-1", pnl: "100", contracts: 1, exitTime: tradeDate, entryTime: tradeDate }],
      [{ cnt: "1" }],
      [{ cnt: "1" }],
      [{ total: "100" }],
    );

    const result = await runPaperJournalRecon(new Date("2026-06-23"));

    expect(result.hasDrift).toBe(false);
    expect(result.strategiesEvaluated).toBe(1);
    expect(result.strategiesWithMismatch).toBe(0);
    expect(state.criticalAlerts).toHaveLength(0);

    const evalRow = state.auditRows.find((r) => r.action === "paper_reconciliation.evaluated");
    expect(evalRow?.status).toBe("success");
  });

});

describe("runPaperJournalRecon — drift detection", () => {

  it("3. trade-count mismatch — mismatch_detected critical audit + Discord CRITICAL", async () => {
    const strategy = { id: "strat-2", name: "mismatch_strategy", symbol: "MNQ" };
    const tradeDate = new Date("2026-06-23T14:00:00Z");

    setResponses(
      [strategy],
      [
        { id: "trade-a", pnl: "50", contracts: 1, exitTime: tradeDate, entryTime: tradeDate },
        { id: "trade-b", pnl: "75", contracts: 1, exitTime: tradeDate, entryTime: tradeDate },
      ],
      [{ cnt: "1" }],
      [{ cnt: "2" }],
      [{ total: "125" }],
    );

    const result = await runPaperJournalRecon(new Date("2026-06-23"));

    expect(result.hasDrift).toBe(true);
    expect(result.strategiesWithMismatch).toBe(1);

    const mismatchRow = state.auditRows.find(
      (r) => r.action === "paper_reconciliation.mismatch_detected"
    );
    expect(mismatchRow).toBeDefined();
    expect(mismatchRow?.status).toBe("failure");

    expect(state.criticalAlerts).toHaveLength(1);
    expect(state.criticalAlerts[0]!.title).toContain("PAPER RECON");
    expect(state.criticalAlerts[0]!.body).toContain("[family-postscript]");
  });

  it("4. P&L drift exceeding tolerance — critical audit + Discord", async () => {
    const strategy = { id: "strat-3", name: "pnl_drift_strategy", symbol: "MES" };
    const tradeDate = new Date("2026-06-23T13:00:00Z");

    setResponses(
      [strategy],
      [{ id: "trade-x", pnl: "200", contracts: 1, exitTime: tradeDate, entryTime: tradeDate }],
      [{ cnt: "1" }],
      [{ cnt: "1" }],
      [{ total: "150" }],
    );

    const result = await runPaperJournalRecon(new Date("2026-06-23"));

    expect(result.hasDrift).toBe(true);
    const stratResult = result.results[0]!;
    expect(stratResult.pnlDriftExceedsTolerance).toBe(true);
    expect(stratResult.pnlDriftDollars).toBeCloseTo(50, 1);

    const mismatchRow = state.auditRows.find(
      (r) => r.action === "paper_reconciliation.mismatch_detected"
    );
    expect(mismatchRow).toBeDefined();
    expect(state.criticalAlerts).toHaveLength(1);
  });

  it("5. within-tolerance P&L drift — success audit, no Discord", async () => {
    const strategy = { id: "strat-4", name: "within_tol_strategy", symbol: "MES" };
    const tradeDate = new Date("2026-06-23T12:00:00Z");

    setResponses(
      [strategy],
      [{ id: "trade-y", pnl: "100.00", contracts: 1, exitTime: tradeDate, entryTime: tradeDate }],
      [{ cnt: "1" }],
      [{ cnt: "1" }],
      [{ total: "99.75" }],
    );

    const result = await runPaperJournalRecon(new Date("2026-06-23"));

    expect(result.hasDrift).toBe(false);
    const stratResult = result.results[0]!;
    expect(stratResult.pnlDriftExceedsTolerance).toBe(false);
    expect(state.criticalAlerts).toHaveLength(0);

    const evalRow = state.auditRows.find((r) => r.action === "paper_reconciliation.evaluated");
    expect(evalRow?.status).toBe("success");
  });

  it("6. missing broker row — missing_broker_data warn audit, no Discord", async () => {
    const strategy = { id: "strat-5", name: "broker_offline_strategy", symbol: "MCL" };
    const tradeDate = new Date("2026-06-23T11:00:00Z");

    setResponses(
      [strategy],
      [{ id: "trade-z", pnl: "50", contracts: 1, exitTime: tradeDate, entryTime: tradeDate }],
      [{ cnt: "0" }],
      [{ cnt: "1" }],
      [{ total: "0" }],
    );

    const result = await runPaperJournalRecon(new Date("2026-06-23"));

    expect(result.hasDrift).toBe(false);
    expect(result.strategiesWithMissingBrokerData).toBe(1);

    const warnRow = state.auditRows.find(
      (r) => r.action === "paper_reconciliation.missing_broker_data"
    );
    expect(warnRow).toBeDefined();
    expect(warnRow?.status).toBe("success");
    expect(state.criticalAlerts).toHaveLength(0);
  });

});

describe("runPaperJournalRecon — fail-CLOSED", () => {

  it("9. strategy SELECT throws — fail-CLOSED: critical audit + Discord", async () => {
    state.throwOnCallIdx = 0;

    const result = await runPaperJournalRecon(new Date("2026-06-23"));

    expect(result.hasDrift).toBe(true);
    expect(result.strategiesEvaluated).toBe(0);

    const mismatchRow = state.auditRows.find(
      (r) => r.action === "paper_reconciliation.mismatch_detected"
    );
    expect(mismatchRow).toBeDefined();
    expect(state.criticalAlerts).toHaveLength(1);
  });

});

describe("runPaperJournalRecon — multi-strategy", () => {

  it("10. two strategies: one mismatch, one clean — correct results, 1 Discord", async () => {
    const s1 = { id: "strat-10a", name: "clean_strategy",    symbol: "MES" };
    const s2 = { id: "strat-10b", name: "mismatch_strategy", symbol: "MNQ" };
    const tradeDate = new Date("2026-06-23T10:00:00Z");

    setResponses(
      [s1, s2],
      // s1 (clean)
      [{ id: "t1", pnl: "100", contracts: 1, exitTime: tradeDate, entryTime: tradeDate }],
      [{ cnt: "1" }],
      [{ cnt: "1" }],
      [{ total: "100" }],
      // s2 (2 paper, 1 broker => mismatch)
      [
        { id: "t2a", pnl: "50", contracts: 1, exitTime: tradeDate, entryTime: tradeDate },
        { id: "t2b", pnl: "50", contracts: 1, exitTime: tradeDate, entryTime: tradeDate },
      ],
      [{ cnt: "1" }],
      [{ cnt: "2" }],
      [{ total: "100" }],
    );

    const result = await runPaperJournalRecon(new Date("2026-06-23"));

    expect(result.strategiesEvaluated).toBe(2);
    expect(result.strategiesWithMismatch).toBe(1);
    expect(result.hasDrift).toBe(true);

    const clean    = result.results.find((r) => r.strategyId === "strat-10a");
    const mismatch = result.results.find((r) => r.strategyId === "strat-10b");
    expect(clean?.countMismatch).toBe(false);
    expect(mismatch?.countMismatch).toBe(true);

    expect(state.criticalAlerts).toHaveLength(1);
  });

});

// ─── computePnlTolerance unit tests ──────────────────────────────────────────

describe("computePnlTolerance", () => {

  it("7a. MES 1 contract: MAX(0.50, 2 * 1.25 * 1) = 2.50", () => {
    expect(computePnlTolerance("MES", 1)).toBeCloseTo(2.5, 4);
  });

  it("7b. MNQ 1 contract: MAX(0.50, 2 * 0.50 * 1) = 1.00", () => {
    expect(computePnlTolerance("MNQ", 1)).toBeCloseTo(1.0, 4);
  });

  it("7c. MCL 1 contract: MAX(0.50, 2 * 1.00 * 1) = 2.00", () => {
    expect(computePnlTolerance("MCL", 1)).toBeCloseTo(2.0, 4);
  });

  it("7d. MES 3 contracts: MAX(0.50, 2 * 1.25 * 3) = 7.50", () => {
    expect(computePnlTolerance("MES", 3)).toBeCloseTo(7.5, 4);
  });

  it("8. unknown symbol, 0 contracts — 50c floor dominates", () => {
    expect(computePnlTolerance("UNKWN", 0)).toBeCloseTo(0.5, 4);
  });

  it("PAPER_RECON_CONFIG defaults are sensible", () => {
    expect(PAPER_RECON_CONFIG.PNL_FLOOR_DOLLARS).toBe(0.50);
    expect(PAPER_RECON_CONFIG.BAR_WINDOW_MINUTES).toBe(5);
    expect(PAPER_RECON_CONFIG.DEPLOYED_PLUS_STATES).toContain("PAPER");
    expect(PAPER_RECON_CONFIG.DEPLOYED_PLUS_STATES).toContain("DEPLOYED");
    expect(PAPER_RECON_CONFIG.DEPLOYED_PLUS_STATES).toContain("PILOT");
  });

});
