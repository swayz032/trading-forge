/**
 * deepscan17-c1-e1-force-close-scope-correlation.test.ts — deepscan #17 fix
 * wave 1 (agent FIX-KILLSWITCH, 2026-07-05)
 *
 * C-1(b) OVER-REACH regression coverage: forceCloseAllPositions() had NO
 * session/account/firm filter — `.where(isNull(paperPositions.closedAt))`
 * alone flattened EVERY open position system-wide. A single account's DLL-95%
 * breach (or the D6 Python kill-switch trip on ONE session) would force-close
 * every OTHER healthy account/firm sharing the process.
 *
 * Fix: an optional `opts.scope` (accountKey | sessionIds) narrows the flatten
 * to the breached account. Applied in application code (post-query filter),
 * so the unscoped default path's query shape is byte-identical to pre-fix
 * behavior — no existing caller's behavior changes unless it opts in.
 *
 * E-1 regression coverage: forceCloseAllPositions minted its own randomUUID()
 * correlationId, discarding the caller's root correlationId. Fixed via
 * opts.correlationId (defaults to a fresh id only when the caller omits one).
 *
 * Test strategy: uses positions with NEITHER currentPrice NOR entryPrice (the
 * GAP-2 "stuck" path) so no closePosition()/transaction machinery needs to be
 * mocked — forceCloseAllPositions registers a stuck-position audit row and a
 * CRITICAL alert per in-scope position WITHOUT touching out-of-scope rows.
 * That is a complete, DB-verifiable proof of the scope filter: a sibling
 * account's position generates ZERO audit rows / alerts / count contribution
 * when it is excluded by scope.
 *
 * Mock scaffolding mirrors m4-force-close-price-unconfirmed.test.ts
 * (established pattern for testing forceCloseAllPositions in isolation).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockBroadcastSSE = vi.fn();
const mockDbInsert = vi.fn();
const mockDbInsertValues = vi.fn().mockResolvedValue([]);
const mockDbUpdate = vi.fn();
const mockDbSelect = vi.fn();
const mockCriticalAlert = vi.fn();

vi.mock("../production/kill-switch.js", () => ({
  killSwitch: { isHaltedForProduction: vi.fn().mockResolvedValue(false) },
}));

vi.mock("../db/index.js", () => ({
  db: { select: mockDbSelect, insert: mockDbInsert, update: mockDbUpdate },
}));

vi.mock("../db/schema.js", () => ({
  paperSessions: { id: "id", firmId: "firmId", config: "config", status: "status" },
  paperPositions: {
    id: "id", sessionId: "sessionId", symbol: "symbol", side: "side", contracts: "contracts",
    entryPrice: "entryPrice", currentPrice: "currentPrice", closedAt: "closedAt", initialStopPrice: "initialStopPrice",
  },
  paperTrades: {},
  strategies: {},
  shadowSignals: {},
  auditLog: { action: "action" },
  macroSnapshots: {},
  skipDecisions: {},
  complianceRulesets: {},
  contractRolls: {},
  brokerAccounts: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => "eq"),
  and: vi.fn((...args) => args),
  isNull: vi.fn(() => "isNull"),
  desc: vi.fn(() => "desc"),
  sql: Object.assign(vi.fn(() => "sql"), { raw: vi.fn() }),
  inArray: vi.fn(() => "inArray"),
}));

const mockSseRouter = Object.assign(vi.fn(), { get: vi.fn(), use: vi.fn(), post: vi.fn() });
vi.mock("../routes/sse.js", () => ({
  broadcastSSE: mockBroadcastSSE,
  sseRoutes: mockSseRouter,
  closeAllSseClients: vi.fn(),
  PAPER_EXIT_EVENTS: {},
}));

vi.mock("../lib/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../lib/tracing.js", () => ({ tracer: { startSpan: vi.fn(() => ({ setAttribute: vi.fn(), setStatus: vi.fn(), end: vi.fn() })) } }));
vi.mock("../lib/db-locks.js", () => ({ withSessionLock: vi.fn((_id, fn) => fn({})) }));
vi.mock("../lib/metrics-registry.js", () => ({ paperTrades: { labels: vi.fn(() => ({ inc: vi.fn() })), inc: vi.fn() } }));
vi.mock("../services/pipeline-control-service.js", () => ({ isActive: vi.fn().mockResolvedValue(true), getMode: vi.fn().mockResolvedValue("ACTIVE") }));
vi.mock("../services/exchange-status-service.js", () => ({ isExchangeHalted: vi.fn(() => false), registerOutageChangeCallback: vi.fn() }));
vi.mock("../services/prop-firm-health-service.js", () => ({ isFirmSuspended: vi.fn(() => false), registerSuspensionChangeCallback: vi.fn() }));
vi.mock("../lib/network-failover.js", () => ({ isConnectivityDegraded: vi.fn(() => false) }));
vi.mock("../../shared/firm-config.js", () => ({
  getFirmAccount: vi.fn(() => ({ dailyLossLimit: 1000, maxContracts: 10 })),
  getTightestDrawdown: vi.fn(() => ({ firm: "topstep", maxDrawdown: 2000 })),
  getCommissionPerSide: vi.fn(() => 0.62),
  CONTRACT_SPECS: {
    MES: { tickSize: 0.25, tickValue: 1.25, pointValue: 5.0 },
    MNQ: { tickSize: 0.25, tickValue: 0.5, pointValue: 2.0 },
    MCL: { tickSize: 0.01, tickValue: 1.0, pointValue: 100.0 },
  },
  DEFAULT_COMMISSION_PER_SIDE: 0.62,
}));
vi.mock("../services/paper-risk-gate.js", () => ({
  toEasternDateString: vi.fn(() => "2026-07-05"),
  toFuturesTradingDayString: vi.fn(() => "2026-07-05"),
  invalidateDailyLossCache: vi.fn(),
}));
vi.mock("../lib/dst-utils.js", () => ({ getEtOffsetMinutes: vi.fn(() => -240) }));
vi.mock("../scheduler.js", () => ({ onPaperTradeClose: vi.fn(), initScheduler: vi.fn(), getSchedulerHealth: vi.fn(() => ({})) }));
vi.mock("../index.js", () => ({}));
vi.mock("../lib/roll-calendar-loader.js", () => ({ computeRollSpreadCost: vi.fn().mockResolvedValue(0) }));
vi.mock("../services/strategy-lockout-service.js", () => ({ writeLockoutFromKillEvent: vi.fn() }));
vi.mock("../services/alert-service.js", () => ({
  AlertFactory: { systemError: vi.fn(), warning: vi.fn(), criticalAlert: mockCriticalAlert },
}));
vi.mock("../lib/credential-loader.js", () => ({ loadCredentials: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../lib/python-runner.js", () => ({ runPythonModule: vi.fn().mockResolvedValue({}) }));

describe("deepscan17 C-1(b): forceCloseAllPositions scope containment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbInsert.mockReturnValue({ values: mockDbInsertValues });
    mockDbUpdate.mockReturnValue({ set: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })) });
  });

  /**
   * 3 open positions, no currentPrice/entryPrice (GAP-2 stuck path — no
   * closePosition() call needed). pos-A1/pos-A2 belong to session s-A
   * (account "acct-A"); pos-B1 belongs to session s-B (account "acct-B").
   */
  function seedThreePositionsTwoAccounts() {
    const openPositions = [
      { id: "pos-A1", sessionId: "s-A", symbol: "MES", side: "long", entryPrice: null, currentPrice: null, initialStopPrice: null },
      { id: "pos-A2", sessionId: "s-A", symbol: "MNQ", side: "short", entryPrice: null, currentPrice: null, initialStopPrice: null },
      { id: "pos-B1", sessionId: "s-B", symbol: "MCL", side: "long", entryPrice: null, currentPrice: null, initialStopPrice: null },
    ];
    const sessions = [
      { id: "s-A", firmId: "topstep", config: { account_key: "acct-A" } },
      { id: "s-B", firmId: "topstep", config: { account_key: "acct-B" } },
    ];

    // Two distinct db.select() call shapes: forceCloseAllPositions's own
    // openPositions query (columns include entryPrice) vs. the accountKey-
    // resolution sessionRows query (columns include config, no entryPrice).
    mockDbSelect.mockImplementation((cols: Record<string, unknown>) => {
      if (cols && "entryPrice" in cols) {
        return { from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(openPositions) }) };
      }
      return { from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(sessions) }) };
    });
  }

  it("unscoped call (system-wide, e.g. operator HALT) still flattens ALL open positions — unchanged default behavior", async () => {
    seedThreePositionsTwoAccounts();
    const { forceCloseAllPositions } = await import("../services/paper-execution-service.js");
    const result = await forceCloseAllPositions("production_halt");

    // No scope → all 3 positions across both accounts are in play (pre-fix parity).
    expect(result.count).toBe(3);
    expect(result.stuck).toBe(3);

    // Every position (both accounts) generated a stuck audit row when unscoped.
    const stuckIds = mockDbInsertValues.mock.calls
      .filter((args) => args[0]?.action === "paper.force_flatten_stuck")
      .map((args) => args[0].entityId);
    expect(stuckIds.sort()).toEqual(["pos-A1", "pos-A2", "pos-B1"]);
  });

  it("scope:{accountKey} flattens ONLY that account's positions — sibling account untouched", async () => {
    seedThreePositionsTwoAccounts();
    const { forceCloseAllPositions } = await import("../services/paper-execution-service.js");
    const result = await forceCloseAllPositions("dll_force_close_at_95pct:acct-A", {
      scope: { accountKey: "acct-A" },
    });

    // Only pos-A1 + pos-A2 (session s-A / account acct-A) are in scope.
    expect(result.count).toBe(2);
    expect(result.stuck).toBe(2);

    const stuckIds = mockDbInsertValues.mock.calls
      .filter((args) => args[0]?.action === "paper.force_flatten_stuck")
      .map((args) => args[0].entityId);
    expect(stuckIds.sort()).toEqual(["pos-A1", "pos-A2"]);
    // pos-B1 (sibling account "acct-B") must be COMPLETELY untouched — no audit
    // row referencing it under ANY action name.
    const anyRowMentioningB1 = mockDbInsertValues.mock.calls.some(
      (args) => args[0]?.entityId === "pos-B1",
    );
    expect(anyRowMentioningB1).toBe(false);

    // The CRITICAL alert (stuck-position escalation) must also never reference pos-B1.
    const alertPositionIds = mockCriticalAlert.mock.calls.map((args) => args[1]?.positionId);
    expect(alertPositionIds).not.toContain("pos-B1");
    expect(alertPositionIds.sort()).toEqual(["pos-A1", "pos-A2"]);
  });

  it("scope:{sessionIds} narrows to an explicit session allowlist (used by the D6 openPosition call site)", async () => {
    seedThreePositionsTwoAccounts();
    const { forceCloseAllPositions } = await import("../services/paper-execution-service.js");
    const result = await forceCloseAllPositions("dll_95_force_close", {
      scope: { sessionIds: ["s-B"] },
    });

    expect(result.count).toBe(1);
    const stuckIds = mockDbInsertValues.mock.calls
      .filter((args) => args[0]?.action === "paper.force_flatten_stuck")
      .map((args) => args[0].entityId);
    expect(stuckIds).toEqual(["pos-B1"]);
  });

  it("scope matching zero sessions closes nothing and writes a clean empty batch row", async () => {
    seedThreePositionsTwoAccounts();
    const { forceCloseAllPositions } = await import("../services/paper-execution-service.js");
    const result = await forceCloseAllPositions("test_no_match", {
      scope: { accountKey: "acct-does-not-exist" },
    });

    expect(result).toEqual({ count: 0, closed: 0, stuck: 0 });
    expect(mockCriticalAlert).not.toHaveBeenCalled();
  });
});

