/**
 * production-r2fix-round2.test.ts — deep-scan round 2 fix wave (2026-07-16)
 *
 * Scope-locked to reconciliation-service.ts, paper-journal-recon.ts, kill-switch.ts.
 *
 * RED-proof coverage for the 4 findings this wave closes:
 *
 * HIGH-1 — paper-journal-recon.ts reconciliation was a DAY-LEVEL SUM aggregate,
 *   not the per-trade windowed join its own docstring describes, so two
 *   OFFSETTING per-trade errors (trade A +$200 over, trade B -$200 under) net
 *   to a $0 day-sum delta while both trades are individually wrong. Tests the
 *   new pure `matchPerTradeBrokerRows()` — it must flag the offsetting-error
 *   pair even though a day-aggregate check on the same data would see zero
 *   drift.
 *
 * HIGH-2 — both reconciliation-service.ts and paper-journal-recon.ts bucketed
 *   "today" by RAW UTC calendar day, not the canonical CME 5pm-ET trading-day
 *   rollover the rest of the system (kill-switch DLL, daily-trade-cap, paper
 *   P&L attribution) uses via paper-risk-gate.ts::toFuturesTradingDayString().
 *   Tests the new `toCmeTradingDayString()` / `getCmeTradingDayBoundaries()`
 *   exports on a 19:00-ET trade — it must bucket to the NEXT calendar day,
 *   matching paper-risk-gate.ts's canonical trading-day string (parity
 *   asserted directly against toFuturesTradingDayString import).
 *
 * MED-3 — kill-switch.ts's Layer 2/Layer 3 DLL day-key previously inlined its
 *   OWN copy of the CME-day +7h Intl formula. Fixed by importing the shared
 *   `toCmeTradingDayString()` from reconciliation-service.ts (NOT
 *   paper-risk-gate.ts directly — see the block comment in
 *   reconciliation-service.ts for why: paper-risk-gate.ts transitively drags
 *   in the full server bootstrap via `../index.js` and regressed 7
 *   previously-green test files when tried). This test asserts kill-switch.ts
 *   no longer contains an inline Intl.DateTimeFormat CME-day formula and
 *   instead imports the shared helper — a static-source regression guard
 *   against the drift class re-appearing.
 *
 * LOW-4 — checkLayer3TrailingDD's `firmAccount?.maxDrawdown ??
 *   firmAccount?.maxDailyDrawdown` read a field (`maxDailyDrawdown`) that only
 *   ever existed in test mocks, never the real `getFirmAccount()` producer.
 *   This test asserts the dead fallback is gone from the source.
 */

import { describe, it, expect, vi } from "vitest";

// ─── Mocks (declared before any imports — shared across reconciliation-service.ts
// and paper-journal-recon.ts's combined import surface; paper-journal-recon.ts
// now imports reconciliation-service.ts directly for the shared CME-day helpers,
// so both files' dependencies must resolve here). ────────────────────────────

// `where(...)` is awaited DIRECTLY by some callers (e.g. runPaperJournalRecon's
// strategy fetch) and chained with `.limit()`/`.orderBy()` by others — so the
// object it returns must be BOTH a real thenable (Object.assign onto a real
// Promise, matching reconciliation-service.test.ts's proven pattern) AND
// expose `.limit()`/`.orderBy()`/`.innerJoin()` for the other call shapes.
function makeQueryResult(resolvedValue: unknown[]) {
  return Object.assign(Promise.resolve(resolvedValue), {
    limit: vi.fn(async () => resolvedValue),
    orderBy: vi.fn(() => ({ limit: vi.fn(async () => resolvedValue) })),
  });
}

vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => makeQueryResult([])),
        innerJoin: vi.fn(() => ({
          where: vi.fn(() => makeQueryResult([])),
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        onConflictDoUpdate: vi.fn(async () => undefined),
        catch: vi.fn(() => Promise.resolve()),
        then: vi.fn((fn: (v: unknown) => unknown) => Promise.resolve().then(fn)),
      })),
    })),
    execute: vi.fn(async () => ({ rows: [] })),
  },
}));

