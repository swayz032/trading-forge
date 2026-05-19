/**
 * cf6-inarray-symbol-query.test.ts — Wave 13 Track D
 *
 * Pins the correct Drizzle query shape for the two ANY()-over-array bugs
 * discovered in CF-6 (Wave 12). Both were using raw sql`` template literals
 * that expanded array elements as separate positional params ($1,$2,$3...),
 * which Postgres rejects with:
 *   "op ANY/ALL (array) requires array on right side"
 *
 * Fix: replaced both with inArray(col, array) which Drizzle renders as
 *   col = ANY($1) with a proper Postgres array parameter.
 *
 * This test verifies:
 *  1.  C1 outage callback calls inArray(paperPositions.symbol, affectedSymbols)
 *      NOT sql`... = ANY(${affectedSymbols})`
 *  2.  C2 suspension callback calls inArray(paperPositions.sessionId, sessionIds)
 *      NOT sql`... = ANY(${sessionIds})`
 *  3.  inArray is NOT called with spread args (the call-site shape is correct)
 *  4.  The sql import is NOT used for symbol or sessionId ANY-array filtering
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Track inArray calls ──────────────────────────────────────────────────────

const capturedInArrayCalls: Array<{ col: unknown; values: unknown }> = [];

const mockInArray = vi.fn((col: unknown, values: unknown) => {
  capturedInArrayCalls.push({ col, values });
  return "inArray_result";
});

// Track sql`` template usage for symbol/sessionId filtering
const capturedSqlCalls: string[] = [];
const mockSql = Object.assign(
  vi.fn((...args: unknown[]) => {
    const str = String(args[0]);
    capturedSqlCalls.push(str);
    return "sql_result";
  }),
  { raw: vi.fn() },
);

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_a, _b) => "eq"),
  and: vi.fn((...args: unknown[]) => args),
  isNull: vi.fn(() => "isNull_closedAt"),
  desc: vi.fn(() => "desc"),
  sql: mockSql,
  inArray: mockInArray,
  isNotNull: vi.fn(() => "isNotNull"),
  gte: vi.fn(() => "gte"),
  lte: vi.fn(() => "lte"),
}));

// ─── DB mock — captures the where() predicate arguments ──────────────────────

const capturedWhereArgs: unknown[][] = [];

const makeSelectChain = (returnRows: unknown[]) => ({
  from: vi.fn().mockReturnValue({
    where: vi.fn((...args: unknown[]) => {
      capturedWhereArgs.push(args);
      return Promise.resolve(returnRows);
    }),
    orderBy: vi.fn().mockResolvedValue(returnRows),
  }),
});

const mockDbSelect = vi.fn(() => makeSelectChain([]));
const mockDbInsert = vi.fn().mockReturnValue({
  values: vi.fn().mockResolvedValue([]),
});
const mockDbUpdate = vi.fn().mockReturnValue({
  set: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })),
});

vi.mock("../db/index.js", () => ({
  db: {
    select: mockDbSelect,
    insert: mockDbInsert,
    update: mockDbUpdate,
  },
}));

vi.mock("../db/schema.js", () => ({
  paperSessions: { id: "ps.id", firmId: "ps.firmId", status: "ps.status" },
  paperPositions: {
    id: "pp.id",
    sessionId: "pp.sessionId",
    symbol: "pp.symbol",
    side: "pp.side",
    contracts: "pp.contracts",
    entryPrice: "pp.entryPrice",
    closedAt: "pp.closedAt",
  },
  paperTrades: {},
  strategies: {},
  shadowSignals: {},
  auditLog: { action: "action" },
  macroSnapshots: {},
  skipDecisions: {},
  complianceRulesets: {},
  complianceReviews: {},
  contractRolls: {},
  weeklyDriftReports: {},
  systemState: {},
  pilotSessions: {},
  backtests: {},
  systemParameters: {},
  complianceDriftLog: {},
  strategyMemory: {},
  strategyDslFeatures: {},
  strategyFirmEligibility: {},
}));

// ─── Outage/Suspension callback capture ──────────────────────────────────────

let capturedOutageCallback: ((exchange: string, isActive: boolean, affectedSymbols: string[]) => Promise<void>) | null = null;
let capturedSuspensionCallback: ((firmId: string, suspended: boolean) => Promise<void>) | null = null;

vi.mock("../services/exchange-status-service.js", () => ({
  isExchangeHalted: vi.fn().mockReturnValue(false),
  registerOutageChangeCallback: vi.fn((cb) => {
    capturedOutageCallback = cb;
  }),
}));

vi.mock("../services/prop-firm-health-service.js", () => ({
  isFirmSuspended: vi.fn().mockReturnValue(false),
  registerSuspensionChangeCallback: vi.fn((cb) => {
    capturedSuspensionCallback = cb;
  }),
}));

// ─── Remaining mocks (keep module loading clean) ─────────────────────────────

vi.mock("../production/kill-switch.js", () => ({
  killSwitch: { isHaltedForProduction: vi.fn().mockResolvedValue(false) },
}));

vi.mock("../routes/sse.js", () => ({
  broadcastSSE: vi.fn(),
  sseRoutes: Object.assign(vi.fn(), { get: vi.fn(), use: vi.fn(), post: vi.fn() }),
  closeAllSseClients: vi.fn(),
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

vi.mock("../lib/tracing.js", () => ({
  tracer: {
    startSpan: vi.fn(() => ({ setAttribute: vi.fn(), setStatus: vi.fn(), end: vi.fn() })),
  },
}));

vi.mock("../lib/db-locks.js", () => ({
  withSessionLock: vi.fn((_id, fn) => fn({})),
}));

vi.mock("../lib/metrics-registry.js", () => ({
  paperTrades: { inc: vi.fn() },
}));

vi.mock("../services/pipeline-control-service.js", () => ({
  isActive: vi.fn().mockResolvedValue(true),
  getMode: vi.fn().mockResolvedValue("ACTIVE"),
}));

vi.mock("../lib/network-failover.js", () => ({
  isConnectivityDegraded: vi.fn().mockReturnValue(false),
}));

vi.mock("../../shared/firm-config.js", () => ({
  getFirmAccount: vi.fn(() => ({ dailyLossLimit: 1000, maxContracts: 10, maxDailyDrawdown: 2000, consistencyRule: null, overnightHolding: true })),
  getTightestDrawdown: vi.fn(() => ({ firm: "topstep", maxDrawdown: 2000 })),
  getAllFirms: vi.fn(() => []),
  getFirmLimit: vi.fn(() => 10),
  getBufferAmount: vi.fn(() => 0),
  getCommissionPerSide: vi.fn(() => 0.62),
  CONTRACT_CAP_MAX: 20,
  CONTRACT_CAP_MIN: 10,
  DEFAULT_ACCOUNT_SIZE: 50000,
  DEFAULT_ACCOUNT_TYPE: "50k",
  DEFAULT_COMMISSION_PER_SIDE: 0.62,
  CONTRACT_SPECS: {
    MES: { tickSize: 0.25, tickValue: 1.25, pointValue: 5 },
    MNQ: { tickSize: 0.25, tickValue: 2.0, pointValue: 2 },
    MCL: { tickSize: 0.01, tickValue: 10.0, pointValue: 1000 },
  },
  FIRMS: {},
}));

vi.mock("../services/paper-risk-gate.js", () => ({
  toEasternDateString: vi.fn(() => "2026-05-18"),
  toFuturesTradingDayString: vi.fn(() => "2026-05-18"),
  invalidateDailyLossCache: vi.fn(),
}));

vi.mock("../lib/dst-utils.js", () => ({
  getEtOffsetMinutes: vi.fn(() => -240),
}));

vi.mock("../scheduler.js", () => ({
  onPaperTradeClose: vi.fn(),
  initScheduler: vi.fn(),
  getSchedulerHealth: vi.fn().mockReturnValue({}),
}));

vi.mock("../index.js", () => ({}));

vi.mock("../lib/roll-calendar-loader.js", () => ({
  computeRollSpreadCost: vi.fn().mockResolvedValue(0),
}));

vi.mock("../services/strategy-lockout-service.js", () => ({
  writeLockoutFromKillEvent: vi.fn(),
}));

vi.mock("../services/alert-service.js", () => ({
  AlertFactory: { systemError: vi.fn(), warning: vi.fn() },
}));

vi.mock("../lib/credential-loader.js", () => ({
  loadCredentials: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/python-runner.js", () => ({
  runPythonModule: vi.fn().mockResolvedValue({
    is_holiday: false,
    is_economic_event: false,
    is_triple_witching: false,
    holiday_proximity: 999,
    economic_event_name: "",
    event_window_minutes: 0,
  }),
}));

vi.mock("../services/strategy-assignment-service.js", () => ({
  getActiveAssignment: vi.fn().mockResolvedValue(null),
}));

// ─── Import module (triggers registerOutageChangeCallback + registerSuspensionChangeCallback) ─

await import("../services/paper-execution-service.js");

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("CF-6: paper-execution inArray query shape (Wave 13 Track D)", () => {
  beforeEach(() => {
    capturedInArrayCalls.length = 0;
    capturedSqlCalls.length = 0;
    capturedWhereArgs.length = 0;
    vi.clearAllMocks();
    // Restore select mock after clearAllMocks
    mockDbSelect.mockImplementation(() => makeSelectChain([]));
    mockDbInsert.mockReturnValue({ values: vi.fn().mockResolvedValue([]) });
  });

  it("1. C1 outage callback uses inArray(paperPositions.symbol, affectedSymbols) not raw sql ANY", async () => {
    expect(capturedOutageCallback).not.toBeNull();

    const affectedSymbols = ["MES", "MNQ", "MCL", "MYM", "M2K", "MCL", "MBT", "MGC", "MSI", "MHG"];
    await capturedOutageCallback!("CME", true, affectedSymbols);

    // inArray must have been called with the symbol column and the full array
    const symbolCall = capturedInArrayCalls.find(c => c.col === "pp.symbol");
    expect(symbolCall).toBeDefined();
    expect(symbolCall!.values).toEqual(affectedSymbols);

    // inArray must receive the array as the SECOND argument (not spread)
    expect(Array.isArray(symbolCall!.values)).toBe(true);
    expect((symbolCall!.values as string[]).length).toBe(affectedSymbols.length);
  });

  it("2. C1 outage callback does NOT use sql template for symbol ANY filtering", async () => {
    expect(capturedOutageCallback).not.toBeNull();

    capturedSqlCalls.length = 0;
    const affectedSymbols = ["MES", "MNQ", "MCL"];
    await capturedOutageCallback!("CME", true, affectedSymbols);

    // No sql template call should contain '= ANY(' for the symbol filter
    const anySymbolSql = capturedSqlCalls.find(s => s.includes("ANY") && s.includes("symbol"));
    expect(anySymbolSql).toBeUndefined();
  });

  it("3. C2 suspension callback uses inArray(paperPositions.sessionId, sessionIds) not raw sql ANY", async () => {
    expect(capturedSuspensionCallback).not.toBeNull();

    // Set up firm sessions to be returned
    const firmSessions = [
      { id: "sess-aaa", firmId: "topstep" },
      { id: "sess-bbb", firmId: "topstep" },
    ];
    mockDbSelect.mockImplementationOnce(() => makeSelectChain(firmSessions));
    // Second call for open positions — returns empty
    mockDbSelect.mockImplementationOnce(() => makeSelectChain([]));

    await capturedSuspensionCallback!("topstep", true);

    // inArray must have been called with the sessionId column and an array of session IDs
    const sessionCall = capturedInArrayCalls.find(c => c.col === "pp.sessionId");
    expect(sessionCall).toBeDefined();
    expect(Array.isArray(sessionCall!.values)).toBe(true);
    expect(sessionCall!.values).toEqual(["sess-aaa", "sess-bbb"]);
  });

  it("4. C2 suspension callback does NOT use sql template for sessionId ANY filtering", async () => {
    expect(capturedSuspensionCallback).not.toBeNull();

    const firmSessions = [{ id: "sess-ccc", firmId: "topstep" }];
    mockDbSelect.mockImplementationOnce(() => makeSelectChain(firmSessions));
    mockDbSelect.mockImplementationOnce(() => makeSelectChain([]));

    capturedSqlCalls.length = 0;
    await capturedSuspensionCallback!("topstep", true);

    const anySessionSql = capturedSqlCalls.find(s => s.includes("ANY") && s.includes("session"));
    expect(anySessionSql).toBeUndefined();
  });

  it("5. inArray called with exactly 2 args (col, array) — not spread varargs", async () => {
    expect(capturedOutageCallback).not.toBeNull();

    const affectedSymbols = ["MES", "MNQ"];
    await capturedOutageCallback!("CME", true, affectedSymbols);

    // mockInArray receives (col, values) — vitest records the args array
    const call = mockInArray.mock.calls.find(args => args[0] === "pp.symbol");
    expect(call).toBeDefined();
    // Exactly 2 arguments: col and the array
    expect(call!.length).toBe(2);
    // Second arg is the array, not a spread of individual strings
    expect(Array.isArray(call![1])).toBe(true);
    expect(call![1]).toEqual(affectedSymbols);
  });

  it("6. C2 suspension callback skips inArray query when no active sessions exist", async () => {
    expect(capturedSuspensionCallback).not.toBeNull();

    // No firm sessions → inArray for sessionId must NOT be called
    mockDbSelect.mockImplementationOnce(() => makeSelectChain([]));

    capturedInArrayCalls.length = 0;
    await capturedSuspensionCallback!("mffu", true);

    const sessionCall = capturedInArrayCalls.find(c => c.col === "pp.sessionId");
    expect(sessionCall).toBeUndefined();
  });
});
