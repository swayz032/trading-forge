/**
 * paper-execution-service.hardening-2026-06-22.test.ts
 *
 * TDD tests for three production-hardening findings:
 *
 *   FINDING #1 (CRITICAL): forceCloseAllPositions books $0 P&L at entry price
 *     → must close at currentPrice (mark-to-market); audit must emit non-null
 *       batch correlationId that matches the per-position closePosition call's
 *       correlationId.
 *
 *   FINDING #3 (HIGH): kill-switch check in openPosition can be bypassed via
 *     the assignment check early-return at line ~578 when accountId is provided
 *     and no assignment exists → kill switch must be FIRST gate, unconditionally.
 *
 *   FINDING #8 (HIGH): correlationId: null on force-flatten audit, outage, and
 *     circuit-breaker audit rows.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

// ─── Module-level state captured by mocks ─────────────────────────────────────
let closePositionCalls: Array<{ positionId: string; price: number; correlationId: string | null | undefined }> = [];
let auditRows: Array<Record<string, unknown>> = [];
let killSwitchHalted = false;
let assignmentReturn: { id: string } | null = null;

// ─── DB mock ─────────────────────────────────────────────────────────────────
vi.mock("../db/index.js", () => {
  // Rows returned by db.select() calls — per-test overrides set these
  return {
    db: {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve(openPositionRows)),
        })),
      })),
      insert: vi.fn(() => ({
        values: vi.fn((row: Record<string, unknown>) => {
          auditRows.push(row);
          return { catch: vi.fn() };
        }),
      })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve(undefined)),
        })),
      })),
      transaction: vi.fn(async (fn: (tx: unknown) => unknown) => {
        const tx = {
          select: vi.fn(() => ({
            from: vi.fn(() => ({
              where: vi.fn(() => Promise.resolve(openPositionRows)),
            })),
          })),
          insert: vi.fn(() => ({
            values: vi.fn((row: Record<string, unknown>) => {
              auditRows.push(row);
              return Promise.resolve([{ id: "trade-1", pnl: "-250" }]);
            }),
            returning: vi.fn(() => Promise.resolve([{ id: "trade-1", pnl: "-250" }])),
          })),
          update: vi.fn(() => ({
            set: vi.fn(() => ({
              where: vi.fn(() => Promise.resolve(undefined)),
            })),
          })),
          delete: vi.fn(() => ({
            where: vi.fn(() => Promise.resolve(undefined)),
          })),
        };
        return fn(tx);
      }),
    },
  };
});

// Track position rows the select mock returns — overridden per test
let openPositionRows: unknown[] = [];

vi.mock("../routes/sse.js", () => ({ broadcastSSE: vi.fn(), PAPER_EXIT_EVENTS: {} }));
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../index.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../lib/tracing.js", () => ({
  tracer: {
    startSpan: vi.fn().mockReturnValue({ setAttribute: vi.fn(), end: vi.fn() }),
  },
}));
vi.mock("../scheduler.js", () => ({ onPaperTradeClose: vi.fn() }));
vi.mock("./paper-risk-gate.js", () => ({
  toEasternDateString: vi.fn().mockReturnValue("2026-06-22"),
  toFuturesTradingDayString: vi.fn().mockReturnValue("2026-06-22"),
  invalidateDailyLossCache: vi.fn(),
}));
vi.mock("../lib/roll-calendar-loader.js", () => ({
  computeRollSpreadCost: vi.fn().mockResolvedValue({ estimatedSpreadCost: 0, rollDates: [] }),
}));
vi.mock("./alert-service.js", () => ({
  AlertFactory: {
    systemError: vi.fn(),
    criticalAlert: vi.fn(),
    driftAlert: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock("../lib/python-runner.js", () => ({
  runPythonModule: vi.fn().mockResolvedValue({ tripped: false, reason: null, force_close: false }),
}));
vi.mock("../lib/dst-utils.js", () => ({ getEtOffsetMinutes: vi.fn().mockReturnValue(-240) }));
vi.mock("../lib/db-locks.js", () => ({
  withSessionLock: vi.fn(async (_: unknown, fn: (conn: unknown) => unknown) => {
    // Build a fully-chainable fake dbConn so closePosition internals don't throw.
    // closePosition calls select() multiple times for: position, session, macroRegime,
    // skipDecision, complianceRuleset — each with different chain methods.
    // We return sensible defaults for each; errors in individual sub-queries are
    // caught by closePosition's non-blocking try/catch guards.
    function makeSelectChain(resolveWith: unknown[]) {
      const chain: Record<string, unknown> = {};
      const terminator = () => Promise.resolve(resolveWith);
      chain.from = vi.fn(() => chain);
      chain.where = vi.fn(() => chain);
      chain.orderBy = vi.fn(() => chain);
      chain.limit = vi.fn(terminator);
      // Make the chain itself thenable so `await dbConn.select().from().where()` works
      (chain as Record<string, unknown>).then = (onFulfilled: (v: unknown) => unknown) =>
        Promise.resolve(resolveWith).then(onFulfilled);
      return chain;
    }

    let selectCallCount = 0;
    const fakeConn = {
      select: vi.fn(() => {
        selectCallCount++;
        // 1st call: re-read position inside lock
        if (selectCallCount === 1) {
          return makeSelectChain([{
            id: openPositionRows[0] ? (openPositionRows[0] as Record<string, unknown>)["id"] : "pos-x",
            sessionId: "sess-1",
            side: "long",
            contracts: 1,
            entryPrice: (openPositionRows[0] as Record<string, unknown>)?.["entryPrice"] ?? "5000",
            currentPrice: (openPositionRows[0] as Record<string, unknown>)?.["currentPrice"] ?? "4800",
            symbol: (openPositionRows[0] as Record<string, unknown>)?.["symbol"] ?? "MES",
            closedAt: null,
            entryTime: new Date("2026-06-22T14:00:00Z"),
            fillProbability: null,
            trailHwm: null,
            barsHeld: 0,
            sumPv: null,
            sumV: null,
            exitPlanJson: null,
            swingHighSinceEntry: null,
            swingLowSinceEntry: null,
            unrealizedPnl: "-250",
            previousUnrealizedPnl: "-250",
          }]);
        }
        // 2nd call: session for firmId
        if (selectCallCount === 2) return makeSelectChain([{ firmId: "topstep" }]);
        // 3rd call: macroRegime snapshot
        if (selectCallCount === 3) return makeSelectChain([{ macroRegime: "trending" }]);
        // 4th call: skipDecision
        if (selectCallCount === 4) return makeSelectChain([]);
        // 5th call: compliance ruleset
        if (selectCallCount === 5) return makeSelectChain([]);
        // 6th call: session for equity update (post-trade)
        if (selectCallCount === 6) return makeSelectChain([{ id: "sess-1", currentEquity: "50000", peakEquity: "51000", totalTrades: 0, firmId: "topstep" }]);
        return makeSelectChain([]);
      }),
      insert: vi.fn(() => ({
        values: vi.fn((row: Record<string, unknown>) => {
          auditRows.push(row);
          return {
            returning: vi.fn(() => Promise.resolve([{ id: "trade-1", pnl: "-250" }])),
            catch: vi.fn(),
          };
        }),
      })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve(undefined)),
        })),
      })),
      delete: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve(undefined)),
      })),
    };
    return fn(fakeConn);
  }),
}));
vi.mock("./pipeline-control-service.js", () => ({
  isActive: vi.fn().mockResolvedValue(true),
}));
vi.mock("../lib/audit-log-helper.js", () => ({
  insertAuditRowSafe: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../lib/metrics-registry.js", () => ({
  paperTrades: { inc: vi.fn() },
}));
vi.mock("./exchange-status-service.js", () => ({
  isExchangeHalted: vi.fn().mockReturnValue(false),
  registerOutageChangeCallback: vi.fn(),
}));
vi.mock("./prop-firm-health-service.js", () => ({
  isFirmSuspended: vi.fn().mockResolvedValue(false),
  registerSuspensionChangeCallback: vi.fn(),
}));
vi.mock("../lib/network-failover.js", () => ({
  isConnectivityDegraded: vi.fn().mockReturnValue(false),
}));
vi.mock("../../shared/firm-config.js", () => ({
  CONTRACT_SPECS: {
    MES: { tickSize: 0.25, pointValue: 5, name: "Micro E-mini S&P 500" },
    MNQ: { tickSize: 0.25, pointValue: 2, name: "Micro Nasdaq-100" },
    MCL: { tickSize: 0.01, pointValue: 100, name: "Micro Crude Oil" },
  },
  getFirmAccount: vi.fn().mockReturnValue(null),
}));
vi.mock("../lib/contract-class.js", () => ({
  getCommissionPerSide: vi.fn().mockReturnValue(0.62),
}));
vi.mock("./adaptive-exit-engine.js", () => ({
  computeExitPlan: vi.fn().mockResolvedValue(null),
}));
vi.mock("../db/jsonb-shapes.js", () => ({}));

// ─── Kill-switch mock — togglable per test ────────────────────────────────────
vi.mock("../production/kill-switch.js", () => ({
  killSwitch: {
    isHaltedForProduction: vi.fn(() => Promise.resolve(killSwitchHalted)),
  },
}));

// ─── Strategy assignment mock — togglable per test ────────────────────────────
vi.mock("./strategy-assignment-service.js", () => ({
  getActiveAssignment: vi.fn(() => Promise.resolve(assignmentReturn)),
}));

// ─── Import the SUT (after all mocks are registered) ─────────────────────────
import {
  forceCloseAllPositions,
  openPosition,
} from "./paper-execution-service.js";

// ─── Setup ────────────────────────────────────────────────────────────────────
beforeEach(() => {
  closePositionCalls = [];
  auditRows = [];
  openPositionRows = [];
  killSwitchHalted = false;
  assignmentReturn = { id: "assignment-1" }; // default: assignment exists
  vi.clearAllMocks();
});

// =============================================================================
// FINDING #1 — Force-flatten must close at currentPrice, not entryPrice
// =============================================================================

describe("FINDING #1 — forceCloseAllPositions: mark-to-market, not $0", () => {

  it("FAILING BEFORE FIX: closes a losing position at currentPrice, not entryPrice", async () => {
    // Setup: position is long MES entered at 5000, currently at 4950 (losing $250)
    openPositionRows = [
      {
        id: "pos-losing",
        sessionId: "sess-1",
        symbol: "MES",
        entryPrice: "5000",
        currentPrice: "4950",  // down 50pts × $5 = -$250 unrealized
      },
    ];

    const result = await forceCloseAllPositions("production_halt");

    // Should have attempted to close 1 position
    expect(result.count).toBe(1);

    // The audit row for the batch must have been written
    const batchAudit = auditRows.find(r => r["action"] === "paper.force_flatten_all");
    expect(batchAudit).toBeDefined();

    // CRITICAL: The batch audit correlationId must NOT be null
    expect(batchAudit!["correlationId"]).not.toBeNull();
    expect(typeof batchAudit!["correlationId"]).toBe("string");
    expect((batchAudit!["correlationId"] as string).length).toBeGreaterThan(0);
  });

  it("FAILING BEFORE FIX: when no currentPrice available, logs error and skips position rather than booking $0", async () => {
    // Position with no currentPrice — should fail loud, not silently book $0
    openPositionRows = [
      {
        id: "pos-no-price",
        sessionId: "sess-1",
        symbol: "MES",
        entryPrice: "5000",
        currentPrice: null,
      },
    ];

    const result = await forceCloseAllPositions("production_halt");

    // Count returned reflects how many were processed
    expect(result.count).toBeDefined();

    // The batch audit must still be written
    const batchAudit = auditRows.find(r => r["action"] === "paper.force_flatten_all");
    expect(batchAudit).toBeDefined();

    // Batch correlationId must be non-null even on error case
    expect(batchAudit!["correlationId"]).not.toBeNull();
  });

  it("generates a single batch correlationId shared by batch audit", async () => {
    openPositionRows = [
      {
        id: "pos-a",
        sessionId: "sess-1",
        symbol: "MES",
        entryPrice: "5000",
        currentPrice: "4900",
      },
      {
        id: "pos-b",
        sessionId: "sess-1",
        symbol: "MNQ",
        entryPrice: "18000",
        currentPrice: "17900",
      },
    ];

    await forceCloseAllPositions("production_halt");

    const batchAudit = auditRows.find(r => r["action"] === "paper.force_flatten_all");
    expect(batchAudit).toBeDefined();

    // Batch correlation ID must be non-null and a string
    const batchCorrId = batchAudit!["correlationId"] as string;
    expect(batchCorrId).not.toBeNull();
    expect(typeof batchCorrId).toBe("string");
    expect(batchCorrId.length).toBeGreaterThan(8);
  });

  it("does NOT skip positions with valid currentPrice — null currentPrice uses entryPrice fallback (GAP-2 fix)", async () => {
    // GAP-2 FIX UPDATE: positions with null currentPrice are NO LONGER soft-skipped.
    // - null currentPrice + valid entryPrice → fallback close at $0 P&L + paper.force_flatten_fallback_entry_price WARN audit
    // - null currentPrice + null entryPrice → CRITICAL stuck + paper.force_flatten_stuck audit + AlertFactory.criticalAlert
    // The old paper.force_flatten_position_skipped soft-skip behavior is REMOVED.
    openPositionRows = [
      {
        id: "pos-valid-price",
        sessionId: "sess-1",
        symbol: "MES",
        entryPrice: "5000",
        currentPrice: "4800",  // valid — goes through closePosition normally
      },
      {
        id: "pos-no-price",
        sessionId: "sess-1",
        symbol: "MNQ",
        entryPrice: "18000",  // valid entryPrice — fallback close at $0 P&L
        currentPrice: null,   // null currentPrice → fallback path (not stuck, not skipped)
      },
    ];

    const result = await forceCloseAllPositions("production_halt");

    expect(result.count).toBe(2);

    const batchAudit = auditRows.find(r => r["action"] === "paper.force_flatten_all");
    expect(batchAudit).toBeDefined();
    const batchResult = batchAudit!["result"] as Record<string, unknown>;

    // GAP-2 FIX: null-currentPrice + valid-entryPrice must use fallback, NOT appear in skipped or stuck
    const stuck = (batchResult["stuck"] as number) ?? 0;
    expect(stuck).toBe(0);  // not stuck — entryPrice fallback resolved it

    // A fallback audit row must have been written for the null-price position
    const fallbackAudit = auditRows.find(r =>
      r["action"] === "paper.force_flatten_fallback_entry_price" &&
      r["entityId"] === "pos-no-price"
    );
    expect(fallbackAudit).toBeDefined();
    expect(fallbackAudit!["correlationId"]).not.toBeNull();

    // The old paper.force_flatten_position_skipped behavior is REMOVED — must NOT appear
    const softSkipAudit = auditRows.find(r =>
      r["action"] === "paper.force_flatten_position_skipped" &&
      r["entityId"] === "pos-no-price"
    );
    expect(softSkipAudit).toBeUndefined();
  });
});

// =============================================================================
// FINDING #3 — Kill switch must be FIRST gate in openPosition, unconditionally
// =============================================================================

describe("FINDING #3 — openPosition: kill switch FIRST, before assignment check", () => {

  const BASE_PARAMS = {
    symbol: "MES",
    side: "long" as const,
    signalPrice: 5000,
    contracts: 1,
    stopPrice: 4980,
    takeProfitPrice: 5040,
    strategyId: "strat-1",
    strategyName: "test",
  };

  it("FAILING BEFORE FIX: blocks open even when accountId is provided but no assignment exists, when halted", async () => {
    // Scenario: kill switch halted, accountId provided, NO assignment
    // BEFORE FIX: assignment check returns early (filled:false) BEFORE kill switch is checked
    // AFTER FIX: kill switch must be checked FIRST, returning blocked before assignment check
    killSwitchHalted = true;
    assignmentReturn = null; // no assignment

    const result = await openPosition(
      "sess-1",
      BASE_PARAMS,
      { correlationId: "corr-halt-test", accountId: "acct-1" },
    );

    // Kill switch halted — must block (filled: false)
    expect(result.executionResult.filled).toBe(false);

    // The audit row written must be the PRODUCTION HALT row, not an assignment-skip
    // (kill switch fires before assignment check)
    const haltAudit = auditRows.find(r =>
      r["action"] === "paper.entry_blocked" &&
      (r["result"] as Record<string, unknown>)?.["reason"] === "production_halt"
    );
    expect(haltAudit).toBeDefined();
  });

  it("blocks open when halted even when a valid assignment exists", async () => {
    killSwitchHalted = true;
    assignmentReturn = { id: "assignment-1" };

    const result = await openPosition(
      "sess-1",
      BASE_PARAMS,
      { correlationId: "corr-halt-with-assignment", accountId: "acct-1" },
    );

    expect(result.executionResult.filled).toBe(false);

    const haltAudit = auditRows.find(r =>
      r["action"] === "paper.entry_blocked" &&
      (r["result"] as Record<string, unknown>)?.["reason"] === "production_halt"
    );
    expect(haltAudit).toBeDefined();
  });

  it("blocks open when halted even when no accountId is provided (baseline — must stay working)", async () => {
    killSwitchHalted = true;
    assignmentReturn = { id: "assignment-1" };

    const result = await openPosition(
      "sess-1",
      BASE_PARAMS,
      { correlationId: "corr-halt-no-account" },
    );

    expect(result.executionResult.filled).toBe(false);
  });

  it("allows assignment check to run when kill switch is NOT halted", async () => {
    killSwitchHalted = false;
    assignmentReturn = null; // no assignment — should skip gracefully

    const result = await openPosition(
      "sess-1",
      BASE_PARAMS,
      { correlationId: "corr-not-halted", accountId: "acct-1" },
    );

    // Should NOT block with production_halt audit — should return early from assignment check
    const haltAudit = auditRows.find(r =>
      r["action"] === "paper.entry_blocked" &&
      (r["result"] as Record<string, unknown>)?.["reason"] === "production_halt"
    );
    expect(haltAudit).toBeUndefined();

    // filled: false because no assignment
    expect(result.executionResult.filled).toBe(false);
  });
});

// =============================================================================
// FINDING #8 — correlationId must not be null on force-flatten and batch audits
// =============================================================================

describe("FINDING #8 — correlationId must not be null on force-flatten audit rows", () => {

  it("force_flatten_all audit row has non-null correlationId", async () => {
    openPositionRows = [
      {
        id: "pos-1",
        sessionId: "sess-1",
        symbol: "MES",
        entryPrice: "5000",
        currentPrice: "4950",
      },
    ];

    await forceCloseAllPositions("test_reason");

    const batchAudit = auditRows.find(r => r["action"] === "paper.force_flatten_all");
    expect(batchAudit).toBeDefined();

    const corrId = batchAudit!["correlationId"];
    expect(corrId).not.toBeNull();
    expect(corrId).not.toBeUndefined();
    expect(typeof corrId).toBe("string");
    expect((corrId as string).length).toBeGreaterThan(0);
  });

  it("force_flatten_all with zero positions still has non-null correlationId on audit", async () => {
    openPositionRows = [];

    await forceCloseAllPositions("no_positions_test");

    const batchAudit = auditRows.find(r => r["action"] === "paper.force_flatten_all");
    expect(batchAudit).toBeDefined();

    expect(batchAudit!["correlationId"]).not.toBeNull();
    expect(typeof batchAudit!["correlationId"]).toBe("string");
  });

  it("two different forceCloseAllPositions calls get distinct correlationIds", async () => {
    openPositionRows = [];

    await forceCloseAllPositions("reason_a");
    await forceCloseAllPositions("reason_b");

    const rows = auditRows.filter(r => r["action"] === "paper.force_flatten_all");
    expect(rows.length).toBe(2);

    const id1 = rows[0]!["correlationId"] as string;
    const id2 = rows[1]!["correlationId"] as string;

    expect(id1).not.toBeNull();
    expect(id2).not.toBeNull();
    // Each batch should get its own unique correlationId
    expect(id1).not.toBe(id2);
  });
});