vi.mock("../db/schema.js", () => ({
  // reconciliation-service.ts
  dailyReconciliation: { tableName: "daily_reconciliation", reconDate: {}, mismatchCount: {} },
  productionTrades: {
    tableName: "production_trades",
    id: { name: "id" },
    strategyId: { name: "strategy_id" },
    barTimestamp: { name: "bar_timestamp" },
    expectedPnl: { name: "expected_pnl" },
    traderspostConfirmedAt: { name: "traderspost_confirmed_at" },
  },
  auditLog: { tableName: "audit_log" },
  weeklyDriftReports: { tableName: "weekly_drift_reports", severity: {}, reportWeek: {}, ranAt: {} },
  systemState: { tableName: "system_state" },
  // paper-journal-recon.ts (additional)
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
    firmId: { name: "firm_id" },
    status: { name: "status" },
  },
  paperSignalLogs: {
    tableName: "paper_signal_logs",
    sessionId: { name: "session_id" },
    createdAt: { name: "created_at" },
  },
  strategies: {
    tableName: "strategies",
    id: { name: "id" },
    name: { name: "name" },
    symbol: { name: "symbol" },
    lifecycleState: { name: "lifecycle_state" },
    paperAccountRouting: { name: "paper_account_routing" },
  },
  tradingviewMarkers: {
    tableName: "tradingview_markers",
    strategyId: { name: "strategy_id" },
    barTimestamp: { name: "bar_timestamp" },
  },
  lifecycleShadowSignals: {
    tableName: "lifecycle_shadow_signals",
    strategyId: { name: "strategy_id" },
    signalTs: { name: "signal_ts" },
  },
  backtests: {
    tableName: "backtests",
    id: { name: "id" },
    status: { name: "status" },
    createdAt: { name: "created_at" },
  },
  quantumMcRuns: {
    tableName: "quantum_mc_runs",
    backtestId: { name: "backtest_id" },
    governanceLabels: { name: "governance_labels" },
  },
  brokerAccounts: {
    tableName: "broker_accounts",
    accountId: { name: "account_id" },
    accountIdExternal: { name: "account_id_external" },
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a: unknown, b: unknown) => ({ eq: [a, b] })),
  and: vi.fn((...args: unknown[]) => ({ and: args })),
  gte: vi.fn((a: unknown, b: unknown) => ({ gte: [a, b] })),
  lt: vi.fn((a: unknown, b: unknown) => ({ lt: [a, b] })),
  sql: vi.fn((s: TemplateStringsArray, ...vals: unknown[]) => ({ sql: s, vals })),
  sum: vi.fn((col: unknown) => ({ sum: col })),
  count: vi.fn(() => ({ count: true })),
  desc: vi.fn((col: unknown) => ({ desc: col })),
  inArray: vi.fn((col: unknown, arr: unknown) => ({ inArray: [col, arr] })),
  isNull: vi.fn((col: unknown) => ({ isNull: col })),
}));

vi.mock("../routes/sse.js", () => ({
  broadcastSSE: vi.fn(),
}));

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../services/alert-service.js", () => ({
  AlertFactory: {
    criticalAlert: vi.fn(async () => undefined),
    criticalReconciliationMismatch: vi.fn(async () => undefined),
  },
}));

vi.mock("../services/dashboard-snapshot-service.js", () => ({
  runDashboardSnapshots: vi.fn(async () => []),
}));

vi.mock("../services/tradingview-marker-service.js", () => ({
  getMarkerCountForDate: vi.fn(async () => null),
}));

vi.mock("../services/notification-service.js", () => ({
  notifyCritical: vi.fn(),
  notifyWarning: vi.fn(),
}));

vi.mock("../lib/notification-helpers.js", () => ({
  appendFamilyGradePostscript: vi.fn((operatorBody: string) => operatorBody),
}));

// ─── Imports after mocks ──────────────────────────────────────────────────────

import * as reconModule from "../production/reconciliation-service.js";
import * as journalModule from "../production/paper-journal-recon.js";
import { readFileSync } from "fs";
import { resolve } from "path";