describe("deepscan17 E-1: forceCloseAllPositions threads the caller's correlationId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbInsert.mockReturnValue({ values: mockDbInsertValues });
    mockDbUpdate.mockReturnValue({ set: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })) });
    mockDbSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([
          { id: "pos-1", sessionId: "s-1", symbol: "MES", side: "long", entryPrice: null, currentPrice: null, initialStopPrice: null },
        ]),
      }),
    });
  });

  it("uses the caller-supplied correlationId for the batch audit row instead of minting a fresh one", async () => {
    const { forceCloseAllPositions } = await import("../services/paper-execution-service.js");
    const callerCorrelationId = "root-signal-correlation-abc123";

    await forceCloseAllPositions("cross_symbol_dll_force_close:mffu:0.960", {
      correlationId: callerCorrelationId,
    });

    const batchRow = mockDbInsertValues.mock.calls.find((args) => args[0]?.action === "paper.force_flatten_all");
    expect(batchRow).toBeDefined();
    expect(batchRow![0].correlationId).toBe(callerCorrelationId);

    const stuckRow = mockDbInsertValues.mock.calls.find((args) => args[0]?.action === "paper.force_flatten_stuck");
    expect(stuckRow).toBeDefined();
    expect(stuckRow![0].correlationId).toBe(callerCorrelationId);
  });

  it("mints a fresh correlationId when the caller supplies none (unchanged default behavior)", async () => {
    const { forceCloseAllPositions } = await import("../services/paper-execution-service.js");
    await forceCloseAllPositions("production_halt");

    const batchRow = mockDbInsertValues.mock.calls.find((args) => args[0]?.action === "paper.force_flatten_all");
    expect(batchRow).toBeDefined();
    // UUID v4 shape — proves a real id was generated, not left undefined/null.
    expect(batchRow![0].correlationId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it("two calls with no correlationId each mint DIFFERENT ids (no accidental id sharing across invocations)", async () => {
    const { forceCloseAllPositions } = await import("../services/paper-execution-service.js");
    await forceCloseAllPositions("halt_1");
    const firstBatch = mockDbInsertValues.mock.calls.find((args) => args[0]?.action === "paper.force_flatten_all");
    const firstId = firstBatch![0].correlationId;

    vi.clearAllMocks();
    mockDbInsert.mockReturnValue({ values: mockDbInsertValues });
    mockDbUpdate.mockReturnValue({ set: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })) });
    mockDbSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([
          { id: "pos-2", sessionId: "s-2", symbol: "MES", side: "long", entryPrice: null, currentPrice: null, initialStopPrice: null },
        ]),
      }),
    });

    await forceCloseAllPositions("halt_2");
    const secondBatch = mockDbInsertValues.mock.calls.find((args) => args[0]?.action === "paper.force_flatten_all");
    const secondId = secondBatch![0].correlationId;

    expect(firstId).not.toBe(secondId);
  });
});
