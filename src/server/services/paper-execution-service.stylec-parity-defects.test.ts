/**
 * Style C parity defect regression tests (Defects 3 and 4).
 *
 * These tests ensure that callExitHandler() (invoked through updatePositionPrices)
 * passes correct values to the Python subprocess — specifically:
 *
 *   Defect 3 — stop_pts must use the persisted initialStopPrice (not dynamic atr14×2)
 *     so TP1/TP2 targets stay anchored at the same R-multiples as the backtester.
 *
 *   Defect 4 — current_price for Style C must be the INTRABAR FAVORABLE EXTREME
 *     (barHigh for longs, barLow for shorts), not bar.close.  This matches
 *     backtester.py which tests bar.high >= tp_price / bar.low <= tp_price.
 *
 * Style D current_price is left as bar.close (unchanged — Style D uses HWM trail,
 * not TP checks against the bar extreme).
 *
 * Mock infrastructure is copied from paper-execution-style-exit-integration.test.ts
 * to keep isolation boundaries identical — tests in this file must not interfere
 * with that file's selectQueue state.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Shared state ─────────────────────────────────────────────────────────────

const capturedAuditInserts: unknown[] = [];
const capturedPositionUpdates: unknown[] = [];

let mockRunPythonModuleImpl: (...args: unknown[]) => Promise<unknown> =
  () => Promise.resolve({ decision: "HOLD", new_stop: null, evidence: {}, handler_version: "style_c_v1.0.0" });

const mockRunPythonModule = vi.fn((...args: unknown[]) => mockRunPythonModuleImpl(...args));

let selectQueue: Array<unknown[]> = [];
let selectCallIndex = 0;

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../db/index.js", () => {
  function makeChain(): Record<string, unknown> {
    let resolveP: (v: unknown) => void = () => {};
    const p = new Promise<unknown>((r) => { resolveP = r; });

    function settle() {
      const entry = selectQueue[selectCallIndex];
      selectCallIndex++;
      resolveP(entry ?? []);
    }

    const chain: Record<string, unknown> = {
      then: (onFulfilled: unknown, onRejected: unknown) => {
        settle();
        return (p as Promise<unknown>).then(
          onFulfilled as (v: unknown) => unknown,
          onRejected as (e: unknown) => unknown,
        );
      },
      catch: (onRejected: unknown) => {
        settle();
        return (p as Promise<unknown>).catch(onRejected as (e: unknown) => unknown);
      },
      finally: (onFinally: unknown) => {
        settle();
        return (p as Promise<unknown>).finally(onFinally as () => unknown);
      },
    };

    const chainFn = () => chain;
    chain.from = chainFn;
    chain.where = chainFn;
    chain.limit = chainFn;
    chain.orderBy = chainFn;
    chain.returning = chainFn;
    chain.values = () => ({ catch: () => {} });
    return chain;
  }

  return {
    db: {
      select: vi.fn(makeChain),
      insert: vi.fn(() => ({
        values: vi.fn((vals: unknown) => {
          capturedAuditInserts.push(vals);
          return { catch: vi.fn() };
        }),
      })),
      update: vi.fn(() => ({
        set: vi.fn((vals: Record<string, unknown>) => {
          capturedPositionUpdates.push({ ...vals });
          // HIGH#1 (fresh-scan-3): guarded MTM UPDATE calls .where(...).returning({id});
          // non-empty array = row matched = delta applies (preserves pre-guard behavior).
          const p: any = Promise.resolve(undefined);
          p.returning = vi.fn().mockResolvedValue([{ id: "pos-mtm" }]);
          return { where: vi.fn().mockReturnValue(p) };
        }),
      })),
      transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({
        select: vi.fn(makeChain),
        insert: vi.fn(() => ({ values: vi.fn(() => ({ catch: vi.fn() })) })),
        update: vi.fn(() => ({ set: vi.fn(() => { const p: any = Promise.resolve(undefined); p.returning = vi.fn().mockResolvedValue([{ id: "pos-mtm" }]); return { where: vi.fn().mockReturnValue(p) }; }) })),
      })),
    },
  };
});

vi.mock("../routes/sse.js", () => ({
  broadcastSSE: vi.fn(),
  PAPER_EXIT_EVENTS: {
    TP1_FILLED:          "paper:exit:tp1_filled",
    TP2_FILLED:          "paper:exit:tp2_filled",
    BE_STOP_MOVED:       "paper:exit:be_stop_moved",
    TRAIL_TIGHTENED:     "paper:exit:trail_tightened",
    TIME_STOP_FLATTENED: "paper:exit:time_stop_flattened",
    HANDLER_ERROR:       "paper:exit:handler_error",
  },
}));

vi.mock("../lib/python-runner.js", () => ({
  runPythonModule: (...args: unknown[]) => mockRunPythonModule(...args),
}));

vi.mock("./pipeline-control-service.js", () => ({
  isActive: vi.fn(() => true),
}));

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
  toEasternDateString: vi.fn().mockReturnValue("2026-06-28"),
  toFuturesTradingDayString: vi.fn().mockReturnValue("2026-06-28"),
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

vi.mock("../lib/dst-utils.js", () => ({
  getEtOffsetMinutes: vi.fn().mockReturnValue(-240),
  isUsDst: vi.fn().mockReturnValue(false),
}));

vi.mock("../lib/db-locks.js", () => ({
  withSessionLock: vi.fn(async (_: unknown, fn: () => unknown) => fn()),
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

import { updatePositionPrices, type StyleExitBarContext } from "./paper-execution-service.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildStyleCLongPosition(overrides: Record<string, unknown> = {}) {
  return {
    id: "pos-c-001",
    sessionId: "sess-parity-001",
    symbol: "MES",
    side: "long",
    entryPrice: "4500",
    currentPrice: "4508",      // bar close — well below TP1 at +1R
    contracts: 3,              // divisible by 3 for Style C
    unrealizedPnl: "40",
    previousUnrealizedPnl: "0",
    mae: null,
    mfe: null,
    fillRatio: "1.0",
    trailHwm: null,
    closedAt: null,
    currentExitStyle: "C",     // forces style_c_handler routing
    tp1Filled: false,
    tp2Filled: false,
    beStopApplied: false,
    currentTrailMethod: null,
    lastHandlerEvalAt: null,
    initialStopPrice: null,    // default: null → atr-fallback
    ...overrides,
  };
}

function buildStyleDLongPosition(overrides: Record<string, unknown> = {}) {
  return {
    ...buildStyleCLongPosition(overrides),
    id: "pos-d-001",
    currentExitStyle: "D",
    ...overrides,
  };
}

/** Build a barCtx with barHigh/barLow populated (required for Defect 4 tests). */
function buildBarCtx(overrides: Partial<StyleExitBarContext> = {}): StyleExitBarContext {
  return {
    currentTimeEt: "10:30",
    atr14: { MES: 5.0 },  // atr14 × 2 = 10pt fallback stop
    barHigh: { MES: 4510.0 },  // current bar high  (above bar close 4508)
    barLow:  { MES: 4503.0 },  // current bar low   (below bar close 4508)
    ...overrides,
  };
}