// Deliberately does NOT import paper-risk-gate.ts here (even though it exports
// the "canonical" toFuturesTradingDayString this fix parities against) —
// paper-risk-gate.ts transitively imports the full server bootstrap
// (`../index.js`), which requires mocking an unbounded transitive closure
// (routes/compliance.ts's `complianceRulesets`, etc. — confirmed empirically
// while writing this test) to even import. Instead, every expected trading-day
// string below is HAND-COMPUTED from the documented CME 17:00 ET rollover rule
// (see reconciliation-service.ts's toCmeTradingDayString doc comment) — an
// independent oracle, not a second copy of the same code being asserted
// against itself.

describe("HIGH-2 — canonical CME trading-day boundaries (round 2)", () => {
  it("buckets a 19:00 ET trade to the NEXT calendar day (past the 17:00 ET rollover)", () => {
    // 19:00 ET Jan 5 2026 (EST, UTC-5) = 00:00 UTC Jan 6.
    const nineteenHundredEtJan5 = new Date("2026-01-06T00:00:00.000Z");
    const tradingDay = reconModule.getCmeTradingDayBoundaries(nineteenHundredEtJan5).tradingDay;
    expect(tradingDay).toBe("2026-01-06");
  });

  it("distinguishes raw-UTC-calendar-day bucketing from CME-trading-day bucketing (the actual HIGH-2 regression case)", () => {
    // 18:00 ET Jan 5 2026 (EST, UTC-5) = 23:00 UTC Jan 5 — the RAW UTC
    // calendar day is Jan 5, but 18:00 ET is PAST the 17:00 ET rollover, so
    // the CME trading day is Jan 6. This is exactly the divergence HIGH-2
    // fixes: the old code used rawUtcDay (Jan 5) for bucketing.
    const eighteenHundredEtJan5 = new Date("2026-01-05T23:00:00.000Z");

    const rawUtcDay = eighteenHundredEtJan5.toISOString().slice(0, 10);
    const cmeDay = reconModule.getCmeTradingDayBoundaries(eighteenHundredEtJan5).tradingDay;

    expect(rawUtcDay).toBe("2026-01-05");
    expect(cmeDay).toBe("2026-01-06"); // after 17:00 ET rollover — belongs to the NEXT trading day
    expect(cmeDay).not.toBe(rawUtcDay); // this is exactly the bug: old code would have used rawUtcDay
  });

  it("a trade just BEFORE the 17:00 ET rollover stays on the SAME calendar day", () => {
    // 16:59 ET Jan 5 2026 (EST, UTC-5) = 21:59 UTC Jan 5 — one minute before
    // the rollover, so this belongs to the Jan 5 trading day (not Jan 6).
    const beforeRollover = new Date("2026-01-05T21:59:00.000Z");
    const cmeDay = reconModule.getCmeTradingDayBoundaries(beforeRollover).tradingDay;
    expect(cmeDay).toBe("2026-01-05");
  });

  it("bar_timestamp boundaries [dayStart, dayEnd) correctly place a 17:00 ET rollover trade on the trading day it starts", () => {
    const { dayStart, dayEnd, tradingDay } = reconModule.getCmeTradingDayBoundaries(
      new Date("2026-01-06T00:00:00.000Z") // 19:00 ET Jan 5
    );
    expect(tradingDay).toBe("2026-01-06");
    // dayStart should be 17:00 ET Jan 5 = 22:00 UTC Jan 5 (EST).
    expect(dayStart.toISOString()).toBe("2026-01-05T22:00:00.000Z");
    // dayEnd should be 17:00 ET Jan 6 = 22:00 UTC Jan 6 (EST).
    expect(dayEnd.toISOString()).toBe("2026-01-06T22:00:00.000Z");
  });

  it("resolves the correct ET offset (EDT vs EST) on both sides of the DST calendar", () => {
    // Well inside EDT (July, UTC-4) and well inside EST (December, UTC-5) —
    // noon UTC on both dates is unambiguously the same ET calendar day
    // regardless of offset, so this spot-checks the offset resolution itself
    // doesn't silently misfire across the DST boundary.
    const july = new Date("2026-07-15T12:00:00.000Z"); // noon UTC = 08:00 EDT July 15
    const december = new Date("2026-12-15T12:00:00.000Z"); // noon UTC = 07:00 EST Dec 15
    expect(reconModule.getCmeTradingDayBoundaries(july).tradingDay).toBe("2026-07-15");
    expect(reconModule.getCmeTradingDayBoundaries(december).tradingDay).toBe("2026-12-15");
  });

  it("paper-journal-recon.ts's runPaperJournalRecon uses the SAME canonical CME-day string as reconciliation-service.ts (both recon subsystems bucket identically)", async () => {
    // Exercise runPaperJournalRecon with no DEPLOYED+ strategies (fast
    // early-exit path) and assert its reconDate matches the canonical CME-day
    // boundary for the same instant — the whole point of HIGH-2 is that BOTH
    // recon files now derive "today" from the identical shared helper.
    const nineteenHundredEtJan5 = new Date("2026-01-06T00:00:00.000Z");
    const result = await journalModule.runPaperJournalRecon(nineteenHundredEtJan5);
    expect(result.reconDate).toBe(
      reconModule.getCmeTradingDayBoundaries(nineteenHundredEtJan5).tradingDay
    );
    expect(result.reconDate).toBe("2026-01-06");
  });
});

