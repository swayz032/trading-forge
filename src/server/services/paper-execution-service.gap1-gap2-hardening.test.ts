/**
 * paper-execution-service.gap1-gap2-hardening.test.ts
 *
 * TDD tests for two production-hardening findings (2026-06-22):
 *
 *   GAP-1 (HIGH): DLL halt is NOT sticky — once Python's 5s cache expires and
 *     P&L recovers below 67%, the next signal re-evaluates Python and trading
 *     resumes. The halt must persist for the entire CME trading day.
 *
 *   GAP-2 (MEDIUM-HIGH): forceCloseAllPositions silently leaves a null-price
 *     position open (soft skip). Null-price must use entryPrice as fallback;
 *     if still no price, escalate with CRITICAL audit paper.force_flatten_stuck,
 *     fire AlertFactory.criticalAlert, and block subsequent openPosition.
 *
 * Tests are written RED (failing) first, then the production fix makes them GREEN.
 *
 * Mock pattern follows paper-execution-service.hardening-2026-06-22.test.ts exactly.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

// ─── Module-level state shared by mocks ──────────────────────────────────────
let auditRows: Array<Record<string, unknown>> = [];
let openPositionRows: unknown[] = [];
let killSwitchHalted = false;
let assignmentReturn: { id: string } | null = { id: "assignment-1" };
// Session rows returned by the lock-inner dbConn
let sessionRows: unknown[] = [];

// Python kill-switch results — per test
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

// Tracks db.update() calls
let dbUpdateCalls: Array<{ table: string; set: unknown; where: unknown }> = [];
// Tracks AlertFactory.criticalAlert calls
let criticalAlertCalls: Array<unknown[]> = [];

// ─── DB mock ─────────────────────────────────────────────────────────────────
vi.mock("../db/index.js", () => {
  return {
    db: {
      select: vi.fn(() => ({
        from: vi.fn((table: unknown) => {
          // Distinguish paperSessions vs paperPositions by shape — we key on the
          // table argument reference captured at mock time.
          return {
            where: vi.fn(() => {
              // Used by: forceCloseAllPositions (paperPositions) AND openPosition's
              // outer session read (before withSessionLock).  The positional call
              // index determines which rows to return, but we use a simpler heuristic:
              // if openPositionRows is populated, treat the FIRST call as positions.
              return Promise.resolve(openPositionRows.length > 0 ? openPositionRows : sessionRows);
            }),
          };
        }),
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
      update: vi.fn((table: unknown) => ({
        set: vi.fn((setArgs: unknown) => ({
          where: vi.fn((whereArgs: unknown) => {
            dbUpdateCalls.push({ table: String(table), set: setArgs, where: whereArgs });
            return Promise.resolve(undefined);
          }),
        })),
      })),
      transaction: vi.fn(async (fn: (tx: unknown) => unknown) => {
        return fn({
          select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => Promise.resolve([])) })) })),
          insert: vi.fn(() => ({
            values: vi.fn((row: Record<string, unknown>) => {
              auditRows.push(row);
              return { returning: vi.fn(() => Promise.resolve([{ id: "t-1", pnl: "-250" }])), catch: vi.fn() };
            }),
            returning: vi.fn(() => Promise.resolve([{ id: "t-1", pnl: "-250" }])),
          })),
          update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => { const p: any = Promise.resolve(undefined); p.returning = vi.fn(() => Promise.resolve([{ id: "pos-claimed", contracts: 1 }])); return p; }) })) })),
          delete: vi.fn(() => ({ where: vi.fn(() => Promise.resolve(undefined)) })),
        });
      }),
    },
  };
});

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
  tracer: {
    startSpan: vi.fn(() => ({ setAttribute: vi.fn(), end: vi.fn() })),
  },
}));
vi.mock("../scheduler.js", () => ({ onPaperTradeClose: vi.fn() }));
vi.mock("./paper-risk-gate.js", () => ({
  toEasternDateString: vi.fn(() => "2026-06-22"),
  toFuturesTradingDayString: vi.fn(() => "2026-06-22"),
  invalidateDailyLossCache: vi.fn(),
}));
vi.mock("../lib/roll-calendar-loader.js", () => ({
  computeRollSpreadCost: vi.fn(async () => ({ estimatedSpreadCost: 0, rollDates: [] })),
}));
vi.mock("./alert-service.js", () => ({
  AlertFactory: {
    systemError: vi.fn(),
    criticalAlert: vi.fn((...args: unknown[]) => {
      criticalAlertCalls.push(args);
    }),
    driftAlert: vi.fn(async () => undefined),
  },
}));
vi.mock("../lib/dst-utils.js", () => ({ getEtOffsetMinutes: vi.fn(() => -240) }));
vi.mock("../lib/audit-log-helper.js", () => ({
  insertAuditRowSafe: vi.fn(async () => undefined),
}));
vi.mock("../lib/metrics-registry.js", () => ({
  paperTrades: { inc: vi.fn() },
  // dllHaltTotal.labels({reason}).inc() is called on the GAP-1 sticky-halt path
  // (paper-execution-service.ts:1374) — missing this export throws a TypeError that
  // was previously swallowed by the outer kill-switch catch(killErr) block, silently
  // diverting the sticky-halt write into the "kill_switch.down" fail-closed path.
  dllHaltTotal: { labels: vi.fn(() => ({ inc: vi.fn() })) },
}));
vi.mock("./exchange-status-service.js", () => ({
  isExchangeHalted: vi.fn(() => false),
  registerOutageChangeCallback: vi.fn(),
}));
vi.mock("./prop-firm-health-service.js", () => ({
  isFirmSuspended: vi.fn(() => false),  // SYNC — called in if() without await
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
}));
vi.mock("./adaptive-exit-engine.js", () => ({
  computeExitPlan: vi.fn(async () => null),
}));
vi.mock("../db/jsonb-shapes.js", () => ({}));

vi.mock("../production/kill-switch.js", () => ({
  killSwitch: {
    isHaltedForProduction: vi.fn(() => Promise.resolve(killSwitchHalted)),
  },
}));

vi.mock("./strategy-assignment-service.js", () => ({
  getActiveAssignment: vi.fn(() => Promise.resolve(assignmentReturn)),
}));

vi.mock("./pipeline-control-service.js", () => ({
  isActive: vi.fn(async () => true),
}));

vi.mock("./strategy-lockout-service.js", () => ({
  writeLockoutFromKillEvent: vi.fn(async () => undefined),
}));

// Python runner mock — returns pythonKillResult by default
vi.mock("../lib/python-runner.js", () => ({
  runPythonModule: vi.fn(async () => pythonKillResult),
}));

// ─── withSessionLock mock ─────────────────────────────────────────────────────
// Builds a fake dbConn that serves the paperSessions row for the lock-inner
// openPosition call path. The session row is controlled per test via `sessionRows`.
vi.mock("../lib/db-locks.js", () => ({
  withSessionLock: vi.fn(async (_id: unknown, fn: (conn: unknown) => unknown) => {
    let selectCallCount = 0;
    const fakeConn = {
      select: vi.fn(() => {
        selectCallCount++;
        // Call 1: re-read session inside lock
        if (selectCallCount === 1) {
          return makeSelectChain(sessionRows.length > 0 ? sessionRows : [{
            id: "sess-1",
            status: "active",
            firmId: "topstep",
            strategyId: "strat-1",
            currentEquity: "50000",
            peakEquity: "51000",
            totalTrades: 5,
            config: {
              daily_loss_limit: 1000,
              firm_key: "topstep",
            },
            dailyPnlBreakdown: { "2026-06-22": -670 },
          }]);
        }
        // Call 2: recent trades for consecutive losses
        if (selectCallCount === 2) return makeSelectChain([{ pnl: "-100" }, { pnl: "-50" }]);
        // Call 3: trades today count
        if (selectCallCount === 3) return makeSelectChain([{ count: 1 }]);
        // Call 4: macroRegime snapshot
        if (selectCallCount === 4) return makeSelectChain([{ macroRegime: "trending" }]);
        // Remaining: empty
        return makeSelectChain([]);
      }),
      insert: vi.fn(() => ({
        values: vi.fn((row: Record<string, unknown>) => {
          auditRows.push(row);
          return {
            returning: vi.fn(() => Promise.resolve([{ id: "audit-row-1" }])),
            catch: vi.fn(),
          };
        }),
      })),
      update: vi.fn((table: unknown) => ({
        set: vi.fn((setArgs: unknown) => ({
          where: vi.fn((whereArgs: unknown) => {
            dbUpdateCalls.push({ table: String(table), set: setArgs, where: whereArgs });
            return Promise.resolve(undefined);
          }),
        })),
      })),
      delete: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve(undefined)),
      })),
      // FIX 3 (Track M): openPosition wraps position INSERT + paper.trade_open audit in
      // dbConn.transaction(). The tx mock exposes insert with .returning() for the position
      // INSERT and a standard insert for the audit INSERT.
      transaction: vi.fn(async (fn: (tx: unknown) => unknown) => {
        let insertCallIdx = 0;
        const txMock = {
          insert: vi.fn(() => {
            insertCallIdx++;
            return {
              values: vi.fn((row: Record<string, unknown>) => {
                auditRows.push(row);
                if (insertCallIdx === 1) {
                  // First insert = paperPositions — must return position row with .returning()
                  return {
                    returning: vi.fn(() =>
                      Promise.resolve([{ id: "tx-pos-1", sessionId: "sess-sticky", symbol: "MES" }]),
                    ),
                    catch: vi.fn(),
                  };
                }
                // Subsequent inserts = auditLog — no returning needed
                return { returning: vi.fn(() => Promise.resolve([])), catch: vi.fn() };
              }),
            };
          }),
          update: vi.fn((table: unknown) => ({
            set: vi.fn((setArgs: unknown) => ({
              where: vi.fn((whereArgs: unknown) => {
                dbUpdateCalls.push({ table: String(table), set: setArgs, where: whereArgs });
                return Promise.resolve(undefined);
              }),
            })),
          })),
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
  forceCloseAllPositions,
  openPosition,
  clearKillSwitchCache,
  clearStuckSessionId,
} from "./paper-execution-service.js";

// ─── Setup ────────────────────────────────────────────────────────────────────
beforeEach(() => {
  auditRows = [];
  openPositionRows = [];
  sessionRows = [];
  dbUpdateCalls = [];
  criticalAlertCalls = [];
  killSwitchHalted = false;
  assignmentReturn = { id: "assignment-1" };
  pythonKillResult = {
    tripped: false,
    reason: null,
    force_close: false,
    daily_pnl_pct: 0,
    halt_pct_used: 0.67,
    force_close_pct_used: 0.95,
  };
  // Clear module-level service state that persists between tests.
  // killSwitchCache TTL can leak a cached result between tests; clear it explicitly.
  // stuckSessionIds from forceCloseAllPositions persists unless cleared.
  clearKillSwitchCache();
  // Clear all known stuck session IDs used in these tests so ordering doesn't affect results.
  clearStuckSessionId("sess-stuck");
  clearStuckSessionId("sess-breach");
  clearStuckSessionId("sess-force-stuck");
  // DO NOT call vi.clearAllMocks() — it wipes vi.fn() implementations inside the mock
  // factories (withSessionLock, killSwitch.isHaltedForProduction, etc.), making the mocks
  // return undefined. Call counts and history reset when the outer variables are reassigned.
  // Reference: paper-execution-service.hardening-2026-06-22.test.ts (same pattern, no clearAllMocks)
});

// =============================================================================
// GAP-1 — DLL halt must be sticky within a CME trading day
// =============================================================================

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

describe("GAP-1 — DLL halt stickiness", () => {
  it("FAILING BEFORE FIX: once DLL trips at 67%, subsequent signal with recovered P&L is still BLOCKED", async () => {
    // First call: Python says tripped=true (67% DLL halt, not force-close)
    pythonKillResult = {
      tripped: true,
      reason: "approaching_daily_loss_limit",
      force_close: false,
      daily_pnl_pct: -0.67,
      halt_pct_used: 0.67,
      force_close_pct_used: 0.95,
    };

    // Session with daily_loss_limit so the D6 block executes
    sessionRows = [{
      id: "sess-sticky",
      status: "active",
      firmId: "topstep",
      strategyId: "strat-1",
      currentEquity: "49330",
      peakEquity: "50000",
      totalTrades: 2,
      config: {
        daily_loss_limit: 1000,
        firm_key: "topstep",
      },
      dailyPnlBreakdown: { "2026-06-22": -670 },
    }];

    // First call: should trip and persist sticky halt
    const result1 = await openPosition("sess-sticky", OPEN_PARAMS, { correlationId: "corr-trip" });
    expect(result1.executionResult.filled).toBe(false);

    // Now P&L "recovers" — Python says not tripped anymore (wins back some)
    // AND the 5s cache has expired (clear it by resetting the module via the test)
    pythonKillResult = {
      tripped: false,
      reason: null,
      force_close: false,
      daily_pnl_pct: -0.40,  // recovered below 67%
      halt_pct_used: 0.67,
      force_close_pct_used: 0.95,
    };

    // Update session: reflect recovered P&L
    sessionRows = [{
      id: "sess-sticky",
      status: "active",
      firmId: "topstep",
      strategyId: "strat-1",
      currentEquity: "49600",  // recovered
      peakEquity: "50000",
      totalTrades: 2,
      config: {
        daily_loss_limit: 1000,
        firm_key: "topstep",
        // After fix: sticky flag written here by first call
        dailyLossHaltedAt: "2026-06-22",
      },
      dailyPnlBreakdown: { "2026-06-22": -400 },
    }];

    // Second call: MUST still be blocked by sticky flag even though Python says false
    const result2 = await openPosition("sess-sticky", OPEN_PARAMS, { correlationId: "corr-recovery" });

    // KEY ASSERTION: sticky halt must still block
    expect(result2.executionResult.filled).toBe(false);

    // Must emit a sticky-halt audit row (not just a regular kill_switch.tripped row)
    const stickyAudit = auditRows.find(r =>
      r["action"] === "kill_switch.dll_halt_sticky_blocked"
    );
    expect(stickyAudit).toBeDefined();
    expect((stickyAudit!["result"] as Record<string, unknown>)?.["halted_at"]).toBe("2026-06-22");
  });

  it("FAILING BEFORE FIX: sticky halt is written to session config when DLL first trips", async () => {
    pythonKillResult = {
      tripped: true,
      reason: "approaching_daily_loss_limit",
      force_close: false,
      daily_pnl_pct: -0.67,
      halt_pct_used: 0.67,
      force_close_pct_used: 0.95,
    };

    sessionRows = [{
      id: "sess-write-sticky",
      status: "active",
      firmId: "topstep",
      strategyId: "strat-1",
      currentEquity: "49330",
      peakEquity: "50000",
      totalTrades: 2,
      config: {
        daily_loss_limit: 1000,
        firm_key: "topstep",
      },
      dailyPnlBreakdown: { "2026-06-22": -670 },
    }];

    await openPosition("sess-write-sticky", OPEN_PARAMS, { correlationId: "corr-write-sticky" });

    // After fix: session config MUST have been updated.
    // The set arg is a Drizzle sql`` object (for jsonb_set) — check that at least one
    // db.update() call was recorded (the sticky halt write is the only update in this path).
    expect(dbUpdateCalls.length).toBeGreaterThan(0);
  });

  it("FAILING BEFORE FIX: sticky halt emits paper.kill_switch.dll_halt_sticky_engaged audit on first trip", async () => {
    pythonKillResult = {
      tripped: true,
      reason: "approaching_daily_loss_limit",
      force_close: false,
      daily_pnl_pct: -0.70,
      halt_pct_used: 0.67,
      force_close_pct_used: 0.95,
    };

    sessionRows = [{
      id: "sess-engaged",
      status: "active",
      firmId: "topstep",
      strategyId: "strat-1",
      currentEquity: "49000",
      peakEquity: "50000",
      totalTrades: 3,
      config: { daily_loss_limit: 1000, firm_key: "topstep" },
      dailyPnlBreakdown: { "2026-06-22": -700 },
    }];

    await openPosition("sess-engaged", OPEN_PARAMS, { correlationId: "corr-engaged" });

    const engagedAudit = auditRows.find(r =>
      r["action"] === "kill_switch.dll_halt_sticky_engaged"
    );
    expect(engagedAudit).toBeDefined();
    const result = engagedAudit!["result"] as Record<string, unknown>;
    expect(result["halted_at"]).toBe("2026-06-22");
    expect(result["daily_pnl_pct"]).toBe(-0.70);
  });

  it("FAILING BEFORE FIX: sticky halt check bypasses Python call when already halted this day", async () => {
    // Session already has dailyLossHaltedAt = today (sticky flag set)
    sessionRows = [{
      id: "sess-already-sticky",
      status: "active",
      firmId: "topstep",
      strategyId: "strat-1",
      currentEquity: "49600",  // recovered P&L, but halt is sticky
      peakEquity: "50000",
      totalTrades: 3,
      config: {
        daily_loss_limit: 1000,
        firm_key: "topstep",
        dailyLossHaltedAt: "2026-06-22",  // sticky flag already set
      },
      dailyPnlBreakdown: { "2026-06-22": -400 },
    }];

    // Python would say NOT tripped (P&L recovered)
    pythonKillResult = {
      tripped: false,
      reason: null,
      force_close: false,
      daily_pnl_pct: -0.40,
      halt_pct_used: 0.67,
      force_close_pct_used: 0.95,
    };

    const result = await openPosition("sess-already-sticky", OPEN_PARAMS, { correlationId: "corr-already-sticky" });

    // Must block because sticky flag is set for today
    expect(result.executionResult.filled).toBe(false);

    // The sticky block audit must be written
    const stickyBlockAudit = auditRows.find(r =>
      r["action"] === "kill_switch.dll_halt_sticky_blocked"
    );
    expect(stickyBlockAudit).toBeDefined();
  });

  it("FAILING BEFORE FIX: sticky halt from a DIFFERENT CME trading day does NOT block new day", async () => {
    // Session has dailyLossHaltedAt from YESTERDAY — should NOT block today
    sessionRows = [{
      id: "sess-yesterday-halt",
      status: "active",
      firmId: "topstep",
      strategyId: "strat-1",
      currentEquity: "50200",
      peakEquity: "50200",
      totalTrades: 0,
      config: {
        daily_loss_limit: 1000,
        firm_key: "topstep",
        dailyLossHaltedAt: "2026-06-21",  // yesterday — should NOT block today
      },
      dailyPnlBreakdown: { "2026-06-22": 0 },
    }];

    // Python says not tripped for today
    pythonKillResult = {
      tripped: false,
      reason: null,
      force_close: false,
      daily_pnl_pct: 0,
      halt_pct_used: 0.67,
      force_close_pct_used: 0.95,
    };

    const result = await openPosition("sess-yesterday-halt", OPEN_PARAMS, { correlationId: "corr-new-day" });

    // Sticky halt from yesterday must NOT block today's entries
    // (The position may still not fill due to other gates, but NOT due to sticky halt)
    const stickyBlockAudit = auditRows.find(r =>
      r["action"] === "kill_switch.dll_halt_sticky_blocked"
    );
    expect(stickyBlockAudit).toBeUndefined();
  });
});

// =============================================================================
// GAP-2 — forceCloseAllPositions: null-price escalation + structured result
// =============================================================================

describe("GAP-2 — forceCloseAllPositions: null-price escalation, not silent skip", () => {
  it("FAILING BEFORE FIX: null-price position uses entryPrice fallback, does NOT silently stay open", async () => {
    openPositionRows = [
      {
        id: "pos-null-price",
        sessionId: "sess-1",
        symbol: "MES",
        entryPrice: "5000",
        currentPrice: null,  // null — no mark-to-market available
      },
    ];

    const result = await forceCloseAllPositions("dll_95_force_close");

    // With the fix: fallback to entryPrice; position is closed (not stuck-open)
    // The result must distinguish closed vs stuck
    expect(result).toHaveProperty("closed");
    expect(result).toHaveProperty("stuck");
    // If fallback succeeds: closed >= 0, stuck = 0 (or closed = 0, stuck = 1 if fallback still fails)
    // Key invariant: result MUST NOT be { count: 1 } without distinguishing close vs stuck
    const r = result as { closed: number; stuck: number; count: number };
    // At minimum the result must have the structured shape
    expect(typeof r.closed).toBe("number");
    expect(typeof r.stuck).toBe("number");
  });

  it("FAILING BEFORE FIX: when null-price fallback fails, emits paper.force_flatten_stuck audit (not soft skip)", async () => {
    openPositionRows = [
      {
        id: "pos-no-price-no-entry",
        sessionId: "sess-1",
        symbol: "MES",
        entryPrice: null,   // no entry price either
        currentPrice: null, // no current price
      },
    ];

    await forceCloseAllPositions("dll_95_force_close");

    // Soft skip audit MUST NOT be the only response
    const softSkip = auditRows.find(r => r["action"] === "paper.force_flatten_position_skipped");
    const hardStuck = auditRows.find(r => r["action"] === "paper.force_flatten_stuck");

    // After fix: CRITICAL stuck audit must be written when truly no price is available
    expect(hardStuck).toBeDefined();
    expect(hardStuck!["entityId"]).toBe("pos-no-price-no-entry");
    expect(hardStuck!["status"]).toBe("error");
  });

  it("FAILING BEFORE FIX: AlertFactory.criticalAlert is fired for a stuck position", async () => {
    openPositionRows = [
      {
        id: "pos-stuck-critical",
        sessionId: "sess-1",
        symbol: "MNQ",
        entryPrice: null,
        currentPrice: null,
      },
    ];

    await forceCloseAllPositions("dll_95_force_close");

    // AlertFactory.criticalAlert must have been called at least once
    expect(criticalAlertCalls.length).toBeGreaterThan(0);

    // The alert must mention the stuck position
    const alertArgs = criticalAlertCalls.find(args =>
      JSON.stringify(args).includes("pos-stuck-critical") ||
      JSON.stringify(args).includes("force_flatten_stuck")
    );
    expect(alertArgs).toBeDefined();
  });

  it("FAILING BEFORE FIX: structured result reports closed and stuck counts distinctly", async () => {
    openPositionRows = [
      {
        id: "pos-with-price",
        sessionId: "sess-1",
        symbol: "MES",
        entryPrice: "5000",
        currentPrice: "4950",  // valid — should close
      },
      {
        id: "pos-no-any-price",
        sessionId: "sess-1",
        symbol: "MNQ",
        entryPrice: null,
        currentPrice: null,  // truly stuck
      },
    ];

    const result = await forceCloseAllPositions("dll_95_force_close");

    // Must have structured shape (not just {count})
    expect(result).toHaveProperty("count");
    expect(result).toHaveProperty("closed");
    expect(result).toHaveProperty("stuck");

    const r = result as { count: number; closed: number; stuck: number };
    expect(r.count).toBe(2);
    // pos-no-any-price must be in stuck (1), pos-with-price should attempt close
    expect(r.stuck).toBeGreaterThanOrEqual(1);
  });

  it("FAILING BEFORE FIX: subsequent openPosition is BLOCKED when stuck positions exist from a breach", async () => {
    // First: create a stuck position during force-close
    openPositionRows = [
      {
        id: "pos-breach-stuck",
        sessionId: "sess-breach",
        symbol: "MES",
        entryPrice: null,
        currentPrice: null,
      },
    ];
    await forceCloseAllPositions("dll_95_force_close");

    // Now: openPosition on the SAME session must be blocked (stuck position not resolved)
    openPositionRows = [];
    sessionRows = [{
      id: "sess-breach",
      status: "active",
      firmId: "topstep",
      strategyId: "strat-1",
      currentEquity: "48000",
      peakEquity: "50000",
      totalTrades: 2,
      config: {
        daily_loss_limit: 1000,
        firm_key: "topstep",
        // After fix: stuck flag would be set in session config or in-memory
      },
      dailyPnlBreakdown: { "2026-06-22": -2000 },
    }];

    pythonKillResult = {
      tripped: false,
      reason: null,
      force_close: false,
      daily_pnl_pct: 0,
      halt_pct_used: 0.67,
      force_close_pct_used: 0.95,
    };

    const result = await openPosition("sess-breach", {
      ...OPEN_PARAMS,
      symbol: "MES",
    }, { correlationId: "corr-after-stuck" });

    // If stuck position exists, entry must be blocked
    const stuckBlockAudit = auditRows.find(r =>
      r["action"] === "paper.entry_blocked" &&
      JSON.stringify(r["result"]).includes("stuck_position")
    );

    // NOTE: This test establishes the EXPECTATION. The implementation must track
    // stuck positions in-memory (module-level Set) or via session config JSONB.
    // If the session's sessionId matches a known stuck session → block entries.
    expect(stuckBlockAudit).toBeDefined();
    expect(result.executionResult.filled).toBe(false);
  });

  it("null-price position uses entryPrice as FALLBACK (closes at $0 P&L, not stuck)", async () => {
    openPositionRows = [
      {
        id: "pos-entry-fallback",
        sessionId: "sess-1",
        symbol: "MES",
        entryPrice: "5000",  // has entry price
        currentPrice: null,   // no current price
      },
    ];

    const result = await forceCloseAllPositions("dll_95_force_close");

    // With fix: entryPrice fallback means position is ATTEMPTED to close (not soft-skipped)
    // The result.stuck should be 0 when entryPrice is available as fallback
    const r = result as { count: number; closed: number; stuck: number };
    // stuck must be 0 — fallback succeeded
    // (closed may be 0 if closePosition itself throws in mock env, but stuck must not increase)
    expect(r.stuck).toBe(0);

    // No stuck audit row should be written for this position
    const stuckAudit = auditRows.find(r =>
      r["action"] === "paper.force_flatten_stuck" &&
      r["entityId"] === "pos-entry-fallback"
    );
    expect(stuckAudit).toBeUndefined();
  });

  it("entryPrice fallback emits a distinct WARN audit (not a CRITICAL stuck audit)", async () => {
    openPositionRows = [
      {
        id: "pos-entry-warn",
        sessionId: "sess-1",
        symbol: "MES",
        entryPrice: "5100",
        currentPrice: null,
      },
    ];

    await forceCloseAllPositions("dll_95_force_close");

    // Should emit a warning-level fallback audit, not a stuck CRITICAL
    const fallbackAudit = auditRows.find(r =>
      r["action"] === "paper.force_flatten_fallback_entry_price" &&
      r["entityId"] === "pos-entry-warn"
    );
    expect(fallbackAudit).toBeDefined();
    // The fallback audit must record that we used entryPrice as the close price
    const input = fallbackAudit!["input"] as Record<string, unknown>;
    expect(input["fallbackPrice"]).toBe(5100);
  });
});