// ─── Reset between tests ──────────────────────────────────────────────────────

beforeEach(() => {
  selectQueue = [];
  selectCallIndex = 0;
  capturedAuditInserts.length = 0;
  capturedPositionUpdates.length = 0;
  mockRunPythonModuleImpl = () => Promise.resolve({
    decision: "HOLD",
    new_stop: null,
    evidence: {},
    handler_version: "style_c_v1.0.0",
  });
  vi.clearAllMocks();
});

// ─── Defect 3 — stop_pts uses initialStopPrice ────────────────────────────────

describe("Defect 3: stop_pts uses persisted initialStopPrice, not dynamic ATR", () => {

  it("D3-A: initialStopPrice set → stop_pts = |entryPrice - initialStopPrice|, not atr14×2", async () => {
    // entry = 4500, stop = 4490 → stop_pts = 10pt
    // atr14 = 5.0 → atr fallback would give stop_pts = 10pt (same here)
    // Test with a stop that would differ from atr×2 to distinguish the paths:
    //   initialStopPrice = 4492 → stop_pts = 8 (vs atr×2 = 10)
    const pos = buildStyleCLongPosition({ initialStopPrice: "4492" });
    selectQueue = [
      [pos],                              // openPositions query
      [{ strategyId: "strat-parity" }],  // getSessionStrategyId query
    ];

    let capturedConfig: Record<string, unknown> | null = null;
    mockRunPythonModuleImpl = (...args: unknown[]) => {
      capturedConfig = (args[0] as { config: Record<string, unknown> }).config;
      return Promise.resolve({ decision: "HOLD", new_stop: null, evidence: {}, handler_version: "style_c_v1.0.0" });
    };

    await updatePositionPrices(
      "sess-parity-001",
      { MES: { close: 4508, high: 4510, low: 4503 } },
      buildBarCtx(),
    );

    expect(mockRunPythonModule).toHaveBeenCalledTimes(1);
    const state = (capturedConfig as unknown as { state: Record<string, unknown> }).state;

    // stop_pts must be |4500 - 4492| = 8, NOT 5.0 × 2 = 10
    expect(state.stop_pts).toBeCloseTo(8.0, 4);
    // Sanity: atr fallback would be 10 — verify we're NOT using it
    expect(state.stop_pts).not.toBeCloseTo(10.0, 1);
  });

  it("D3-B: initialStopPrice null → stop_pts fallback = atr14 × 2", async () => {
    const pos = buildStyleCLongPosition({ initialStopPrice: null });
    selectQueue = [
      [pos],
      [{ strategyId: "strat-parity" }],
    ];

    let capturedConfig: Record<string, unknown> | null = null;
    mockRunPythonModuleImpl = (...args: unknown[]) => {
      capturedConfig = (args[0] as { config: Record<string, unknown> }).config;
      return Promise.resolve({ decision: "HOLD", new_stop: null, evidence: {}, handler_version: "style_c_v1.0.0" });
    };

    // atr14 = 5.0 → fallback stop_pts = 5.0 × 2 = 10
    await updatePositionPrices(
      "sess-parity-001",
      { MES: { close: 4508, high: 4510, low: 4503 } },
      buildBarCtx({ atr14: { MES: 5.0 } }),
    );

    expect(mockRunPythonModule).toHaveBeenCalledTimes(1);
    const state = (capturedConfig as unknown as { state: Record<string, unknown> }).state;
    // Fallback: atr14 × 2 = 10
    expect(state.stop_pts).toBeCloseTo(10.0, 4);
  });

  it("D3-C: initialStopPrice for short → |entryPrice - initialStopPrice| is symmetric", async () => {
    // Short entry = 4500, stop = 4510 → stop_pts = 10
    // atr14 = 5 → fallback would also give 10 — use stop=4512 to distinguish
    const pos = buildStyleDLongPosition({
      id: "pos-short-001",
      side: "short",
      entryPrice: "4500",
      currentPrice: "4495",
      currentExitStyle: "C",
      initialStopPrice: "4512",  // stop_pts = |4500 - 4512| = 12
    });
    selectQueue = [[pos], [{ strategyId: "strat-parity" }]];

    let capturedState: Record<string, unknown> | null = null;
    mockRunPythonModuleImpl = (...args: unknown[]) => {
      capturedState = ((args[0] as { config: Record<string, unknown> }).config.state as Record<string, unknown>);
      return Promise.resolve({ decision: "HOLD", new_stop: null, evidence: {}, handler_version: "style_c_v1.0.0" });
    };

    await updatePositionPrices(
      "sess-parity-001",
      { MES: { close: 4495, high: 4498, low: 4490 } },
      buildBarCtx({ barLow: { MES: 4490 }, barHigh: { MES: 4498 } }),
    );

    expect(mockRunPythonModule).toHaveBeenCalledTimes(1);
    expect(capturedState!.stop_pts).toBeCloseTo(12.0, 4);
  });
});