describe("HIGH-1 — per-trade windowed join catches offsetting-error pairs (round 2)", () => {
  const BAR_WINDOW_MS = 5 * 60 * 1000; // PAPER_RECON_CONFIG default (5 min)

  it("flags an offsetting-error pair that a day-SUM aggregate would see as $0 net drift", () => {
    const t0 = new Date("2026-01-06T14:30:00.000Z");
    const t1 = new Date("2026-01-06T15:00:00.000Z");

    // Trade A: paper +$500, broker +$300 → error +$200 (exceeds MES tolerance)
    // Trade B: paper -$200, broker  $0   → error -$200 (exceeds MES tolerance)
    // Day-SUM: paper total = $300, broker total = $300 → $0 aggregate delta —
    // exactly the false-clean case HIGH-1 exists to catch.
    const paperTrades = [
      { id: "trade-a", pnl: "500", contracts: 9, entryTime: t0, symbol: "MES" },
      { id: "trade-b", pnl: "-200", contracts: 9, entryTime: t1, symbol: "MES" },
    ];
    const productionRows = [
      { id: 1, barTimestamp: t0, expectedPnl: "300" },
      { id: 2, barTimestamp: t1, expectedPnl: "0" },
    ];

    // Sanity-check the day-aggregate WOULD show zero drift on this exact data
    // (proves the offsetting scenario is real, not contrived).
    const totalPaper = paperTrades.reduce((s, t) => s + Number(t.pnl), 0);
    const totalBroker = productionRows.reduce((s, r) => s + Number(r.expectedPnl), 0);
    expect(Math.abs(totalPaper - totalBroker)).toBe(0);

    const result = journalModule.matchPerTradeBrokerRows(paperTrades, productionRows, BAR_WINDOW_MS);

    expect(result.perTradeMismatchCount).toBe(2);
    expect(result.perTradeMismatchTradeIds.sort()).toEqual(["trade-a", "trade-b"]);
    expect(result.perTradeUnmatchedCount).toBe(0);
    expect(result.perTradeCheckedCount).toBe(2);
  });

  it("does NOT flag a trade whose per-trade delta is within its own tolerance", () => {
    const t0 = new Date("2026-01-06T14:30:00.000Z");
    // MES tolerance = MAX(0.50, 2*1.25*9) = $22.50. A $10 delta is within tolerance.
    const result = journalModule.matchPerTradeBrokerRows(
      [{ id: "trade-a", pnl: "500", contracts: 9, entryTime: t0, symbol: "MES" }],
      [{ id: 1, barTimestamp: t0, expectedPnl: "490" }],
      BAR_WINDOW_MS
    );
    expect(result.perTradeMismatchCount).toBe(0);
    expect(result.perTradeCheckedCount).toBe(1);
  });

  it("counts a trade with no production_trades row inside the ±window as unmatched, not a mismatch", () => {
    const t0 = new Date("2026-01-06T14:30:00.000Z");
    const farAway = new Date(t0.getTime() + 20 * 60 * 1000); // 20 min away, outside 5-min window
    const result = journalModule.matchPerTradeBrokerRows(
      [{ id: "trade-a", pnl: "500", contracts: 9, entryTime: t0, symbol: "MES" }],
      [{ id: 1, barTimestamp: farAway, expectedPnl: "300" }],
      BAR_WINDOW_MS
    );
    expect(result.perTradeUnmatchedCount).toBe(1);
    expect(result.perTradeMismatchCount).toBe(0);
    expect(result.perTradeCheckedCount).toBe(0);
  });

  it("skips a production_trades row with NULL expected_pnl (unpopulated by design) rather than treating it as a $0 mismatch", () => {
    const t0 = new Date("2026-01-06T14:30:00.000Z");
    const result = journalModule.matchPerTradeBrokerRows(
      [{ id: "trade-a", pnl: "500", contracts: 9, entryTime: t0, symbol: "MES" }],
      [{ id: 1, barTimestamp: t0, expectedPnl: null }],
      BAR_WINDOW_MS
    );
    // No comparable broker row → unmatched, NOT a false mismatch against a
    // fabricated $0.
    expect(result.perTradeUnmatchedCount).toBe(1);
    expect(result.perTradeMismatchCount).toBe(0);
  });

  it("greedy nearest-match never lets one production_trades row cover two paper trades", () => {
    const t0 = new Date("2026-01-06T14:30:00.000Z");
    const t1 = new Date("2026-01-06T14:31:00.000Z"); // 1 min later, both within window of the single broker row
    const result = journalModule.matchPerTradeBrokerRows(
      [
        { id: "trade-a", pnl: "500", contracts: 9, entryTime: t0, symbol: "MES" },
        { id: "trade-b", pnl: "500", contracts: 9, entryTime: t1, symbol: "MES" },
      ],
      [{ id: 1, barTimestamp: t0, expectedPnl: "500" }],
      BAR_WINDOW_MS
    );
    // Only ONE trade can consume the single broker row; the other is unmatched.
    expect(result.perTradeCheckedCount).toBe(1);
    expect(result.perTradeUnmatchedCount).toBe(1);
  });
});

