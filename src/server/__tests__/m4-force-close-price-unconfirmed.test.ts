/**
 * m4-force-close-price-unconfirmed.test.ts — MED M-4
 *
 * forceCloseAllPositions falls back to entryPrice as the exit proxy when a
 * position has no currentPrice (mark-to-market). That produces a zero-PnL
 * journal row (entryPrice == exitPrice) which contaminates
 * paper_sessions.finalPnl used in promotion-gate math.
 *
 * M-4 does NOT change the emergency-close behaviour (entryPrice proxy stays the
 * conservative default). It makes the contamination VISIBLE: the proxy close is
 * stamped with `force_close_price_unconfirmed: true` in the
 * paper.force_flatten_fallback_entry_price audit row (and threaded into
 * closePosition so the trade_close audit carries it too) so the promotion gate
 * can DETECT and exclude/flag the affected session.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockBroadcastSSE = vi.fn();
const mockDbInsert = vi.fn();
const mockDbInsertValues = vi.fn().mockResolvedValue([]);
const mockDbUpdate = vi.fn();
const mockDbSelect = vi.fn();

vi.mock("../production/kill-switch.js", () => ({
  killSwitch: { isHaltedForProduction: vi.fn().mockResolvedValue(false) },
}));

vi.mock("../db/index.js", () => ({
  db: { select: mockDbSelect, insert: mockDbInsert, update: mockDbUpdate },
}));

vi.mock("../db/schema.js", () => ({
  paperSessions: { id: "id", firmId: "firmId", status: "status" },
  paperPositions: { id: "id", sessionId: "sessionId", symbol: "symbol", side: "side", contracts: "contracts", entryPrice: "entryPrice", currentPrice: "currentPrice", closedAt: "closedAt" },
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

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../lib/tracing.js", () => ({
  tracer: { startSpan: vi.fn(() => ({ setAttribute: vi.fn(), setStatus: vi.fn(), end: vi.fn() })) },
}));
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
  toEasternDateString: vi.fn(() => "2026-05-09"),
  toFuturesTradingDayString: vi.fn(() => "2026-05-09"),
  invalidateDailyLossCache: vi.fn(),
}));
vi.mock("../lib/dst-utils.js", () => ({ getEtOffsetMinutes: vi.fn(() => -240) }));
vi.mock("../scheduler.js", () => ({ onPaperTradeClose: vi.fn(), initScheduler: vi.fn(), getSchedulerHealth: vi.fn(() => ({})) }));
vi.mock("../index.js", () => ({}));
vi.mock("../lib/roll-calendar-loader.js", () => ({ computeRollSpreadCost: vi.fn().mockResolvedValue(0) }));
vi.mock("../services/strategy-lockout-service.js", () => ({ writeLockoutFromKillEvent: vi.fn() }));
vi.mock("../services/alert-service.js", () => ({ AlertFactory: { systemError: vi.fn(), warning: vi.fn(), criticalAlert: vi.fn() } }));
vi.mock("../lib/credential-loader.js", () => ({ loadCredentials: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../lib/python-runner.js", () => ({ runPythonModule: vi.fn().mockResolvedValue({}) }));

describe("forceCloseAllPositions: entryPrice-proxy contamination flag (M-4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbInsert.mockReturnValue({ values: mockDbInsertValues });
    mockDbUpdate.mockReturnValue({ set: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })) });
  });

  it("stamps force_close_price_unconfirmed=true on the entryPrice fallback audit row", async () => {
    // Position has entryPrice but NO currentPrice → rawCurrent=0 → entryPrice proxy path.
    const openPos = [
      { id: "pos-1", sessionId: "sess-1", symbol: "MES", side: "long", entryPrice: "5000", currentPrice: null },
    ];
    mockDbSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(openPos) }),
    });

    const { forceCloseAllPositions } = await import("../services/paper-execution-service.js");
    await forceCloseAllPositions("production_halt");

    const fallbackAudit = mockDbInsertValues.mock.calls.find(
      (args) => args[0] && args[0].action === "paper.force_flatten_fallback_entry_price",
    );
    expect(fallbackAudit).toBeDefined();
    expect(fallbackAudit![0].result).toMatchObject({
      reason: "no_current_price_fallback_to_entry",
      pnl_impact: 0,
      force_close_price_unconfirmed: true,
    });
  });

  it("does NOT stamp the flag when currentPrice is present (real mark-to-market close)", async () => {
    // Position WITH currentPrice → mark-to-market path → no contamination flag.
    const openPos = [
      { id: "pos-2", sessionId: "sess-2", symbol: "MES", side: "long", entryPrice: "5000", currentPrice: "5010" },
    ];
    mockDbSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(openPos) }),
    });

    const { forceCloseAllPositions } = await import("../services/paper-execution-service.js");
    await forceCloseAllPositions("production_halt");

    const fallbackAudit = mockDbInsertValues.mock.calls.find(
      (args) => args[0] && args[0].action === "paper.force_flatten_fallback_entry_price",
    );
    // Mark-to-market path must not write the entryPrice-fallback audit at all.
    expect(fallbackAudit).toBeUndefined();
  });
});
