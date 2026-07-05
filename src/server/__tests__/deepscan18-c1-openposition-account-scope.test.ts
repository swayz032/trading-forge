/**
 * deepscan18-c1-openposition-account-scope.test.ts — deepscan #18 fix wave,
 * Track 1: Multi-Account Isolation, C-C1 (2026-07-05)
 *
 * openPosition()'s kill-switch gate (paper-execution-service.ts ~734) must
 * forward the caller's OPTIONAL context.accountKey/context.firmId straight
 * into killSwitch.isHaltedForProduction() so a sibling account's breach
 * doesn't block THIS account's entry. Omitting them must produce the exact
 * legacy call shape (byte-identical global evaluation) for callers that
 * don't know about account scoping yet (e.g. the manual
 * POST /api/paper/execute/open route).
 *
 * Mock scaffold mirrors paper-execution-production-halt.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockIsHaltedForProduction = vi.fn().mockResolvedValue(false);
const mockBroadcastSSE = vi.fn();
const mockDbInsert = vi.fn();
const mockDbInsertValues = vi.fn().mockResolvedValue([]);
const mockDbUpdate = vi.fn();
const mockDbSelect = vi.fn();
const mockIsPipelineActive = vi.fn().mockResolvedValue(false); // stop early after the halt gate — no deep DB path needed

vi.mock("../production/kill-switch.js", () => ({
  killSwitch: { isHaltedForProduction: mockIsHaltedForProduction },
}));

vi.mock("../db/index.js", () => ({
  db: { select: mockDbSelect, insert: mockDbInsert, update: mockDbUpdate },
}));

vi.mock("../db/schema.js", () => ({
  paperSessions: { id: "id", firmId: "firmId", status: "status" },
  paperPositions: { id: "id", sessionId: "sessionId", symbol: "symbol", side: "side", contracts: "contracts", entryPrice: "entryPrice", closedAt: "closedAt" },
  paperTrades: {}, strategies: {}, shadowSignals: {}, auditLog: { action: "action" },
  macroSnapshots: {}, skipDecisions: {}, complianceRulesets: {}, complianceReviews: {},
  contractRolls: {}, weeklyDriftReports: {}, systemState: {}, pilotSessions: {}, backtests: {},
  systemParameters: {}, complianceDriftLog: {}, strategyMemory: {}, strategyDslFeatures: {}, strategyFirmEligibility: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => "eq"), and: vi.fn((...args) => args), isNull: vi.fn(() => "isNull"),
  desc: vi.fn(() => "desc"), sql: Object.assign(vi.fn(() => "sql"), { raw: vi.fn() }),
  inArray: vi.fn(() => "inArray"), isNotNull: vi.fn(() => "isNotNull"), gte: vi.fn(() => "gte"), lte: vi.fn(() => "lte"),
}));

const mockSseRouter = Object.assign(vi.fn(), { get: vi.fn(), use: vi.fn(), post: vi.fn() });
vi.mock("../routes/sse.js", () => ({
  broadcastSSE: mockBroadcastSSE, sseRoutes: mockSseRouter, closeAllSseClients: vi.fn(),
  PAPER_EXIT_EVENTS: {
    TP1_FILLED: "paper:exit:tp1_filled", TP2_FILLED: "paper:exit:tp2_filled", BE_STOP_MOVED: "paper:exit:be_stop_moved",
    TRAIL_TIGHTENED: "paper:exit:trail_tightened", TIME_STOP_FLATTENED: "paper:exit:time_stop_flattened", HANDLER_ERROR: "paper:exit:handler_error",
  },
}));

vi.mock("../lib/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../lib/tracing.js", () => ({ tracer: { startSpan: vi.fn(() => ({ setAttribute: vi.fn(), setStatus: vi.fn(), end: vi.fn() })) } }));
vi.mock("../lib/db-locks.js", () => ({ withSessionLock: vi.fn((_id, fn) => fn({})) }));
vi.mock("../lib/metrics-registry.js", () => ({ paperTrades: { inc: vi.fn() } }));
vi.mock("../services/pipeline-control-service.js", () => ({ isActive: mockIsPipelineActive, getMode: vi.fn().mockResolvedValue("ACTIVE") }));
vi.mock("../services/exchange-status-service.js", () => ({ isExchangeHalted: vi.fn().mockReturnValue(false), registerOutageChangeCallback: vi.fn() }));
vi.mock("../services/prop-firm-health-service.js", () => ({ isFirmSuspended: vi.fn().mockReturnValue(false), registerSuspensionChangeCallback: vi.fn() }));
vi.mock("../lib/network-failover.js", () => ({ isConnectivityDegraded: vi.fn().mockReturnValue(false) }));
vi.mock("../../shared/firm-config.js", () => ({
  getFirmAccount: vi.fn(() => ({ dailyLossLimit: 1000, maxContracts: 10, maxDailyDrawdown: 2000, consistencyRule: null, overnightHolding: true })),
  getTightestDrawdown: vi.fn(() => ({ firm: "topstep", maxDrawdown: 2000 })),
  getAllFirms: vi.fn(() => []), getFirmLimit: vi.fn(() => 10), getBufferAmount: vi.fn(() => 0),
  getCommissionPerSide: vi.fn(() => 0.62), CONTRACT_CAP_MAX: 20, CONTRACT_CAP_MIN: 10,
  DEFAULT_ACCOUNT_SIZE: 50000, DEFAULT_ACCOUNT_TYPE: "50k", DEFAULT_COMMISSION_PER_SIDE: 0.62,
  CONTRACT_SPECS: {
    MES: { tickSize: 0.25, tickValue: 1.25, pointValue: 5.00 },
    MNQ: { tickSize: 0.25, tickValue: 0.50, pointValue: 2.00 },
    MCL: { tickSize: 0.01, tickValue: 1.00, pointValue: 100.00 },
  },
  FIRMS: {},
}));
vi.mock("../services/paper-risk-gate.js", () => ({
  toEasternDateString: vi.fn(() => "2026-07-05"), toFuturesTradingDayString: vi.fn(() => "2026-07-05"), invalidateDailyLossCache: vi.fn(),
}));
vi.mock("../lib/dst-utils.js", () => ({ getEtOffsetMinutes: vi.fn(() => -240) }));
vi.mock("../scheduler.js", () => ({ onPaperTradeClose: vi.fn(), initScheduler: vi.fn(), getSchedulerHealth: vi.fn().mockReturnValue({}) }));
vi.mock("../index.js", () => ({}));
vi.mock("../lib/roll-calendar-loader.js", () => ({ computeRollSpreadCost: vi.fn().mockResolvedValue(0) }));
vi.mock("../services/strategy-lockout-service.js", () => ({ writeLockoutFromKillEvent: vi.fn() }));
vi.mock("../services/alert-service.js", () => ({ AlertFactory: { systemError: vi.fn(), warning: vi.fn() } }));
vi.mock("../lib/credential-loader.js", () => ({ loadCredentials: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../lib/python-runner.js", () => ({
  runPythonModule: vi.fn().mockResolvedValue({ is_holiday: false, is_economic_event: false, is_triple_witching: false, holiday_proximity: 999, economic_event_name: "", event_window_minutes: 0 }),
}));

describe("deepscan18 C-C1: openPosition() forwards account/firm scope to isHaltedForProduction()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsHaltedForProduction.mockResolvedValue(false);
    mockIsPipelineActive.mockResolvedValue(false); // return early right after the halt gate
    mockDbInsert.mockReturnValue({ values: mockDbInsertValues });
    mockDbUpdate.mockReturnValue({ set: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })) });
    mockDbSelect.mockReturnValue({ from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]), orderBy: vi.fn().mockResolvedValue([]) }) }) });
  });

  it("forwards context.accountKey and context.firmId into isHaltedForProduction() when supplied", async () => {
    const { openPosition } = await import("../services/paper-execution-service.js");
    await openPosition(
      "session-scoped",
      { symbol: "MES", side: "long", signalPrice: 5000, contracts: 1 },
      { correlationId: "corr-scoped-1", accountKey: "acct-A", firmId: "topstep" },
    );

    expect(mockIsHaltedForProduction).toHaveBeenCalledWith({
      correlationId: "corr-scoped-1",
      accountKey: "acct-A",
      firmId: "topstep",
    });
  });

  it("passes accountKey/firmId as undefined when the caller omits them — byte-identical legacy call shape", async () => {
    const { openPosition } = await import("../services/paper-execution-service.js");
    await openPosition(
      "session-unscoped",
      { symbol: "MES", side: "long", signalPrice: 5000, contracts: 1 },
      { correlationId: "corr-unscoped-1" },
    );

    expect(mockIsHaltedForProduction).toHaveBeenCalledWith({
      correlationId: "corr-unscoped-1",
      accountKey: undefined,
      firmId: undefined,
    });
  });

  it("with NO context object at all (e.g. the manual /api/paper/execute/open route), still calls isHaltedForProduction with a fresh correlationId and undefined scope", async () => {
    const { openPosition } = await import("../services/paper-execution-service.js");
    await openPosition("session-manual", { symbol: "MES", side: "long", signalPrice: 5000, contracts: 1 });

    expect(mockIsHaltedForProduction).toHaveBeenCalledWith(
      expect.objectContaining({ accountKey: undefined, firmId: undefined }),
    );
  });
});
