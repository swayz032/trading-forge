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
    id: { name: "id" },
    strategyId: { name: "strategy_id" },   // Finding 3 fix: needed for per-strategy SUM filter
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
      [{ cnt: "1" }], // deepscan14 C1: broker-tape-source-active global probe — tape IS active
      [{ id: "trade-1", pnl: "100", contracts: 1, exitTime: tradeDate, entryTime: tradeDate }],
      [{ cnt: "1" }],
      [{ cnt: "1" }],
      [{ total: "100" , populated: "1" }],
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
      [{ cnt: "1" }], // deepscan14 C1: broker-tape-source-active global probe — tape IS active
      [
        { id: "trade-a", pnl: "50", contracts: 1, exitTime: tradeDate, entryTime: tradeDate },
        { id: "trade-b", pnl: "75", contracts: 1, exitTime: tradeDate, entryTime: tradeDate },
      ],
      [{ cnt: "1" }],
      [{ cnt: "2" }],
      [{ total: "125" , populated: "1" }],
    );

    const result = await runPaperJournalRecon(new Date("2026-06-23"));

    expect(result.hasDrift).toBe(true);
    expect(result.strategiesWithMismatch).toBe(1);

    const mismatchRow = state.auditRows.find(
      (r) => r.action === "paper_reconciliation.mismatch_detected"
    );
    expect(mismatchRow).toBeDefined();
    expect(mismatchRow?.status).toBe("critical"); // verbatim severity (MED fix 2026-07-09; was remapped to failure)

    expect(state.criticalAlerts).toHaveLength(1);
    expect(state.criticalAlerts[0]!.title).toContain("PAPER RECON");
    expect(state.criticalAlerts[0]!.body).toContain("[family-postscript]");
  });

  it("4. P&L drift exceeding tolerance — critical audit + Discord", async () => {
    const strategy = { id: "strat-3", name: "pnl_drift_strategy", symbol: "MES" };
    const tradeDate = new Date("2026-06-23T13:00:00Z");

    setResponses(
      [strategy],
      [{ cnt: "1" }], // deepscan14 C1: broker-tape-source-active global probe — tape IS active
      [{ id: "trade-x", pnl: "200", contracts: 1, exitTime: tradeDate, entryTime: tradeDate }],
      [{ cnt: "1" }],
      [{ cnt: "1" }],
      [{ total: "150" , populated: "1" }],
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
      [{ cnt: "1" }], // deepscan14 C1: broker-tape-source-active global probe — tape IS active
      [{ id: "trade-y", pnl: "100.00", contracts: 1, exitTime: tradeDate, entryTime: tradeDate }],
      [{ cnt: "1" }],
      [{ cnt: "1" }],
      [{ total: "99.75" , populated: "1" }],
    );

    const result = await runPaperJournalRecon(new Date("2026-06-23"));

    expect(result.hasDrift).toBe(false);
    const stratResult = result.results[0]!;
    expect(stratResult.pnlDriftExceedsTolerance).toBe(false);
    expect(state.criticalAlerts).toHaveLength(0);

    const evalRow = state.auditRows.find((r) => r.action === "paper_reconciliation.evaluated");
    expect(evalRow?.status).toBe("success");
  });

  it("6. missing broker row (tape source otherwise active) — missing_broker_data warn audit, no Discord", async () => {
    const strategy = { id: "strat-5", name: "broker_offline_strategy", symbol: "MCL" };
    const tradeDate = new Date("2026-06-23T11:00:00Z");

    setResponses(
      [strategy],
      // deepscan14 C1: broker-tape-source-active global probe returns "active"
      // (some OTHER row exists in production_trades) — so THIS strategy's
      // zero-count-today is a genuine per-day miss, not the structural gap.
      [{ cnt: "1" }],
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
    expect(warnRow?.status).toBe("warning"); // verbatim severity (MED fix 2026-07-09; was remapped to success)
    expect(state.criticalAlerts).toHaveLength(0);
  });

  it("7. deep-scan Accuracy CRITICAL — production_trades rows exist but expected_pnl ALL NULL → NO false CRITICAL (failure-injection of the real broker-router condition)", async () => {
    // broker-router.ts writes expected_pnl=null unconditionally (no server-mediated fill ingest yet).
    // The bug: coalesce(sum(expected_pnl),0)=0 → |paperPnl - 0| = paperPnl > tolerance → false CRITICAL.
    // This test injects the REAL production condition (rows EXIST, every expected_pnl NULL) that the
    // other tests' mocks hid by fabricating a nonzero `total`. count(expected_pnl)=0 is the tell.
    const strategy = { id: "strat-null-pnl", name: "null_expected_pnl", symbol: "MES" };
    const tradeDate = new Date("2026-06-23T13:00:00Z");

    setResponses(
      [strategy],
      [{ cnt: "1" }],                                                                            // tape-source-active probe
      [{ id: "trade-real", pnl: "300", contracts: 1, exitTime: tradeDate, entryTime: tradeDate }], // real paper P&L $300
      [{ cnt: "1" }],                                                                            // broker trade count = 1 (rows EXIST)
      [{ cnt: "1" }],                                                                            // tradingview markers
      [{ total: "0", populated: "0" }],                                                          // rows exist, expected_pnl ALL NULL
    );

    const result = await runPaperJournalRecon(new Date("2026-06-23"));

    const stratResult = result.results[0]!;
    expect(stratResult.brokerPnlUnavailable).toBe(true);          // detected the unpopulated column
    expect(stratResult.pnlDriftExceedsTolerance).toBe(false);     // NOT a false drift
    expect(stratResult.pnlDriftDollars).toBeNull();               // drift not computed at all
    expect(result.hasDrift).toBe(false);
    expect(state.criticalAlerts).toHaveLength(0);                 // NO false CRITICAL Discord (the bug's symptom)
    // Honest, not false-clean: a distinct WARN audit surfaces that P&L was NOT verified.
    const warnRow = state.auditRows.find((r) => r.action === "paper_reconciliation.broker_pnl_unavailable");
    expect(warnRow).toBeDefined();
    expect(warnRow?.status).toBe("warning"); // verbatim severity (MED fix 2026-07-09; was remapped to success)
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
      [{ cnt: "1" }], // deepscan14 C1: broker-tape-source-active global probe (once per run)
      // s1 (clean)
      [{ id: "t1", pnl: "100", contracts: 1, exitTime: tradeDate, entryTime: tradeDate }],
      [{ cnt: "1" }],
      [{ cnt: "1" }],
      [{ total: "100" , populated: "1" }],
      // s2 (2 paper, 1 broker => mismatch)
      [
        { id: "t2a", pnl: "50", contracts: 1, exitTime: tradeDate, entryTime: tradeDate },
        { id: "t2b", pnl: "50", contracts: 1, exitTime: tradeDate, entryTime: tradeDate },
      ],
      [{ cnt: "1" }],
      [{ cnt: "2" }],
      [{ total: "100" , populated: "1" }],
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

// ─── deepscan14 C1 — broker-tape-source-active detection ────────────────────
//
// production_trades (the broker-tape proxy this recon joins against) has never
// been populated by any real TradersPost ingest pipeline. Before this fix, every
// missingBrokerData case wrote the SAME `missing_broker_data` warn regardless of
// whether the gap was structural (no ingest exists) or a genuine per-day miss —
// making "verified nothing" indistinguishable from "checked, all clean."
//
// These tests verify the new distinct `inactive_no_broker_tape` action fires
// when the global broker-tape-source probe finds zero rows anywhere, and that
// the top-level result surfaces `brokerTapeSourceActive` / `reconciliationInactive`
// so callers can no longer read `hasDrift: false` as "passing."

describe("runPaperJournalRecon — deepscan14 C1: broker-tape-source-active detection", () => {

  it("13. tape source globally EMPTY — inactive_no_broker_tape (NOT missing_broker_data), reconciliationInactive=true", async () => {
    const strategy = { id: "strat-c1a", name: "no_ingest_strategy", symbol: "MES" };
    const tradeDate = new Date("2026-07-01T15:00:00Z");

    setResponses(
      [strategy],
      [{ cnt: "0" }], // global probe: production_trades has ZERO rows anywhere
      [{ id: "trade-c1a", pnl: "100", contracts: 1, exitTime: tradeDate, entryTime: tradeDate }],
      [{ cnt: "0" }], // per-strategy broker count — also zero (consistent with "nothing ingested")
      [{ cnt: "1" }],
    );

    const result = await runPaperJournalRecon(new Date("2026-07-01"));

    expect(result.brokerTapeSourceActive).toBe(false);
    expect(result.reconciliationInactive).toBe(true);
    // hasDrift stays false — missingBrokerData strategies are excluded from
    // the mismatch calc by design (nothing to compare against), but that must
    // NOT be read as "clean."
    expect(result.hasDrift).toBe(false);

    const inactiveRow = state.auditRows.find(
      (r) => r.action === "paper_reconciliation.inactive_no_broker_tape"
    );
    expect(inactiveRow).toBeDefined();
    expect(inactiveRow?.status).toBe("warning"); // verbatim severity (MED fix 2026-07-09; was remapped to success)
    expect((inactiveRow as unknown as { affected_strategy_ids: string[] }).affected_strategy_ids).toContain("strat-c1a");

    // The old per-strategy warn must NOT fire in the structural-gap case.
    const legacyWarnRow = state.auditRows.find(
      (r) => r.action === "paper_reconciliation.missing_broker_data"
    );
    expect(legacyWarnRow).toBeUndefined();

    // Top-level evaluated row must carry the honesty fields too (queryable
    // without needing to find the dedicated inactive row).
    const evalRow = state.auditRows.find((r) => r.action === "paper_reconciliation.evaluated");
    expect((evalRow as unknown as { broker_tape_source_active: boolean }).broker_tape_source_active).toBe(false);
    expect((evalRow as unknown as { reconciliation_inactive: boolean }).reconciliation_inactive).toBe(true);
  });

  it("14. global probe query THROWS — fail-LOUD: treated as inactive, not silently active", async () => {
    const strategy = { id: "strat-c1b", name: "probe_error_strategy", symbol: "MNQ" };
    const tradeDate = new Date("2026-07-01T14:00:00Z");

    setResponses(
      [strategy],
      [], // unused — throwOnCallIdx intercepts this call
      [{ id: "trade-c1b", pnl: "50", contracts: 1, exitTime: tradeDate, entryTime: tradeDate }],
      [{ cnt: "0" }],
      [{ cnt: "1" }],
    );
    state.throwOnCallIdx = 1; // the global broker-tape-source-active probe call

    const result = await runPaperJournalRecon(new Date("2026-07-01"));

    // Fail-loud contract: a probe error must NOT silently assume the tape is
    // healthy — it must default to inactive (conservative).
    expect(result.brokerTapeSourceActive).toBe(false);
    expect(result.reconciliationInactive).toBe(true);

    const inactiveRow = state.auditRows.find(
      (r) => r.action === "paper_reconciliation.inactive_no_broker_tape"
    );
    expect(inactiveRow).toBeDefined();
  });

  it("15. tape source ACTIVE elsewhere, this strategy's day is a genuine miss — old missing_broker_data path unaffected", async () => {
    const strategy = { id: "strat-c1c", name: "genuine_miss_strategy", symbol: "MCL" };
    const tradeDate = new Date("2026-07-01T13:00:00Z");

    setResponses(
      [strategy],
      [{ cnt: "1" }], // global probe: tape source IS populated (elsewhere)
      [{ id: "trade-c1c", pnl: "25", contracts: 1, exitTime: tradeDate, entryTime: tradeDate }],
      [{ cnt: "0" }], // this strategy/day: genuinely zero broker rows
      [{ cnt: "1" }],
    );

    const result = await runPaperJournalRecon(new Date("2026-07-01"));

    expect(result.brokerTapeSourceActive).toBe(true);
    expect(result.reconciliationInactive).toBe(false);

    const legacyWarnRow = state.auditRows.find(
      (r) => r.action === "paper_reconciliation.missing_broker_data"
    );
    expect(legacyWarnRow).toBeDefined();

    const inactiveRow = state.auditRows.find(
      (r) => r.action === "paper_reconciliation.inactive_no_broker_tape"
    );
    expect(inactiveRow).toBeUndefined();
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
    expect(PAPER_RECON_CONFIG.DEPLOYED_PLUS_STATES).toContain("DEPLOYED");
    expect(PAPER_RECON_CONFIG.DEPLOYED_PLUS_STATES).toContain("PILOT");
  });

  it("DEPLOYED_PLUS_STATES excludes PAPER post-M3 (2026-07-17) — PAPER-state strategies use the internal engine exclusively and never route through the broker, so reconciling them against a broker tape is a contract mismatch, not a safety check", () => {
    expect(PAPER_RECON_CONFIG.DEPLOYED_PLUS_STATES).not.toContain("PAPER");
    expect(PAPER_RECON_CONFIG.DEPLOYED_PLUS_STATES).toEqual(["DEPLOY_READY", "PILOT", "DEPLOYED"]);
  });

});

// ─── Finding 3: broker P&L SUM must be per-strategy (not combined) ───────────
//
// BUG: the SUM query for pnlDriftDollars was missing eq(productionTrades.strategyId,
// strategy.id). With 2+ DEPLOYED strategies on the same day, strategy A's drift was
// computed against ALL strategies' broker P&L — causing false CRITICAL drift alerts
// when strategy B had a large P&L and A's paper P&L was small.
//
// REGRESSION TEST: Two strategies. Strategy A: paper=$100, broker-SUM=$100 (clean).
// Strategy B: paper=$400, broker-SUM=$400 (clean). Each must report NO drift.
// If the filter was missing, strategy A's broker SUM would return $500 (combined),
// yielding $400 drift → false CRITICAL. The test verifies both show clean.
// ─────────────────────────────────────────────────────────────────────────────

describe("Finding 3 — broker P&L SUM must be per-strategy, not combined", () => {

  it("11. two strategies with identical paper/broker P&L each show no drift (per-strategy isolation)", async () => {
    const stratA = { id: "strat-f3a", name: "strategy_a", symbol: "MES" };
    const stratB = { id: "strat-f3b", name: "strategy_b", symbol: "MNQ" };
    const tradeDate = new Date("2026-06-28T15:00:00Z");

    // Call sequence with 2 strategies, each with 1 paper trade:
    // 0: strategies list
    // 1: paper_trades for strat-f3a (1 trade, $100)
    // 2: broker COUNT for strat-f3a (1)
    // 3: TradingView COUNT for strat-f3a (1)
    // 4: broker P&L SUM for strat-f3a ($100 — per-strategy, no drift)
    // 5: paper_trades for strat-f3b (1 trade, $400)
    // 6: broker COUNT for strat-f3b (1)
    // 7: TradingView COUNT for strat-f3b (1)
    // 8: broker P&L SUM for strat-f3b ($400 — per-strategy, no drift)
    setResponses(
      [stratA, stratB],
      [{ cnt: "1" }], // deepscan14 C1: broker-tape-source-active global probe (once per run)
      // strategy A
      [{ id: "ta-1", pnl: "100", contracts: 1, exitTime: tradeDate, entryTime: tradeDate }],
      [{ cnt: "1" }],  // broker count A
      [{ cnt: "1" }],  // tv count A
      [{ total: "100" , populated: "1" }],  // broker SUM A — matches paper ($100 each = no drift)
      [{ id: 1, barTimestamp: tradeDate, expectedPnl: "100" }], // per-trade rows A
      // strategy B
      [{ id: "tb-1", pnl: "400", contracts: 1, exitTime: tradeDate, entryTime: tradeDate }],
      [{ cnt: "1" }],  // broker count B
      [{ cnt: "1" }],  // tv count B
      [{ total: "400" , populated: "1" }],  // broker SUM B — matches paper ($400 each = no drift)
      [{ id: 2, barTimestamp: tradeDate, expectedPnl: "400" }], // per-trade rows B
    );

    const result = await runPaperJournalRecon(new Date("2026-06-28"));

    expect(result.strategiesEvaluated).toBe(2);
    expect(result.strategiesWithMismatch).toBe(0);
    expect(result.hasDrift).toBe(false);
    // No CRITICAL alert — both strategies are clean
    expect(state.criticalAlerts).toHaveLength(0);

    const resultA = result.results.find((r) => r.strategyId === "strat-f3a");
    const resultB = result.results.find((r) => r.strategyId === "strat-f3b");
    expect(resultA?.pnlDriftExceedsTolerance).toBe(false);
    expect(resultB?.pnlDriftExceedsTolerance).toBe(false);
  });

  it("12. two strategies: one clean, one with P&L drift — only the drifting one fires CRITICAL", async () => {
    const stratA = { id: "strat-f3c", name: "clean_strategy",   symbol: "MES" };
    const stratB = { id: "strat-f3d", name: "drifting_strategy", symbol: "MNQ" };
    const tradeDate = new Date("2026-06-28T14:00:00Z");

    // strategy A: paper=$100, broker=$100 (clean)
    // strategy B: paper=$200, broker=$50  (drift=$150, exceeds MNQ 2-tick=$1 tolerance)
    setResponses(
      [stratA, stratB],
      [{ cnt: "1" }], // deepscan14 C1: broker-tape-source-active global probe (once per run)
      // A
      [{ id: "ta-2", pnl: "100", contracts: 1, exitTime: tradeDate, entryTime: tradeDate }],
      [{ cnt: "1" }], [{ cnt: "1" }],
      [{ total: "100" , populated: "1" }],
      [{ id: 3, barTimestamp: tradeDate, expectedPnl: "100" }],
      // B
      [{ id: "tb-2", pnl: "200", contracts: 1, exitTime: tradeDate, entryTime: tradeDate }],
      [{ cnt: "1" }], [{ cnt: "1" }],
      [{ total: "50" , populated: "1" }],   // $150 drift — CRITICAL for MNQ (tolerance=1.00)
      [{ id: 4, barTimestamp: tradeDate, expectedPnl: "50" }],
    );

    const result = await runPaperJournalRecon(new Date("2026-06-28"));

    expect(result.strategiesEvaluated).toBe(2);
    expect(result.strategiesWithMismatch).toBe(1);
    expect(result.hasDrift).toBe(true);

    const resultA = result.results.find((r) => r.strategyId === "strat-f3c");
    const resultB = result.results.find((r) => r.strategyId === "strat-f3d");
    // Strategy A is clean — no drift
    expect(resultA?.pnlDriftExceedsTolerance).toBe(false);
    // Strategy B has drift
    expect(resultB?.pnlDriftExceedsTolerance).toBe(true);
    // The same drifting strategy emits both independent safety signals: daily
    // aggregate drift and per-trade drift. Strategy A emits neither.
    expect(state.criticalAlerts).toHaveLength(2);
    expect(state.criticalAlerts.map((alert) => alert.title)).toEqual([
      expect.stringContaining("Drift detected"),
      expect.stringContaining("Per-trade drift detected"),
    ]);
  });

});