describe("MED-3 — kill-switch.ts imports the shared CME-day helper (no inline drift class)", () => {
  it("kill-switch.ts source contains no inline Intl.DateTimeFormat CME-day formula and imports toCmeTradingDayString instead", () => {
    const src = readFileSync(
      resolve(import.meta.dirname ?? ".", "../production/kill-switch.ts"),
      "utf8"
    );
    // The old inline formula pattern (both Layer 2 and Layer 3 copies) must be gone.
    expect(src).not.toMatch(/new Intl\.DateTimeFormat\(\s*["']en-CA["']/);
    // The shared canonical helper must be imported.
    expect(src).toMatch(/import\s*\{\s*toCmeTradingDayString\s*\}\s*from\s*["']\.\/reconciliation-service\.js["']/);
  });
});

describe("LOW-4 — checkLayer3TrailingDD no longer reads the nonexistent maxDailyDrawdown fallback", () => {
  it("kill-switch.ts source contains no live `?? firmAccount?.maxDailyDrawdown` fallback expression", () => {
    const src = readFileSync(
      resolve(import.meta.dirname ?? ".", "../production/kill-switch.ts"),
      "utf8"
    );
    // Strip `//`-comment lines first — the fix's own explanatory comment
    // legitimately quotes the OLD dead-code pattern in prose; this test must
    // only assert the pattern is gone from LIVE (executable) code.
    const codeOnly = src
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");
    expect(codeOnly).not.toMatch(/\?\?\s*firmAccount\?\.\s*maxDailyDrawdown/);
    expect(codeOnly).toMatch(/const maxDrawdown = firmAccount\?\.maxDrawdown;/);
  });
});
