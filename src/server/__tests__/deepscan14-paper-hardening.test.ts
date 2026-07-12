/**
 * deepscan14-paper-hardening.test.ts
 *
 * Deep-scan #14 fix-wave Track 3 (paper-parity) coverage:
 *
 *   F1 [CRITICAL autonomy] Second DLL-95% force-close site (Python compliance-gate
 *       D6 path in openPosition) failed silently on forceCloseAllPositions() throw —
 *       bare logger.error only, no Discord, no audit. Mirrors kill-switch.ts's
 *       _confirmedForceClose CRITICAL escalation pattern (AlertFactory.systemError +
 *       insertAuditRowSafe with a distinct action so the two force-close sites are
 *       independently queryable: paper.force_flatten_d6_failed vs
 *       paper.force_flatten_kill_switch_failed).
 *
 *   E1/E2 [CRITICAL/HIGH obs] correlation_id was dropped on two updatePositionPrices
 *       call sites (paper-trading-stream.ts real-time bar loop + paper.ts POST
 *       /api/paper/prices route) even though updatePositionPrices already accepted
 *       a 4th `context.correlationId` argument and threads it into every exit-audit
 *       row (stop_breach, partial_close, exit_decision). Both call sites now pass it.
 *
 *   E3 [HIGH autonomy] Roll-day flatten failure (checkRollAndFlatten's closePosition
 *       throw) was silent — logger.error + a calendar_error result entry only. A
 *       position that must flatten before contract expiry could stay open through
 *       rollover with no operator signal. Now writes an audit row + notifyCritical.
 *
 * Mock harness style follows paper-execution-service.gap1-gap2-hardening.test.ts —
 * imports the REAL SUT + REAL db/schema.js (so eq/and/isNull work against real
 * Drizzle column objects) and mocks only db/index.js + the SUT's other external
 * dependencies. db/schema.js is intentionally left unmocked.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Module-level state shared by mocks ──────────────────────────────────────
let auditRows: Array<Record<string, unknown>> = [];
let sessionRows: unknown[] = [];
let updatePositionPricesOpenRows: unknown[] = [];
let rollOpenPositionRows: unknown[] = [];
// F1/F2 (deep-scan 2026-07-11): capture db.update(...).set(payload) so the adaptive runner-trail
// write can be asserted through the REAL updatePositionPrices call site (not just the unit helper).
let updateSetPayloads: Array<Record<string, unknown>> = [];
let forceCloseSelectShouldThrow = false;
let insertAuditRowSafeCalls: Array<Record<string, unknown>> = [];
let systemErrorCalls: Array<unknown[]> = [];
let notifyCriticalCalls: Array<unknown[]> = [];

type KillResult = {
  tripped: boolean;
  reason: string | null;
  force_close: boolean;
  daily_pnl_pct: number;
  halt_pct_used: number;
  force_close_pct_used: number;
};
let pythonKillResult: KillResult = {
  tripped: false,
  reason: null,
  force_close: false,
  daily_pnl_pct: 0,
  halt_pct_used: 0.67,
  force_close_pct_used: 0.95,
};

let rollCalendarInfo: Record<string, unknown> = {
  known: true,
  is_flatten_day: true,
  roll_date: "2026-07-10",
  flatten_date: "2026-07-09",
  days_to_roll: 1,
  active_contract: "ESU26",
  warn_window: false,
};

// ─── db/index.js mock ─────────────────────────────────────────────────────────
// Dispatches on the *keys* of the columns object passed to db.select(columns) —
// this works whether the values are real Drizzle column refs (they are, since
// db/schema.js is NOT mocked below) or plain sentinels.
function makeAwaitableResult(rows: unknown[]) {
  const p = Promise.resolve(rows) as Promise<unknown[]> & { limit?: () => Promise<unknown[]> };
  p.limit = () => Promise.resolve(rows);
  return p;
}

function resolveSelectRows(columns: Record<string, unknown> | undefined): unknown[] {
  if (columns && "initialStopPrice" in columns) {
    // forceCloseAllPositions's open-positions read.
    if (forceCloseSelectShouldThrow) {
      throw new Error("forceCloseAllPositions DB read failed (simulated, deepscan14 F1 test)");
    }
    return [];
  }
  if (columns && "strategyId" in columns && !("firmId" in columns)) {
    // getSessionStrategyId (inside updatePositionPrices)
    return [{ strategyId: "strat-1" }];
  }
  if (columns && "firmId" in columns && !("unrealizedPnl" in columns)) {
    // bookPartialClose's session firmId lookup
    return [{ firmId: "topstep" }];
  }
  if (columns && "unrealizedPnl" in columns) {
    // checkRollAndFlatten's open-positions read
    return rollOpenPositionRows;
  }
  if (columns && Object.keys(columns).length === 1 && "sessionId" in columns) {
    // closePosition's posForLock read — empty on purpose so closePosition throws
    // "Position ... not found" (used to drive the E3 roll-flatten-failure test).
    return [];
  }
  // bare db.select() — updatePositionPrices's open-positions read
  return updatePositionPricesOpenRows;
}

vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn((columns?: Record<string, unknown>) => ({
      from: vi.fn(() => ({
        where: vi.fn(() => makeAwaitableResult(resolveSelectRows(columns))),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn((row: Record<string, unknown>) => {
        auditRows.push(row);
        return {
          returning: vi.fn(() => Promise.resolve([{ id: "audit-row-1" }])),
          catch: vi.fn(),
        };
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn((payload: Record<string, unknown>) => {
        updateSetPayloads.push(payload);
        return { where: vi.fn(() => Promise.resolve(undefined)) };
      }),
    })),
    transaction: vi.fn(async (fn: (tx: unknown) => unknown) => {
      const tx = {
        insert: vi.fn(() => ({
          values: vi.fn((row: Record<string, unknown>) => {
            auditRows.push(row);
            return Promise.resolve([{ id: "tx-row-1" }]);
          }),
        })),
        update: vi.fn(() => ({
          set: vi.fn(() => ({
            where: vi.fn(() => Promise.resolve(undefined)),
          })),
        })),
      };
      return fn(tx);
    }),
  },
}));

vi.mock("../routes/sse.js", () => ({
  broadcastSSE: vi.fn(),
  PAPER_EXIT_EVENTS: {
    TP1_FILLED: "paper:exit:tp1_filled",
    TP2_FILLED: "paper:exit:tp2_filled",
    BE_STOP_MOVED: "paper:exit:be_stop_moved",
    TRAIL_TIGHTENED: "paper:exit:trail_tightened",
    TIME_STOP_FLATTENED: "paper:exit:time_stop_flattened",
    HANDLER_ERROR: "paper:exit:handler_error",
  },
}));
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../index.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../lib/tracing.js", () => ({
  tracer: { startSpan: vi.fn(() => ({ setAttribute: vi.fn(), end: vi.fn() })) },
}));
vi.mock("../scheduler.js", () => ({ onPaperTradeClose: vi.fn() }));
vi.mock("../services/paper-risk-gate.js", () => ({
  toEasternDateString: vi.fn(() => "2026-07-03"),
  toFuturesTradingDayString: vi.fn(() => "2026-07-03"),
  invalidateDailyLossCache: vi.fn(),
}));
vi.mock("../lib/roll-calendar-loader.js", () => ({
  computeRollSpreadCost: vi.fn(async () => ({ estimatedSpreadCost: 0, rollDates: [] })),
}));
vi.mock("../services/alert-service.js", () => ({
  AlertFactory: {
    systemError: vi.fn((...args: unknown[]) => { systemErrorCalls.push(args); }),
    criticalAlert: vi.fn(),
    driftAlert: vi.fn(async () => undefined),
  },
}));
vi.mock("../lib/dst-utils.js", () => ({ getEtOffsetMinutes: vi.fn(() => -240) }));
vi.mock("../lib/audit-log-helper.js", () => ({
  insertAuditRowSafe: vi.fn(async (row: Record<string, unknown>) => {
    insertAuditRowSafeCalls.push(row);
    return true;
  }),
}));
vi.mock("../lib/metrics-registry.js", () => ({
  paperTrades: { labels: vi.fn(() => ({ inc: vi.fn() })), inc: vi.fn() },
}));
vi.mock("../services/exchange-status-service.js", () => ({
  isExchangeHalted: vi.fn(() => false),
  registerOutageChangeCallback: vi.fn(),
}));
vi.mock("../services/prop-firm-health-service.js", () => ({
  isFirmSuspended: vi.fn(() => false),
  registerSuspensionChangeCallback: vi.fn(),
}));
vi.mock("../lib/network-failover.js", () => ({
  isConnectivityDegraded: vi.fn(() => false),
}));
vi.mock("../../shared/firm-config.js", () => ({
  CONTRACT_SPECS: {
    MES: { tickSize: 0.25, pointValue: 5, name: "Micro E-mini S&P 500" },
    MNQ: { tickSize: 0.25, pointValue: 2, name: "Micro Nasdaq-100" },
    MCL: { tickSize: 0.01, pointValue: 100, name: "Micro Crude Oil" },
  },
  getFirmAccount: vi.fn(() => null),
}));
vi.mock("../lib/contract-class.js", () => ({
  getCommissionPerSide: vi.fn(() => 0.62),
  getStopCeilingPts: vi.fn(() => 14),
}));
vi.mock("../services/adaptive-exit-engine.js", () => ({
  computeExitPlan: vi.fn(async () => null),
}));
vi.mock("../production/kill-switch.js", () => ({
  killSwitch: { isHaltedForProduction: vi.fn(async () => false) },
}));
vi.mock("../services/strategy-assignment-service.js", () => ({
  getActiveAssignment: vi.fn(async () => ({ id: "assignment-1" })),
}));
vi.mock("../services/pipeline-control-service.js", () => ({
  isActive: vi.fn(async () => true),
}));
vi.mock("../services/strategy-lockout-service.js", () => ({
  writeLockoutFromKillEvent: vi.fn(async () => undefined),
}));
vi.mock("../lib/python-runner.js", () => ({
  runPythonModule: vi.fn(async (opts: { module: string }) => {
    if (opts.module === "src.engine.roll_calendar") return rollCalendarInfo;
    return pythonKillResult;
  }),
}));
vi.mock("../services/notification-service.js", () => ({
  notifyWarning: vi.fn(),
  notifyCritical: vi.fn((...args: unknown[]) => { notifyCriticalCalls.push(args); }),
}));
vi.mock("../services/server-mediated-executor.js", () => ({
  isServerMediatedExecutionEnabled: vi.fn(() => false),
  routeLiveFlatten: vi.fn(),
  routeLiveExitPartial: vi.fn(),
}));

// withSessionLock — same fakeConn pattern as paper-execution-service.gap1-gap2-hardening.test.ts.
vi.mock("../lib/db-locks.js", () => ({
  withSessionLock: vi.fn(async (_id: unknown, fn: (conn: unknown) => unknown) => {
    let selectCallCount = 0;
    const fakeConn = {
      select: vi.fn(() => {
        selectCallCount++;
        if (selectCallCount === 1) {
          return makeSelectChain(sessionRows.length > 0 ? sessionRows : [{
            id: "sess-d6",
            status: "active",
            firmId: "topstep",
            strategyId: "strat-1",
            currentEquity: "49000",
            peakEquity: "50000",
            totalTrades: 5,
            config: { daily_loss_limit: 1000, firm_key: "topstep" },
            dailyPnlBreakdown: { "2026-07-03": -960 },
          }]);
        }
        if (selectCallCount === 2) return makeSelectChain([{ pnl: "-100" }, { pnl: "-50" }]);
        if (selectCallCount === 3) return makeSelectChain([{ count: 1 }]);
        if (selectCallCount === 4) return makeSelectChain([{ macroRegime: "trending" }]);
        return makeSelectChain([]);
      }),
      insert: vi.fn(() => ({
        values: vi.fn((row: Record<string, unknown>) => {
          auditRows.push(row);
          return { returning: vi.fn(() => Promise.resolve([{ id: "audit-row-1" }])), catch: vi.fn() };
        }),
      })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({ where: vi.fn(() => Promise.resolve(undefined)) })),
      })),
      delete: vi.fn(() => ({ where: vi.fn(() => Promise.resolve(undefined)) })),
      transaction: vi.fn(async (fn: (tx: unknown) => unknown) => {
        let insertCallIdx = 0;
        const txMock = {
          insert: vi.fn(() => {
            insertCallIdx++;
            return {
              values: vi.fn((row: Record<string, unknown>) => {
                auditRows.push(row);
                if (insertCallIdx === 1) {
                  return {
                    returning: vi.fn(() => Promise.resolve([{ id: "tx-pos-1", sessionId: "sess-d6", symbol: "MES" }])),
                    catch: vi.fn(),
                  };
                }
                return { returning: vi.fn(() => Promise.resolve([])), catch: vi.fn() };
              }),
            };
          }),
          update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => Promise.resolve(undefined)) })) })),
          select: vi.fn(() => makeSelectChain([])),
          delete: vi.fn(() => ({ where: vi.fn(() => Promise.resolve(undefined)) })),
        };
        return fn(txMock);
      }),
    };
    return fn(fakeConn);
  }),
}));

function makeSelectChain(resolveWith: unknown[]) {
  const chain: Record<string, unknown> = {};
  const terminator = () => Promise.resolve(resolveWith);
  chain.from = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.orderBy = vi.fn(() => chain);
  chain.limit = vi.fn(terminator);
  (chain as Record<string, unknown>).then = (onFulfilled: (v: unknown) => unknown) =>
    Promise.resolve(resolveWith).then(onFulfilled);
  return chain;
}

// ─── Import SUT (after all mocks are registered) ──────────────────────────────
import {
  openPosition,
  updatePositionPrices,
  checkRollAndFlatten,
  clearKillSwitchCache,
  clearStuckSessionId,
  type StyleExitBarContext,
} from "../services/paper-execution-service.js";

const OPEN_PARAMS = {
  symbol: "MES" as const,
  side: "long" as const,
  signalPrice: 5000,
  contracts: 1,
  stopPrice: 4980,
  takeProfitPrice: 5040,
  strategyId: "strat-1",
  strategyName: "test_strategy",
};

beforeEach(() => {
  auditRows = [];
  sessionRows = [];
  updatePositionPricesOpenRows = [];
  rollOpenPositionRows = [];
  updateSetPayloads = [];
  forceCloseSelectShouldThrow = false;
  insertAuditRowSafeCalls = [];
  systemErrorCalls = [];
  notifyCriticalCalls = [];
  pythonKillResult = {
    tripped: false,
    reason: null,
    force_close: false,
    daily_pnl_pct: 0,
    halt_pct_used: 0.67,
    force_close_pct_used: 0.95,
  };
  delete process.env.STYLE_C_EXIT_TS_NATIVE;
  clearKillSwitchCache();
  clearStuckSessionId("sess-d6");
  // DO NOT vi.clearAllMocks() — wipes the mock factories' implementations
  // (withSessionLock, killSwitch.isHaltedForProduction, etc). See
  // paper-execution-service.gap1-gap2-hardening.test.ts for the same note.
});

// =============================================================================
// F1 — D6 force-close failure fires audit + alert (not silent)
// =============================================================================

describe("F1: D6 force-close failure escalates (audit + Discord), mirrors kill-switch.ts", () => {
  it("when forceCloseAllPositions throws inside the D6 force_close branch, writes paper.force_flatten_d6_failed audit + AlertFactory.systemError", async () => {
    pythonKillResult = {
      tripped: true,
      reason: "dll_95_force_close",
      force_close: true,
      daily_pnl_pct: -0.96,
      halt_pct_used: 0.67,
      force_close_pct_used: 0.95,
    };
    sessionRows = [{
      id: "sess-d6",
      status: "active",
      firmId: "topstep",
      strategyId: "strat-1",
      currentEquity: "49000",
      peakEquity: "50000",
      totalTrades: 5,
      config: { daily_loss_limit: 1000, firm_key: "topstep" },
      dailyPnlBreakdown: { "2026-07-03": -960 },
    }];
    forceCloseSelectShouldThrow = true;

    const result = await openPosition("sess-d6", OPEN_PARAMS, { correlationId: "corr-d6-fail" });

    // Order rejected (D6 always rejects the triggering order regardless of force-close outcome)
    expect(result.executionResult.filled).toBe(false);

    const d6Audit = insertAuditRowSafeCalls.find(r => r["action"] === "paper.force_flatten_d6_failed");
    expect(d6Audit).toBeDefined();
    expect(d6Audit!["status"]).toBe("error");
    expect(d6Audit!["entityId"]).toBe("sess-d6");
    expect((d6Audit!["result"] as Record<string, unknown>)["positions_may_be_open"]).toBe(true);
    expect(d6Audit!["correlationId"]).toBe("corr-d6-fail");

    // Distinct from the kill-switch.ts force-close-failed action name (queryable independently)
    expect(d6Audit!["action"]).not.toBe("paper.force_flatten_kill_switch_failed");

    expect(systemErrorCalls.length).toBeGreaterThan(0);
    const [component, err] = systemErrorCalls[0] as [string, Error];
    expect(component).toBe("paper-force-flatten-d6-failed");
    expect(String(err.message)).toContain("dll_95_force_close");
  });

  it("when forceCloseAllPositions succeeds, no d6_failed audit or alert fires", async () => {
    pythonKillResult = {
      tripped: true,
      reason: "dll_95_force_close",
      force_close: true,
      daily_pnl_pct: -0.96,
      halt_pct_used: 0.67,
      force_close_pct_used: 0.95,
    };
    sessionRows = [{
      id: "sess-d6",
      status: "active",
      firmId: "topstep",
      strategyId: "strat-1",
      currentEquity: "49000",
      peakEquity: "50000",
      totalTrades: 5,
      config: { daily_loss_limit: 1000, firm_key: "topstep" },
      dailyPnlBreakdown: { "2026-07-03": -960 },
    }];
    forceCloseSelectShouldThrow = false; // forceCloseAllPositions succeeds (0 open positions)

    await openPosition("sess-d6", OPEN_PARAMS, { correlationId: "corr-d6-ok" });

    expect(insertAuditRowSafeCalls.find(r => r["action"] === "paper.force_flatten_d6_failed")).toBeUndefined();
    expect(systemErrorCalls.length).toBe(0);
  });
});

// =============================================================================
// E1 — updatePositionPrices propagates a non-null correlationId end-to-end
// =============================================================================

describe("E1/E2: updatePositionPrices threads context.correlationId into exit audit rows", () => {
  it("propagates the supplied correlationId into the TP1 partial-close audit row (paper.partial_close.tp1)", async () => {
    // STYLE_C_EXIT_TS_NATIVE bypasses the Python subprocess entirely — the pure
    // evaluateStyleCExit() function decides FILL_TP1_50PCT synchronously.
    process.env.STYLE_C_EXIT_TS_NATIVE = "true";

    const entryPrice = 5000;
    const stopPrice = 4990; // 10pt structural stop → 1R = 10pt → TP1 = 5010
    updatePositionPricesOpenRows = [{
      id: "pos-tp1-corr",
      sessionId: "sess-corr",
      symbol: "MES",
      side: "long",
      contracts: 3, // so floor(3*0.33)=0 -> max(1,0)=1 < 3: partial-close branch taken
      entryPrice: String(entryPrice),
      currentPrice: String(entryPrice),
      previousUnrealizedPnl: "0",
      mae: "0",
      mfe: "0",
      highSinceEntryPrice: String(entryPrice),
      lowSinceEntryPrice: String(entryPrice),
      trailHwm: null,
      initialStopPrice: String(stopPrice),
      tp1Filled: false,
      tp2Filled: false,
      currentExitStyle: "C",
      exitPlan: null,
      correlationId: null,
      entryTime: null,
      fillRatio: 1,
      beStopApplied: false,
    }];

    const exitBarContext: StyleExitBarContext = {
      currentTimeEt: "10:30",
      atr14: { MES: 5 },
    };

    const priceMap = { MES: { close: 5010, high: 5011, low: 5005, volume: 100 } };
    const myCorrelationId = "corr-tp1-propagation-test";

    await updatePositionPrices("sess-corr", priceMap, exitBarContext, { correlationId: myCorrelationId });

    const partialCloseAudit = auditRows.find(r => r["action"] === "paper.partial_close.tp1");
    expect(partialCloseAudit).toBeDefined();
    expect(partialCloseAudit!["correlationId"]).toBe(myCorrelationId);
    expect(partialCloseAudit!["correlationId"]).not.toBeNull();
  });

  it("without a context arg, correlationId defaults to null (documents the pre-fix behavior the call sites used to hit)", async () => {
    process.env.STYLE_C_EXIT_TS_NATIVE = "true";

    const entryPrice = 6000;
    const stopPrice = 5990;
    updatePositionPricesOpenRows = [{
      id: "pos-tp1-nocorr",
      sessionId: "sess-nocorr",
      symbol: "MES",
      side: "long",
      contracts: 3,
      entryPrice: String(entryPrice),
      currentPrice: String(entryPrice),
      previousUnrealizedPnl: "0",
      mae: "0",
      mfe: "0",
      highSinceEntryPrice: String(entryPrice),
      lowSinceEntryPrice: String(entryPrice),
      trailHwm: null,
      initialStopPrice: String(stopPrice),
      tp1Filled: false,
      tp2Filled: false,
      currentExitStyle: "C",
      exitPlan: null,
      correlationId: null,
      entryTime: null,
      fillRatio: 1,
      beStopApplied: false,
    }];

    const exitBarContext: StyleExitBarContext = {
      currentTimeEt: "10:30",
      atr14: { MES: 5 },
    };

    const priceMap = { MES: { close: 6010, high: 6011, low: 6005, volume: 100 } };

    // No 4th arg supplied — this is the exact shape of the pre-fix call sites.
    await updatePositionPrices("sess-nocorr", priceMap, exitBarContext);

    const partialCloseAudit = auditRows.find(r => r["action"] === "paper.partial_close.tp1" && r["entityId"] === "pos-tp1-nocorr");
    expect(partialCloseAudit).toBeDefined();
    expect(partialCloseAudit!["correlationId"]).toBeNull();
  });

  it("paper-trading-stream.ts call site threads the per-bar correlationId (source-level wiring check)", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const srcPath = path.resolve(__dirname, "../services/paper-trading-stream.ts");
    const src = fs.readFileSync(srcPath, "utf-8");
    expect(src).toMatch(/updatePositionPrices\(\s*sessionId,\s*priceMap,\s*exitBarContext,\s*\{\s*correlationId\s*\}\s*\)/);
  });

  it("paper.ts POST /prices route threads a correlationId (source-level wiring check)", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const srcPath = path.resolve(__dirname, "../routes/paper.ts");
    const src = fs.readFileSync(srcPath, "utf-8");
    expect(src).toMatch(/updatePositionPrices\(sessionId,\s*prices,\s*undefined,\s*\{\s*correlationId\s*\}\)/);
  });
});

// =============================================================================
// E3 — roll-flatten failure fires audit + notifyCritical (not silent)
// =============================================================================

describe("E3: roll-day flatten failure escalates (audit + Discord), not silent", () => {
  it("when closePosition throws during a flatten-day roll check, writes paper.roll_flatten_failed audit + notifyCritical", async () => {
    rollOpenPositionRows = [{
      id: "pos-roll-fail",
      symbol: "MNQ",
      unrealizedPnl: "120",
      currentPrice: "18500",
      contracts: 2,
    }];
    rollCalendarInfo = {
      known: true,
      is_flatten_day: true,
      roll_date: "2026-07-10",
      flatten_date: "2026-07-09",
      days_to_roll: 1,
      active_contract: "MNQU26",
      warn_window: false,
    };

    const results = await checkRollAndFlatten("sess-roll", undefined, { correlationId: "corr-roll-fail" });

    const rollAudit = insertAuditRowSafeCalls.find(r => r["action"] === "paper.roll_flatten_failed");
    expect(rollAudit).toBeDefined();
    expect(rollAudit!["status"]).toBe("error");
    expect(rollAudit!["entityId"]).toBe("pos-roll-fail");
    expect(rollAudit!["correlationId"]).toBe("corr-roll-fail");
    expect((rollAudit!["result"] as Record<string, unknown>)["position_may_still_be_open"]).toBe(true);

    expect(notifyCriticalCalls.length).toBeGreaterThan(0);
    const [title, body] = notifyCriticalCalls[0] as [string, string];
    expect(title).toMatch(/[Rr]oll/);
    expect(body).toContain("pos-roll-fail");

    // Result still reports calendar_error so the caller sees the position was NOT closed
    expect(results.find(r => r.positionId === "pos-roll-fail")?.action).toBe("calendar_error");
  });

  it("when closePosition succeeds, no roll_flatten_failed audit fires", async () => {
    // No open positions at all -> checkRollAndFlatten returns [] before ever
    // reaching the flatten branch, so the failure path is never exercised.
    rollOpenPositionRows = [];

    const results = await checkRollAndFlatten("sess-roll-empty", undefined, { correlationId: "corr-roll-empty" });

    expect(results).toEqual([]);
    expect(insertAuditRowSafeCalls.find(r => r["action"] === "paper.roll_flatten_failed")).toBeUndefined();
  });

  // ─── F1/F2 adaptive runner-trail INTEGRATION (deep-scan 2026-07-11) ─────────────
  // Drives the anchored_vwap trail through the REAL updatePositionPrices call site (not just the
  // extracted helpers) and asserts the db.update trailHwm write. This is the integration-coverage
  // gap the re-cert flagged: unit tests cover shouldAdvanceRunnerTrail/avwapTypicalPrice, but nothing
  // exercised their WIRING inside updatePositionPrices with exit_plan + tp1/tp2 state.
  describe("F1/F2 adaptive runner-trail write (integration through updatePositionPrices)", () => {
    const makeAvwapPosition = (over: Record<string, unknown>) => ({
      id: "pos-avwap",
      sessionId: "sess-avwap",
      symbol: "MES",
      side: "long",
      contracts: 3,
      entryPrice: "5010",
      currentPrice: "5010",
      previousUnrealizedPnl: "0",
      mae: "0",
      mfe: "0",
      highSinceEntryPrice: "5010",
      lowSinceEntryPrice: "5010",
      trailHwm: null,
      initialStopPrice: "5000",
      tp1Filled: true,
      tp2Filled: true,
      currentExitStyle: "adaptive",
      exitPlan: { runner: { trail_method: "anchored_vwap" }, runtime_state: {} },
      correlationId: null,
      entryTime: null,
      fillRatio: 1,
      beStopApplied: false,
      ...over,
    });
    const barCtx: StyleExitBarContext = { currentTimeEt: "10:30", atr14: { MES: 5 } };

    it("F2: advances the trail on the TYPICAL price (high+low+close)/3 — NOT the close alone", async () => {
      process.env.STYLE_C_EXIT_TS_NATIVE = "true";
      updatePositionPricesOpenRows = [makeAvwapPosition({})];
      // Bar with the close skewed to the HIGH: typical=(5045+5030+5045)/3=5040; close-only basis=5045.
      const priceMap = { MES: { close: 5045, high: 5045, low: 5030, volume: 100 } };

      await updatePositionPrices("sess-avwap", priceMap, barCtx, { correlationId: "corr-avwap" });

      const trailWrite = updateSetPayloads.find((p) => "trailHwm" in p);
      expect(trailWrite).toBeDefined();
      // avwap(5040) - MES tick(0.25) = 5039.75 (typical basis). Close-only would be 5045-0.25=5044.75.
      expect(Number(trailWrite!.trailHwm)).toBeCloseTo(5039.75, 2);
      expect(Number(trailWrite!.trailHwm)).not.toBeCloseTo(5044.75, 2);
    });

    it("F1: does NOT advance the trail before TP2 fills (even when computedTrail beats the floor)", async () => {
      process.env.STYLE_C_EXIT_TS_NATIVE = "true";
      // tp1/tp2 unfilled + price just above entry (below TP1) so no live TP fill mutates the state.
      updatePositionPricesOpenRows = [makeAvwapPosition({ tp1Filled: false, tp2Filled: false })];
      const priceMap = { MES: { close: 5011, high: 5012, low: 5008, volume: 100 } };

      await updatePositionPrices("sess-avwap", priceMap, barCtx, { correlationId: "corr-avwap-notp2" });

      // computedTrail (~5010) > floor (initialStop 5000), but the F1 TP2 gate blocks the ratchet.
      const trailWrite = updateSetPayloads.find((p) => "trailHwm" in p);
      expect(trailWrite).toBeUndefined();
      // The AVWAP accumulator still persists every bar (runtime_state) so TP2 has it ready.
      expect(updateSetPayloads.some((p) => "exitPlan" in p && !("trailHwm" in p))).toBe(true);
    });

    it("F1: ratchet-only — does NOT loosen an existing trail when computedTrail is below the current trailHwm", async () => {
      process.env.STYLE_C_EXIT_TS_NATIVE = "true";
      // Existing trail at 5035, tp2 filled. Bar avwap (~5032) is below it but well above the 5000 stop
      // (no stop-out). The ratchet floor = currentTrailHwm(5035), so the lower computedTrail is rejected.
      updatePositionPricesOpenRows = [makeAvwapPosition({ trailHwm: "5035" })];
      const priceMap = { MES: { close: 5033, high: 5034, low: 5030, volume: 100 } };

      await updatePositionPrices("sess-avwap", priceMap, barCtx, { correlationId: "corr-avwap-ratchet" });

      const trailWrite = updateSetPayloads.find((p) => "trailHwm" in p);
      expect(trailWrite).toBeUndefined(); // trail holds at 5035 — never loosened downward
    });
  });
});
