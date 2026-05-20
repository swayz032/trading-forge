/**
 * wave23h-c2-firm-id-null-guard.test.ts — Wave 23H Fix 1
 *
 * Tests for the C2 firm suspension gate null-firmId path in paper-execution-service.ts.
 *
 * Coverage:
 *  1. When DB returns no session row (firmId=null), signal is blocked
 *  2. Audit row written with action=signal.blocked_firm_id_lookup_failed
 *  3. No fill executed (position=null, filled=false)
 *  4. When DB returns a valid firmId and firm is NOT suspended, gate passes to next check
 *  5. When DB returns a valid firmId and firm IS suspended, original C2 block fires (regression)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockIsHaltedForProduction = vi.fn().mockResolvedValue(false);
const mockBroadcastSSE = vi.fn();
const mockDbInsert = vi.fn();
const mockDbInsertValues = vi.fn().mockResolvedValue([]);
const mockDbUpdate = vi.fn();
const mockDbSelect = vi.fn();
const mockIsPipelineActive = vi.fn().mockResolvedValue(true);
const mockIsExchangeHalted = vi.fn().mockReturnValue(false);
const mockIsFirmSuspended = vi.fn().mockReturnValue(false);
const mockIsConnectivityDegraded = vi.fn().mockReturnValue(false);

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
  paperPositions: {
    id: "id",
    sessionId: "sessionId",
    symbol: "symbol",
    side: "side",
    contracts: "contracts",
    entryPrice: "entryPrice",
    closedAt: "closedAt",
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

const mockSseRouter = Object.assign(vi.fn(), {
  get: vi.fn(),
  use: vi.fn(),
  post: vi.fn(),
});

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
  getFirmAccount: vi.fn(() => ({
    dailyLossLimit: 1000,
    maxContracts: 10,
    maxDailyDrawdown: 2000,
    consistencyRule: null,
    overnightHolding: true,
  })),
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
  toEasternDateString: vi.fn(() => "2026-05-20"),
  toFuturesTradingDayString: vi.fn(() => "2026-05-20"),
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
  AlertFactory: {
    systemError: vi.fn(),
    warning: vi.fn(),
  },
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** DB select chain that returns no rows (simulates session-not-found for firm check). */
function makeEmptySelectChain() {
  const where = vi.fn().mockResolvedValue([]);
  const from = vi.fn().mockReturnValue({ where, orderBy: vi.fn().mockResolvedValue([]) });
  return { from };
}

/** DB select chain that returns a session row with a valid firmId. */
function makeSessionSelectChain(firmId: string | null) {
  const where = vi.fn().mockResolvedValue(
    firmId !== null ? [{ firmId }] : [],
  );
  const from = vi.fn().mockReturnValue({ where, orderBy: vi.fn().mockResolvedValue([]) });
  return { from };
}

function makeInsertChain() {
  return { values: mockDbInsertValues };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("C2 firm suspension gate — null firmId path (Wave 23H Fix 1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsHaltedForProduction.mockResolvedValue(false);
    mockIsPipelineActive.mockResolvedValue(true);
    mockIsExchangeHalted.mockReturnValue(false);
    mockIsFirmSuspended.mockReturnValue(false);
    mockIsConnectivityDegraded.mockReturnValue(false);
    mockDbInsert.mockReturnValue(makeInsertChain());
    mockDbUpdate.mockReturnValue({
      set: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })),
    });
  });

  it("1. signal is blocked (position=null, filled=false) when session row not found (firmId=null)", async () => {
    // DB returns no session row → firmIdForCheck will be null/undefined → fail-closed
    mockDbSelect.mockReturnValue(makeEmptySelectChain());

    const { openPosition } = await import("../services/paper-execution-service.js");
    const result = await openPosition("session-no-firm", {
      symbol: "MES",
      side: "long",
      signalPrice: 5000,
      contracts: 1,
    });

    expect(result.position).toBeNull();
    expect(result.executionResult.filled).toBe(false);
    expect(result.executionResult.fillRatio).toBe(0);
  });

  it("2. audit row with action=signal.blocked_firm_id_lookup_failed is written when firmId=null", async () => {
    mockDbSelect.mockReturnValue(makeEmptySelectChain());

    const { openPosition } = await import("../services/paper-execution-service.js");
    await openPosition("session-no-firm-2", {
      symbol: "MES",
      side: "long",
      signalPrice: 5000,
      contracts: 1,
    });

    const auditCall = mockDbInsertValues.mock.calls.find((args) => {
      const row = args[0];
      return row && row.action === "signal.blocked_firm_id_lookup_failed";
    });
    expect(auditCall).toBeDefined();
    expect(auditCall![0]).toMatchObject({
      action: "signal.blocked_firm_id_lookup_failed",
      entityType: "paper_session",
      entityId: "session-no-firm-2",
      status: "failure",
    });
    expect(auditCall![0].result).toMatchObject({
      reason: "firm_id_null",
      blocked: true,
    });
  });

  it("3. no fill executed — isFirmSuspended is never called when firmId is null", async () => {
    mockDbSelect.mockReturnValue(makeEmptySelectChain());

    const { openPosition } = await import("../services/paper-execution-service.js");
    await openPosition("session-no-firm-3", {
      symbol: "MNQ",
      side: "short",
      signalPrice: 20000,
      contracts: 2,
    });

    // isFirmSuspended must NOT have been called with undefined/null
    expect(mockIsFirmSuspended).not.toHaveBeenCalledWith(null);
    expect(mockIsFirmSuspended).not.toHaveBeenCalledWith(undefined);
  });

  it("4. gate passes through when firmId is valid and firm is NOT suspended", async () => {
    // Return a session row with a valid firmId; pipeline will pause after the
    // C2 check so we stop early without filling — but critically C2 must not block.
    mockDbSelect.mockImplementation(() =>
      makeSessionSelectChain("topstep"),
    );
    mockIsFirmSuspended.mockReturnValue(false);
    // Pause pipeline after firm check so we don't need full DB scaffolding
    mockIsPipelineActive.mockResolvedValue(false);

    const { openPosition } = await import("../services/paper-execution-service.js");
    const result = await openPosition("session-valid-firm", {
      symbol: "MES",
      side: "long",
      signalPrice: 5000,
      contracts: 1,
    });

    // C2 null-guard audit row must NOT have fired
    const nullGuardAudit = mockDbInsertValues.mock.calls.find((args) => {
      const row = args[0];
      return row && row.action === "signal.blocked_firm_id_lookup_failed";
    });
    expect(nullGuardAudit).toBeUndefined();
    // Position blocked by pipeline pause, not by C2
    expect(result.position).toBeNull();
  });

  it("5. regression — original C2 block still fires when firmId is valid and firm IS suspended", async () => {
    mockDbSelect.mockImplementation(() => makeSessionSelectChain("mffu"));
    mockIsFirmSuspended.mockReturnValue(true);

    const { openPosition } = await import("../services/paper-execution-service.js");
    const result = await openPosition("session-suspended-firm", {
      symbol: "MES",
      side: "long",
      signalPrice: 5000,
      contracts: 1,
    });

    expect(result.position).toBeNull();
    expect(result.executionResult.filled).toBe(false);
    // SSE event for firm suspension must have fired
    const suspensionSse = mockBroadcastSSE.mock.calls.find(
      ([evt]) => evt === "paper:order-blocked-suspension",
    );
    expect(suspensionSse).toBeDefined();
    expect(suspensionSse![1]).toMatchObject({
      sessionId: "session-suspended-firm",
      firmId: "mffu",
      reason: "firm_suspended",
    });
  });
});
