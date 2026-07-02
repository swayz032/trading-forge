/**
 * paper-execution-service-deepscan-findings.test.ts
 *
 * Tests for deepscan audit findings F4, F5, F6, F7 in paper-execution-service.ts.
 *
 * F4: bookPartialClose + openPosition must thread rolling medianAtr14 instead
 *     of the constant 0.85× ATR estimate for entry/exit slippage parity.
 * F5: forceCloseAllPositions must pass derived ATR (from initialStopPrice) to
 *     closePosition so forced-exit slippage is ATR-scaled, not base-tick only.
 * F6: recoverOrphanedPositionsAtStartup() must add sessions with open positions
 *     that have no active session to stuckSessionIds + write audit rows.
 * F7: openPosition must never produce null initialStopPrice — fall back to
 *     tickSize × 16 structural stop when ATR is absent.
 *
 * F4, F5, F7 use source-code analysis (structural assertions). F6 uses a
 * lightweight behavioral test via mocked db.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(
  resolve(__dirname, "../services/paper-execution-service.ts"),
  "utf-8",
);

// ─── Finding 4: medianAtr14 threading ────────────────────────────────────────

describe("F4 — medianAtr14 threading for entry/exit slippage parity", () => {
  it("openPosition params includes medianAtr14 optional field", () => {
    expect(SRC).toContain("medianAtr14?: number;");
  });

  it("openPosition uses params.medianAtr14 ?? fallback for medianAtrEstimate (not hardcoded 0.85)", () => {
    expect(SRC).toContain("params.medianAtr14 ?? (params.atr ? params.atr * 0.85 : undefined)");
  });

  it("bookPartialClose signature includes medianAtr14 parameter", () => {
    const fnIdx = SRC.indexOf("async function bookPartialClose(");
    expect(fnIdx).toBeGreaterThan(-1);
    // The signature spans several lines and includes a multi-line comment; check 700 chars
    const sig = SRC.slice(fnIdx, fnIdx + 700);
    expect(sig).toContain("medianAtr14?:");
  });

  it("bookPartialClose uses medianAtr14 ?? fallback for medianAtrEstimate (not hardcoded 0.85)", () => {
    // The fix replaces `atr ? atr * 0.85 : undefined` with `medianAtr14 ?? (...)`
    const fnIdx = SRC.indexOf("async function bookPartialClose(");
    const nextFnIdx = SRC.indexOf("\nasync function", fnIdx + 1);
    const body = SRC.slice(fnIdx, nextFnIdx > 0 ? nextFnIdx : fnIdx + 3000);
    expect(body).toContain("medianAtr14 ?? (atr ? atr * 0.85 : undefined)");
  });

  it("TP1 bookPartialClose call passes medianAtr as 7th argument", () => {
    // Deep-scan #5 (2026-06-29): the call gained an 8th positionStateUpdate arg (atomic
    // state advance). medianAtr is still threaded as the 7th arg (FINDING #4 intact).
    expect(SRC).toContain('bookPartialClose(pos, contractsToClose, currentPrice, "tp1", atr, correlationId, medianAtr, {');
  });

  it("TP2 bookPartialClose call passes medianAtr as 7th argument", () => {
    expect(SRC).toContain('bookPartialClose(pos, contractsToClose, currentPrice, "tp2", atr, correlationId, medianAtr, {');
  });
});

// ─── Finding 5: forceCloseAllPositions ATR threading ─────────────────────────

describe("F5 — forceCloseAllPositions must pass derived ATR to closePosition", () => {
  it("selects initialStopPrice in the forceCloseAllPositions query", () => {
    expect(SRC).toContain("initialStopPrice: paperPositions.initialStopPrice,");
  });

  it("derives atr from initialStopPrice and entryPrice (stop = entry ± atr×2.0)", () => {
    expect(SRC).toContain("const derivedAtr = (() => {");
    expect(SRC).toContain("Math.abs(entryNum - stopNum) / 2.0");
  });

  it("passes derivedAtr (not undefined) to closePosition for the currentPrice path", () => {
    expect(SRC).toContain("await closePosition(pos.id, rawCurrent, derivedAtr,");
  });

  it("passes derivedAtr (not undefined) to closePosition for the entryPrice fallback path", () => {
    expect(SRC).toContain("await closePosition(pos.id, rawEntry, derivedAtr,");
  });

  it("returns undefined when initialStopPrice is null (legacy positions)", () => {
    // derivedAtr IIFE must handle the null-stop case gracefully
    const derivedIdx = SRC.indexOf("const derivedAtr = (() => {");
    expect(derivedIdx).toBeGreaterThan(-1);
    const body = SRC.slice(derivedIdx, derivedIdx + 400);
    expect(body).toContain("return undefined");
  });
});

// ─── Finding 7: initialStopPrice invariant ───────────────────────────────────

describe("F7 — initialStopPrice must never be null for a live position", () => {
  it("initialStopPriceForInsert is typed as number (not number | null)", () => {
    expect(SRC).toContain("const initialStopPriceForInsert: number = (() => {");
  });

  it("has a tickSize×16 fallback when neither adaptiveExitInput nor atr is available", () => {
    const iife = SRC.indexOf("const initialStopPriceForInsert: number = (() => {");
    expect(iife).toBeGreaterThan(-1);
    const body = SRC.slice(iife, iife + 1200);
    expect(body).toContain("tickSize ?? 0.25) * 16");
  });

  it("logs a warn when the tickSize fallback is used (not a silent default)", () => {
    const iife = SRC.indexOf("const initialStopPriceForInsert: number = (() => {");
    const body = SRC.slice(iife, iife + 1200);
    expect(body).toContain("logger.warn");
  });

  it("does NOT return null from the initialStopPrice IIFE", () => {
    const iife = SRC.indexOf("const initialStopPriceForInsert: number = (() => {");
    const closeBrace = SRC.indexOf("})();", iife);
    const body = SRC.slice(iife, closeBrace + 5);
    // Must not have a bare `return null` anywhere in the IIFE
    expect(body).not.toContain("return null;");
  });

  it("inserts initialStopPrice as String(initialStopPriceForInsert) without null conditional", () => {
    // Old code: `initialStopPriceForInsert != null ? String(...)  : null`
    // New code: `String(initialStopPriceForInsert)` — unconditional
    expect(SRC).toContain("initialStopPrice: String(initialStopPriceForInsert),");
    expect(SRC).not.toContain("initialStopPriceForInsert != null ? String(initialStopPriceForInsert) : null");
  });
});

// ─── Finding 6: Startup orphan-position recovery sweep (behavioral) ──────────

const mockDbSelect = vi.fn();
const mockDbInsert = vi.fn();
const insertValues = vi.fn().mockReturnValue({ catch: vi.fn() });
const mockDbUpdate = vi.fn();

vi.mock("../db/index.js", () => ({
  db: {
    select: mockDbSelect,
    insert: mockDbInsert,
    update: mockDbUpdate,
  },
}));

vi.mock("../db/schema.js", () => ({
  paperSessions:   { id: "id", status: "status", firmId: "firmId" },
  paperPositions:  {
    id: "id", sessionId: "sessionId", symbol: "symbol", side: "side",
    entryPrice: "entryPrice", currentPrice: "currentPrice",
    closedAt: "closedAt", initialStopPrice: "initialStopPrice",
  },
  paperTrades:          {},
  strategies:           {},
  shadowSignals:        {},
  auditLog:             { action: "action" },
  macroSnapshots:       {},
  skipDecisions:        {},
  complianceRulesets:   {},
  contractRolls:        {},
  brokerAccounts:       {},
}));

vi.mock("drizzle-orm", () => ({
  eq:       vi.fn((_a, _b) => "eq"),
  and:      vi.fn((...args: unknown[]) => args),
  isNull:   vi.fn(() => "isNull"),
  desc:     vi.fn(() => "desc"),
  sql:      Object.assign(vi.fn(() => "sql"), { raw: vi.fn() }),
  inArray:  vi.fn(() => "inArray"),
  isNotNull:vi.fn(() => "isNotNull"),
  gte:      vi.fn(() => "gte"),
  lte:      vi.fn(() => "lte"),
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
  withSessionLock: vi.fn((_id: string, fn: () => unknown) => fn()),
}));

vi.mock("../lib/metrics-registry.js", () => ({
  paperTrades:          { inc: vi.fn() },
  paperTradesCounter:   { labels: vi.fn().mockReturnValue({ inc: vi.fn() }) },
  shadowSignalsTotal:   { inc: vi.fn() },
}));

vi.mock("../services/pipeline-control-service.js", () => ({
  isActive:  vi.fn().mockResolvedValue(true),
  getMode:   vi.fn().mockResolvedValue("ACTIVE"),
}));

vi.mock("../services/exchange-status-service.js", () => ({
  isExchangeHalted:              vi.fn().mockReturnValue(false),
  registerOutageChangeCallback:  vi.fn(),
}));

vi.mock("../services/prop-firm-health-service.js", () => ({
  isFirmSuspended:               vi.fn().mockReturnValue(false),
  registerSuspensionChangeCallback: vi.fn(),
}));

vi.mock("../lib/network-failover.js", () => ({
  isConnectivityDegraded: vi.fn().mockReturnValue(false),
}));

vi.mock("../production/kill-switch.js", () => ({
  killSwitch: { isHaltedForProduction: vi.fn().mockResolvedValue(false) },
}));

vi.mock("../../shared/firm-config.js", () => ({
  getFirmAccount:   vi.fn(() => ({ dailyLossLimit: 1000, maxContracts: 10, maxDailyDrawdown: 2000 })),
  getTightestDrawdown: vi.fn(() => ({ firm: "topstep", maxDrawdown: 2000 })),
  getAllFirms:       vi.fn(() => []),
  getFirmLimit:     vi.fn(() => 10),
  getBufferAmount:  vi.fn(() => 0),
  getCommissionPerSide:        vi.fn(() => 0.62),
  getCommissionPerSideBySymbol: vi.fn(() => 0.62),
  CONTRACT_CAP_MAX: 20,
  CONTRACT_CAP_MIN: 1,
  DEFAULT_ACCOUNT_SIZE: 50000,
  DEFAULT_ACCOUNT_TYPE: "50k",
  DEFAULT_COMMISSION_PER_SIDE: 0.62,
  CONTRACT_SPECS: {
    MES: { tickSize: 0.25, tickValue: 1.25, pointValue: 5.00 },
    MNQ: { tickSize: 0.25, tickValue: 0.50, pointValue: 2.00 },
    MCL: { tickSize: 0.01, tickValue: 1.00, pointValue: 100.00 },
  },
  LIQUIDITY_COMFORT_CAPS: {},
  LIQUIDITY_COMFORT_CAP_DEFAULT: 20,
  TOPSTEP_TRAILING_DD_BY_SIZE: {},
  FIRMS: {},
  getMacroBlackoutMode:  vi.fn(() => "allow"),
}));

vi.mock("../services/paper-risk-gate.js", () => ({
  toEasternDateString:      vi.fn(() => "2026-06-28"),
  toFuturesTradingDayString: vi.fn(() => "2026-06-28"),
  invalidateDailyLossCache:  vi.fn(),
}));

vi.mock("../lib/dst-utils.js", () => ({
  getEtOffsetMinutes: vi.fn(() => -240),
}));

vi.mock("../scheduler.js", () => ({
  onPaperTradeClose:   vi.fn(),
  initScheduler:       vi.fn(),
  getSchedulerHealth:  vi.fn().mockReturnValue({}),
}));

vi.mock("../index.js", () => ({}));

vi.mock("../lib/roll-calendar-loader.js", () => ({
  computeRollSpreadCost: vi.fn().mockResolvedValue(0),
}));

vi.mock("../services/strategy-lockout-service.js", () => ({
  writeLockoutFromKillEvent: vi.fn(),
}));

vi.mock("../services/alert-service.js", () => ({
  AlertFactory: { systemError: vi.fn(), warning: vi.fn(), criticalAlert: vi.fn() },
}));

vi.mock("../lib/credential-loader.js", () => ({
  loadCredentials: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/python-runner.js", () => ({
  runPythonModule: vi.fn().mockResolvedValue({ is_holiday: false }),
}));

vi.mock("../services/server-mediated-executor.js", () => ({}));

vi.mock("../lib/slippage-model.js", () => ({
  calculateSlippage:    vi.fn().mockReturnValue(0.25),
  applyLatency:         vi.fn((price: number) => price),
  calculateFillProbability: vi.fn().mockReturnValue(0.95),
}));

vi.mock("../lib/session-classifier.js", () => ({
  classifySessionType: vi.fn().mockReturnValue("RTH"),
}));

const mockRoutes = Object.assign(vi.fn(), { get: vi.fn(), use: vi.fn(), post: vi.fn() });
vi.mock("../routes/sse.js", () => ({
  broadcastSSE:     vi.fn(),
  sseRoutes:        mockRoutes,
  closeAllSseClients: vi.fn(),
  PAPER_EXIT_EVENTS: {
    TP1_FILLED:          "paper:exit:tp1_filled",
    TP2_FILLED:          "paper:exit:tp2_filled",
    BE_STOP_MOVED:       "paper:exit:be_stop_moved",
    TRAIL_TIGHTENED:     "paper:exit:trail_tightened",
    TIME_STOP_FLATTENED: "paper:exit:time_stop_flattened",
    HANDLER_ERROR:       "paper:exit:handler_error",
  },
}));

function makeSelectChain(rows: unknown[]) {
  // where() must be mockResolvedValue (the function awaits `.where(...)` directly)
  const where = vi.fn().mockResolvedValue(rows);
  return { from: vi.fn().mockReturnValue({ where, limit: vi.fn().mockResolvedValue(rows) }) };
}

describe("F6 — recoverOrphanedPositionsAtStartup: orphan detection + stuckSessionIds + audit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbInsert.mockReturnValue({ values: insertValues });
  });

  it("returns orphansFound=0 when all open positions have active sessions", async () => {
    const SESSION_A = "session-a";
    // db.select call 1: open positions (one open position in session-a)
    // db.select call 2: active sessions (session-a is active)
    mockDbSelect
      .mockReturnValueOnce(makeSelectChain([
        { id: "pos-1", sessionId: SESSION_A, symbol: "MES", side: "long" },
      ]))
      .mockReturnValueOnce(makeSelectChain([
        { id: SESSION_A },
      ]));

    const { recoverOrphanedPositionsAtStartup } = await import("../services/paper-execution-service.js");
    const result = await recoverOrphanedPositionsAtStartup();

    expect(result.orphansFound).toBe(0);
    // No audit row for orphan detection
    expect(insertValues).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: "paper.orphaned_position_detected" })
    );
  });

  it("returns orphansFound=1 when an open position has no active session", async () => {
    const SESSION_DEAD = "session-dead";
    const SESSION_LIVE = "session-live";
    // Open positions: one in a dead session, one in the live session
    mockDbSelect
      .mockReturnValueOnce(makeSelectChain([
        { id: "pos-orphan", sessionId: SESSION_DEAD, symbol: "MES",  side: "long" },
        { id: "pos-live",   sessionId: SESSION_LIVE, symbol: "MNQ",  side: "short" },
      ]))
      .mockReturnValueOnce(makeSelectChain([
        { id: SESSION_LIVE },
      ]));

    const { recoverOrphanedPositionsAtStartup, clearStuckSessionId } = await import("../services/paper-execution-service.js");
    // Pre-clear to isolate from prior test runs
    clearStuckSessionId(SESSION_DEAD);

    const result = await recoverOrphanedPositionsAtStartup();

    expect(result.orphansFound).toBe(1);
    // audit row must have been written for the orphaned position
    const auditCall = insertValues.mock.calls.find((args: unknown[]) =>
      (args[0] as Record<string, unknown>)?.action === "paper.orphaned_position_detected"
    );
    expect(auditCall).toBeDefined();
  });

  it("returns orphansFound=2 when two open positions have different dead sessions", async () => {
    const SESSION_A = "session-dead-a";
    const SESSION_B = "session-dead-b";
    mockDbSelect
      .mockReturnValueOnce(makeSelectChain([
        { id: "pos-1", sessionId: SESSION_A, symbol: "MES", side: "long" },
        { id: "pos-2", sessionId: SESSION_B, symbol: "MCL", side: "short" },
      ]))
      .mockReturnValueOnce(makeSelectChain([])); // no active sessions

    const { recoverOrphanedPositionsAtStartup, clearStuckSessionId } = await import("../services/paper-execution-service.js");
    clearStuckSessionId(SESSION_A);
    clearStuckSessionId(SESSION_B);

    const result = await recoverOrphanedPositionsAtStartup();

    expect(result.orphansFound).toBe(2);
    const orphanAuditCalls = insertValues.mock.calls.filter((args: unknown[]) =>
      (args[0] as Record<string, unknown>)?.action === "paper.orphaned_position_detected"
    );
    expect(orphanAuditCalls).toHaveLength(2);
  });

  it("returns orphansFound=0 when there are no open positions at all", async () => {
    mockDbSelect
      .mockReturnValueOnce(makeSelectChain([]))
      .mockReturnValueOnce(makeSelectChain([]));

    const { recoverOrphanedPositionsAtStartup } = await import("../services/paper-execution-service.js");
    const result = await recoverOrphanedPositionsAtStartup();

    expect(result.orphansFound).toBe(0);
  });

  it("returns orphansFound=0 on DB error (fail-open during boot)", async () => {
    mockDbSelect.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockRejectedValue(new Error("db_timeout")),
        limit: vi.fn().mockRejectedValue(new Error("db_timeout")),
      }),
    });

    const { recoverOrphanedPositionsAtStartup } = await import("../services/paper-execution-service.js");
    // Must not throw — fail-open during boot
    const result = await recoverOrphanedPositionsAtStartup();
    expect(result.orphansFound).toBe(0);
  });
});
