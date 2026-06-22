/**
 * paper-execution-production-halt.test.ts — Track 4 Phase 4C
 *
 * Tests for the production-halt gate and forceCloseAllPositions in
 * src/server/services/paper-execution-service.ts.
 *
 * Coverage:
 *  1.  openPosition returns blocked when production_mode='HALT'
 *  2.  openPosition proceeds when production_mode='PAPER' (other gates still apply)
 *  3.  openPosition proceeds when production_mode='LIVE' (other gates still apply)
 *  4.  audit_log row written on production_halt block
 *  5.  SSE event fires on production_halt block
 *  6.  openPosition fails CLOSED when killSwitch.isHaltedForProduction() throws
 *  7.  forceCloseAllPositions closes all open positions
 *  8.  forceCloseAllPositions writes audit_log row on completion
 *  9.  forceCloseAllPositions broadcasts paper:force-flatten-all SSE
 * 10.  forceCloseAllPositions returns count=0 when no open positions
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockIsHaltedForProduction = vi.fn();
const mockBroadcastSSE = vi.fn();
const mockDbInsert = vi.fn();
const mockDbInsertValues = vi.fn().mockResolvedValue([]);
const mockDbUpdate = vi.fn();
const mockDbSelect = vi.fn();
const mockIsPipelineActive = vi.fn().mockResolvedValue(true);
const mockIsExchangeHalted = vi.fn().mockReturnValue(false);
const mockIsFirmSuspended = vi.fn().mockReturnValue(false);
const mockIsConnectivityDegraded = vi.fn().mockReturnValue(false);
const mockClosePosition = vi.fn().mockResolvedValue({ success: true });

vi.mock("../production/kill-switch.js", () => ({
  killSwitch: {
    isHaltedForProduction: mockIsHaltedForProduction,
  },
}));

vi.mock("../db/index.js", () => ({
  db: {
    select: mockDbSelect,
    insert: mockDbInsert,
    update: mockDbUpdate,
  },
}));

vi.mock("../db/schema.js", () => ({
  paperSessions: { id: "id", firmId: "firmId", status: "status" },
  paperPositions: { id: "id", sessionId: "sessionId", symbol: "symbol", side: "side", contracts: "contracts", entryPrice: "entryPrice", closedAt: "closedAt" },
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
    // @ts-ignore — test-only: partial db schema mock; complianceRulesets not in the TypedKillSwitchDeps interface shape required by the real signature (W0.3 2026-06-22)
  complianceRulesets: {},
  complianceDriftLog: {},
  strategyMemory: {},
  strategyDslFeatures: {},
  strategyFirmEligibility: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_a, _b) => "eq"),
  and: vi.fn((...args) => args),
  isNull: vi.fn(() => "isNull"),
  desc: vi.fn(() => "desc"),
  sql: Object.assign(vi.fn(() => "sql"), { raw: vi.fn() }),
  inArray: vi.fn(() => "inArray"),
  isNotNull: vi.fn(() => "isNotNull"),
  gte: vi.fn(() => "gte"),
  lte: vi.fn(() => "lte"),
}));

const mockSseRouter = Object.assign(vi.fn(), { get: vi.fn(), use: vi.fn(), post: vi.fn() });

vi.mock("../routes/sse.js", () => ({
  broadcastSSE: mockBroadcastSSE,
  sseRoutes: mockSseRouter,
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
    startSpan: vi.fn(() => ({
      setAttribute: vi.fn(),
      setStatus: vi.fn(),
      end: vi.fn(),
    })),
  },
}));

vi.mock("../lib/db-locks.js", () => ({
  withSessionLock: vi.fn((_id, fn) => fn({})),
}));

vi.mock("../lib/metrics-registry.js", () => ({
  paperTrades: { inc: vi.fn() },
}));

vi.mock("../services/pipeline-control-service.js", () => ({
  isActive: mockIsPipelineActive,
  getMode: vi.fn().mockResolvedValue("ACTIVE"),
}));

vi.mock("../services/exchange-status-service.js", () => ({
  isExchangeHalted: mockIsExchangeHalted,
  registerOutageChangeCallback: vi.fn(),
}));

vi.mock("../services/prop-firm-health-service.js", () => ({
  isFirmSuspended: mockIsFirmSuspended,
  registerSuspensionChangeCallback: vi.fn(),
}));

vi.mock("../lib/network-failover.js", () => ({
  isConnectivityDegraded: mockIsConnectivityDegraded,
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
    MES: { tickSize: 0.25, tickValue: 1.25,   pointValue: 5.00   },
    MNQ: { tickSize: 0.25, tickValue: 0.50,   pointValue: 2.00   },  // F-7 fix: 0.50 not 2.0 (8 ticks/pt × $0.25 tickSize → $0.50/tick)
    MCL: { tickSize: 0.01, tickValue: 1.00,   pointValue: 100.00 },  // F-5 fix: pointValue 100.0 not 1000
  },
  FIRMS: {},
}));

vi.mock("../services/paper-risk-gate.js", () => ({
  toEasternDateString: vi.fn(() => "2026-05-09"),
  toFuturesTradingDayString: vi.fn(() => "2026-05-09"),
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

// Block any transitive loading of the full server entry point
vi.mock("../index.js", () => ({}));

vi.mock("../lib/roll-calendar-loader.js", () => ({
  computeRollSpreadCost: vi.fn().mockResolvedValue(0),
}));

vi.mock("../services/strategy-lockout-service.js", () => ({
  writeLockoutFromKillEvent: vi.fn(),
}));

vi.mock("../services/alert-service.js", () => ({
  AlertFactory: {
    systemError: vi.fn(),
    warning: vi.fn(),
  },
}));

// Block credential-loader from calling process.exit(1) on missing vault
vi.mock("../lib/credential-loader.js", () => ({
  loadCredentials: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/python-runner.js", () => ({
  runPythonModule: vi.fn().mockResolvedValue({ is_holiday: false, is_economic_event: false, is_triple_witching: false, holiday_proximity: 999, economic_event_name: "", event_window_minutes: 0 }),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeSelectChain(returnRows: unknown[]) {
  const where = vi.fn().mockReturnValue({
    limit: vi.fn().mockResolvedValue(returnRows),
    orderBy: vi.fn().mockResolvedValue(returnRows),
  });
  const from = vi.fn().mockReturnValue({ where, orderBy: vi.fn().mockResolvedValue(returnRows) });
  return { from };
}

function makeInsertChain() {
  return {
    values: mockDbInsertValues,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("paper-execution: production-halt gate (Phase 4C)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsPipelineActive.mockResolvedValue(true);
    mockIsExchangeHalted.mockReturnValue(false);
    mockIsFirmSuspended.mockReturnValue(false);
    mockIsConnectivityDegraded.mockReturnValue(false);
    mockDbInsert.mockReturnValue(makeInsertChain());
    mockDbUpdate.mockReturnValue({ set: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })) });
  });

  it("1. openPosition returns position=null when production_mode=HALT", async () => {
    mockIsHaltedForProduction.mockResolvedValue(true);
    // Minimal DB mock — select not reached after halt gate
    mockDbSelect.mockReturnValue(makeSelectChain([]));

    const { openPosition } = await import("../services/paper-execution-service.js");
    const result = await openPosition("session-1", {
      symbol: "MES",
      side: "long",
      signalPrice: 5000,
      contracts: 1,
    });

    expect(result.position).toBeNull();
    expect(result.executionResult.filled).toBe(false);
    expect(result.executionResult.fillRatio).toBe(0);
  });

  it("2. openPosition does NOT fire production-halt SSE when production_mode=PAPER (not halted)", async () => {
    // When isHaltedForProduction returns false, the production-halt gate is not tripped.
    // The function will proceed to the next gate (pipeline-pause) and ultimately return
    // null because the DB is minimally mocked — but no production-halt SSE fires.
    mockIsHaltedForProduction.mockResolvedValue(false);
    // pipeline gate: return false (paused) so the function returns early after the halt check
    mockIsPipelineActive.mockResolvedValue(false);

    const { openPosition } = await import("../services/paper-execution-service.js");
    const result = await openPosition("session-2", {
      symbol: "MES",
      side: "long",
      signalPrice: 5000,
      contracts: 1,
    });

    // production-halt SSE must NOT have fired
    const haltSseCall = mockBroadcastSSE.mock.calls.find(
      ([event]) => event === "paper:entry-blocked-production-halt",
    );
    expect(haltSseCall).toBeUndefined();
    // function did return (not throw)
    expect(result.position).toBeNull(); // pipeline paused → null
  });

  it("3. openPosition does NOT fire production-halt SSE when mode=LIVE (not halted)", async () => {
    mockIsHaltedForProduction.mockResolvedValue(false);
    // pipeline gate: return false so we stop before the DB-heavy path
    mockIsPipelineActive.mockResolvedValue(false);

    const { openPosition } = await import("../services/paper-execution-service.js");
    await openPosition("session-3", {
      symbol: "MES",
      side: "short",
      signalPrice: 5000,
      contracts: 1,
    });

    const haltSse = mockBroadcastSSE.mock.calls.find(
      ([evt]) => evt === "paper:entry-blocked-production-halt",
    );
    expect(haltSse).toBeUndefined();
  });

  it("4. audit_log written when production_halt blocks entry", async () => {
    mockIsHaltedForProduction.mockResolvedValue(true);
    mockDbSelect.mockReturnValue(makeSelectChain([]));

    const { openPosition } = await import("../services/paper-execution-service.js");
    await openPosition("session-4", {
      symbol: "MES",
      side: "long",
      signalPrice: 5000,
      contracts: 1,
    });

    expect(mockDbInsert).toHaveBeenCalled();
    const insertCall = mockDbInsertValues.mock.calls.find((args) => {
      const row = args[0];
      return row && row.action === "paper.entry_blocked";
    });
    expect(insertCall).toBeDefined();
    expect(insertCall![0].result).toMatchObject({ reason: "production_halt", blocked: true });
  });

  it("5. paper:entry-blocked-production-halt SSE fires when halt blocks entry", async () => {
    mockIsHaltedForProduction.mockResolvedValue(true);
    mockDbSelect.mockReturnValue(makeSelectChain([]));

    const { openPosition } = await import("../services/paper-execution-service.js");
    await openPosition("session-5", {
      symbol: "MNQ",
      side: "short",
      signalPrice: 20000,
      contracts: 1,
    });

    const haltSse = mockBroadcastSSE.mock.calls.find(
      ([evt]) => evt === "paper:entry-blocked-production-halt",
    );
    expect(haltSse).toBeDefined();
    expect(haltSse![1]).toMatchObject({
      sessionId: "session-5",
      symbol: "MNQ",
      side: "short",
      reason: "production_halt",
    });
  });

  it("6. openPosition fails CLOSED (returns blocked) when isHaltedForProduction throws", async () => {
    mockIsHaltedForProduction.mockRejectedValue(new Error("DB connection lost"));
    mockDbSelect.mockReturnValue(makeSelectChain([]));

    const { openPosition } = await import("../services/paper-execution-service.js");
    const result = await openPosition("session-6", {
      symbol: "MES",
      side: "long",
      signalPrice: 5000,
      contracts: 2,
    });

    // Fail-CLOSED: exception must produce a blocked result, not throw
    expect(result.position).toBeNull();
    expect(result.executionResult.filled).toBe(false);

    // Error SSE must fire with the check_error reason
    const haltSse = mockBroadcastSSE.mock.calls.find(
      ([evt]) => evt === "paper:entry-blocked-production-halt",
    );
    expect(haltSse).toBeDefined();
    expect(haltSse![1].reason).toBe("production_halt_check_error");
  });
});

describe("paper-execution: forceCloseAllPositions (Phase 4C)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbInsert.mockReturnValue(makeInsertChain());
  });

  it("7. forceCloseAllPositions closes all open positions", async () => {
    const openPos = [
      { id: "pos-1", sessionId: "sess-1", symbol: "MES", entryPrice: "5000" },
      { id: "pos-2", sessionId: "sess-1", symbol: "MNQ", entryPrice: "20000" },
    ];
    mockDbSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(openPos),
      }),
    });

    // closePosition is a named export — we need to spy on the module itself.
    // In this isolated unit test we re-import; closePosition calls DB which is mocked.
    // We verify the count returned is correct.
    mockDbUpdate.mockReturnValue({
      set: vi.fn(() => ({
        where: vi.fn().mockResolvedValue([]),
      })),
    });
    // closePosition internally calls dbConn.select — stub it as well
    const innerSelect = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([
          { id: "pos-1", sessionId: "sess-1", symbol: "MES", side: "long", contracts: 1, entryPrice: "5000", closedAt: null, exitPrice: null, pnlGross: null },
        ]),
      }),
    });
    mockDbSelect.mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(openPos),
      }),
    }));

    const { forceCloseAllPositions } = await import("../services/paper-execution-service.js");
    const result = await forceCloseAllPositions("test_halt");

    // Count matches the open positions found
    expect(result.count).toBe(2);
  });

  it("8. forceCloseAllPositions writes paper.force_flatten_all audit_log row", async () => {
    mockDbSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([
          { id: "pos-a", sessionId: "sess-x", symbol: "MES", entryPrice: "5000" },
        ]),
      }),
    });
    mockDbUpdate.mockReturnValue({ set: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })) });

    const { forceCloseAllPositions } = await import("../services/paper-execution-service.js");
    await forceCloseAllPositions("operator_halt_test");

    // audit_log.insert must have been called with action=paper.force_flatten_all
    const auditCall = mockDbInsertValues.mock.calls.find((args) => {
      const row = args[0];
      return row && row.action === "paper.force_flatten_all";
    });
    expect(auditCall).toBeDefined();
    expect(auditCall![0].result).toMatchObject({ reason: "operator_halt_test" });
  });

  it("9. forceCloseAllPositions broadcasts paper:force-flatten-all SSE", async () => {
    mockDbSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([
          { id: "pos-b", sessionId: "sess-y", symbol: "MES", entryPrice: "5001" },
        ]),
      }),
    });
    mockDbUpdate.mockReturnValue({ set: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })) });

    const { forceCloseAllPositions } = await import("../services/paper-execution-service.js");
    await forceCloseAllPositions("system_halt");

    const sseFlattenCall = mockBroadcastSSE.mock.calls.find(
      ([evt]) => evt === "paper:force-flatten-all",
    );
    expect(sseFlattenCall).toBeDefined();
    expect(sseFlattenCall![1]).toMatchObject({ reason: "system_halt" });
  });

  it("10. forceCloseAllPositions returns count=0 when no open positions exist", async () => {
    mockDbSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    });

    const { forceCloseAllPositions } = await import("../services/paper-execution-service.js");
    const result = await forceCloseAllPositions("no_positions_halt");

    expect(result.count).toBe(0);
  });
});