// ─── Defect 4 — TP detection uses intrabar favorable extreme ──────────────────

describe("Defect 4: Style C current_price = intrabar favorable extreme, not bar.close", () => {

  it("D4-A: long position — current_price = barHigh (not bar.close)", async () => {
    // bar.close = 4508, bar.high = 4510 → Python must receive 4510
    const pos = buildStyleCLongPosition({ initialStopPrice: "4490" });
    selectQueue = [[pos], [{ strategyId: "strat-parity" }]];

    let capturedState: Record<string, unknown> | null = null;
    mockRunPythonModuleImpl = (...args: unknown[]) => {
      capturedState = ((args[0] as { config: Record<string, unknown> }).config.state as Record<string, unknown>);
      return Promise.resolve({ decision: "HOLD", new_stop: null, evidence: {}, handler_version: "style_c_v1.0.0" });
    };

    await updatePositionPrices(
      "sess-parity-001",
      { MES: { close: 4508, high: 4510, low: 4503 } },
      buildBarCtx({ barHigh: { MES: 4510 }, barLow: { MES: 4503 } }),
    );

    expect(mockRunPythonModule).toHaveBeenCalledTimes(1);
    // current_price must be barHigh (4510), NOT bar.close (4508)
    expect(capturedState!.current_price).toBeCloseTo(4510.0, 1);
    expect(capturedState!.current_price).not.toBeCloseTo(4508.0, 0);
  });

  it("D4-B: short position — current_price = barLow (not bar.close)", async () => {
    const pos = buildStyleCLongPosition({
      id: "pos-c-short-001",
      side: "short",
      entryPrice: "4500",
      currentPrice: "4495",
      initialStopPrice: "4510",
    });
    selectQueue = [[pos], [{ strategyId: "strat-parity" }]];

    let capturedState: Record<string, unknown> | null = null;
    mockRunPythonModuleImpl = (...args: unknown[]) => {
      capturedState = ((args[0] as { config: Record<string, unknown> }).config.state as Record<string, unknown>);
      return Promise.resolve({ decision: "HOLD", new_stop: null, evidence: {}, handler_version: "style_c_v1.0.0" });
    };

    // bar.close = 4495, bar.low = 4488 → Python must receive 4488
    await updatePositionPrices(
      "sess-parity-001",
      { MES: { close: 4495, high: 4497, low: 4488 } },
      buildBarCtx({ barHigh: { MES: 4497 }, barLow: { MES: 4488 } }),
    );

    expect(mockRunPythonModule).toHaveBeenCalledTimes(1);
    // current_price must be barLow (4488), NOT bar.close (4495)
    expect(capturedState!.current_price).toBeCloseTo(4488.0, 1);
    expect(capturedState!.current_price).not.toBeCloseTo(4495.0, 0);
  });

  it("D4-C: Style D long — current_price = bar.close (unchanged behavior)", async () => {
    // Style D is unchanged — current_price is still bar.close (currentPrice field)
    const pos = buildStyleDLongPosition({ currentPrice: "4508", initialStopPrice: "4490" });
    selectQueue = [[pos], [{ strategyId: "strat-parity" }]];

    let capturedState: Record<string, unknown> | null = null;
    mockRunPythonModuleImpl = (...args: unknown[]) => {
      capturedState = ((args[0] as { config: Record<string, unknown> }).config.state as Record<string, unknown>);
      return Promise.resolve({ decision: "HOLD", new_stop: null, evidence: {}, handler_version: "style_d_v1.0.0" });
    };

    // bar.high = 4510 but Style D must receive bar.close = 4508
    await updatePositionPrices(
      "sess-parity-001",
      { MES: { close: 4508, high: 4510, low: 4503 } },
      buildBarCtx({ barHigh: { MES: 4510 }, barLow: { MES: 4503 } }),
    );

    expect(mockRunPythonModule).toHaveBeenCalledTimes(1);
    // Style D: current_price must be close (4508), NOT barHigh (4510)
    expect(capturedState!.current_price).toBeCloseTo(4508.0, 1);
  });

  it("D4-D: updatePositionPrices always populates barHigh from rawUpdate OHLC — fallback never needed in normal flow", async () => {
    // The barHigh/barLow fallback path (using currentPrice/close) is only relevant when
    // callExitHandler() is invoked directly without the updatePositionPrices loop.
    // In the normal flow, the loop populates exitBarContext.barHigh[pos.symbol] from
    // the rawUpdate.high BEFORE calling Python — so the barHigh override always wins.
    //
    // Verify: even if the barCtx passed to updatePositionPrices has barHigh: undefined,
    // the loop injects barHigh=rawUpdate.high for the position's symbol.
    // This is the same behavior proven by D4-E — this test documents it explicitly.
    const pos = buildStyleCLongPosition({ currentPrice: "4508", initialStopPrice: "4490" });
    selectQueue = [[pos], [{ strategyId: "strat-parity" }]];

    let capturedState: Record<string, unknown> | null = null;
    mockRunPythonModuleImpl = (...args: unknown[]) => {
      capturedState = ((args[0] as { config: Record<string, unknown> }).config.state as Record<string, unknown>);
      return Promise.resolve({ decision: "HOLD", new_stop: null, evidence: {}, handler_version: "style_c_v1.0.0" });
    };

    // barCtx.barHigh is undefined — but the loop populates it from rawUpdate.high=4510
    await updatePositionPrices(
      "sess-parity-001",
      { MES: { close: 4508, high: 4510, low: 4503 } },
      buildBarCtx({ barHigh: undefined, barLow: undefined }),
    );

    expect(mockRunPythonModule).toHaveBeenCalledTimes(1);
    // Loop populates barHigh from rawUpdate.high (4510), NOT bar.close (4508)
    // This confirms the barHigh injection always happens when rawUpdate has OHLC.
    expect(capturedState!.current_price).toBeCloseTo(4510.0, 1);
  });

  it("D4-E: barHigh from updatePositionPrices matches current bar high passed in rawUpdate", async () => {
    // Verify that barHigh/barLow populated by the updatePositionPrices loop
    // reflects the actual bar OHLC passed as rawUpdate (not stale from a prior bar).
    const pos = buildStyleCLongPosition({ initialStopPrice: "4490" });
    selectQueue = [[pos], [{ strategyId: "strat-parity" }]];

    // Note: updatePositionPrices populates barHigh/barLow FROM the rawUpdate OHLC
    // (high=4515, low=4501) into exitBarContext during the per-position loop.
    // The barCtx passed in doesn't need barHigh/barLow pre-populated when
    // updatePositionPrices is the populator — but in our test we provide a shared
    // exitBarContext; the population happens inside the loop using the rawUpdate.
    let capturedState: Record<string, unknown> | null = null;
    mockRunPythonModuleImpl = (...args: unknown[]) => {
      capturedState = ((args[0] as { config: Record<string, unknown> }).config.state as Record<string, unknown>);
      return Promise.resolve({ decision: "HOLD", new_stop: null, evidence: {}, handler_version: "style_c_v1.0.0" });
    };

    // Provide both approaches — rawUpdate OHLC drives the barHigh/barLow injection
    await updatePositionPrices(
      "sess-parity-001",
      { MES: { close: 4508, high: 4515, low: 4501 } },  // bar.high=4515
      buildBarCtx(),  // barHigh/barLow will be overwritten by the loop with 4515/4501
    );

    expect(mockRunPythonModule).toHaveBeenCalledTimes(1);
    // The rawUpdate high (4515) should have been threaded through
    expect(capturedState!.current_price).toBeCloseTo(4515.0, 1);
  });
});
