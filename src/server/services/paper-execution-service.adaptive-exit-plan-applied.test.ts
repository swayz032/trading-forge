/**
 * paper-execution-service.adaptive-exit-plan-applied.test.ts
 *
 * post-m3-paper-execution-lifecycle wave (2026-07-17), CRIT — re-verified against current
 * (post-M3) code and confirmed STILL PRESENT: exit_style="adaptive" positions never applied the
 * computed TP1/TP2/scaling plan at fill time. Style C's fixed 33/33/34 split (and flat +1.0R/+2.0R
 * TP prices) ran instead, regardless of the strategy's configured exit_plan_config.
 *
 * ROOT CAUSE (confirmed by direct code read, not inference):
 *   - openPosition (Wave 25.5 Gap A, ~line 2216) computes the real ExitPlan via computeExitPlan()
 *     and persists it into paper_positions.exit_plan — including liquidity-mapped tp1.price /
 *     tp2.price and a regime-dependent scaling.tp1_pct / tp2_pct / runner_pct (e.g. TRENDING
 *     20/30/50, HIGH_VOL_MACRO 60/30/10 — see adaptive-exit-engine.ts REGIME_SCALING_DEFAULTS).
 *   - But `paperPositions.currentExitStyle` is NEVER written at INSERT time (grep confirms zero
 *     assignment sites) — it is always null, so callExitHandler's `(pos.currentExitStyle ?? "C")`
 *     always resolves to "C" regardless of exit_plan_config.exit_style.
 *   - callExitHandler therefore always dispatches to the Python style_c_handler.py, which computes
 *     tp1_price = entry ± 1.0R and tp2_price = entry ± 2.0R off the managed-stop distance ONLY —
 *     it is never told about the liquidity-mapped adaptive prices at all.
 *   - applyExitDecision's FILL_TP1_50PCT/FILL_TP2 branches always split contracts via
 *     styleCScaleOut() (hardcoded 33/33/34), never via the plan's own scaling percentages.
 *   - The ONLY consumer of pos.exitPlan at management time (pre-fix) was the runner-trail block
 *     (Gap C, ~line 5009+) — and that only affects the TRAIL STOP level for whatever remains AFTER
 *     TP1+TP2, never TP1/TP2 pricing or sizing.
 *
 * THE FIX: an adaptive TP1/TP2 pre-check in callExitHandler (mirrors the existing static_styleC
 * TP2 "F-b parity fix" pre-check pattern already in this file) that reads pos.exitPlan.tp1.price /
 * tp2.price directly and fires FILL_TP1_50PCT / FILL_TP2 with evidence.source="adaptive" BEFORE
 * the Python subprocess is ever dispatched — plus applyExitDecision (and the F4 same-bar
 * reconciliation fallback) now split contracts via the new adaptiveScaleOut() helper reading
 * pos.exitPlan.scaling.{tp1_pct,tp2_pct} instead of styleCScaleOut()'s hardcoded 33/33/34, whenever
 * evidence.source === "adaptive".
 *
 * Test harness copied verbatim from paper-execution-service.f4-samebar-partial-full-equity.test.ts
 * (same mock shape for db/index.js transaction + select-queue pattern) to keep isolation
 * boundaries identical to the rest of this file's sibling test suites.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Shared capture state ───────────────────────────────────────────────────
const capturedTxPositionUpdates: Array<Record<string, unknown>> = [];
const capturedTradeInserts: Array<Record<string, unknown>> = [];
const capturedTxSessionUpdates: Array<Record<string, unknown>> = [];

// Faithfully mirrors src/engine/exits/style_c_handler.py's ACTUAL flat-R logic (TP1@+1.0R,
// TP2@+2.0R off entry_price ± stop_pts, using bar_high/bar_low for intrabar touch — see
// style_c_handler.py's price_reached()) — this is exactly what the pre-fix bug served to every
// position regardless of exit_style, ignorant of the adaptive plan's liquidity-mapped prices. If
// this mock is ever reached and FIRES a decision for an in-range adaptive touch, it proves the
// adaptive pre-check failed to short-circuit and the old Style-C-flat-R behavior took over — the
// core RED-proof mechanism this suite relies on (temporarily reverting the adaptive pre-check
// makes every FILL_TP1/FILL_TP2 in this file come from THIS mock's flat-R math instead of the
// adaptive-plan prices, which the assertions below would catch immediately).
const mockRunPythonModule = vi.fn((req: { module?: string; config?: { state?: Record<string, unknown> } }) => {
  if (req.module === "src.engine.exits.style_c_handler") {
    const state = req.config?.state ?? {};
    const entryPrice = Number(state["entry_price"] ?? 0);
    const stopPts = Number(state["stop_pts"] ?? 0);
    const direction = state["direction"] === "short" ? -1 : 1;
    const barHigh = Number(state["bar_high"] ?? state["current_price"] ?? 0);
    const barLow = Number(state["bar_low"] ?? state["current_price"] ?? 0);
    const tp1Filled = state["tp1_filled"] === true;
    const tp2Filled = state["tp2_filled"] === true;
    const tp1Price = entryPrice + direction * stopPts * 1.0;
    const tp2Price = entryPrice + direction * stopPts * 2.0;
    const reached = (target: number) => (direction === 1 ? barHigh >= target : barLow <= target);

    if (!tp1Filled && reached(tp1Price)) {
      return Promise.resolve({
        decision: "FILL_TP1_50PCT", new_stop: null,
        evidence: { tp1_price: tp1Price, tp1_fraction: 0.33, stop_pts: stopPts }, handler_version: "style_c_v1.0.0",
      });
    }
    if (tp1Filled && !tp2Filled && reached(tp2Price)) {
      return Promise.resolve({
        decision: "FILL_TP2", new_stop: null,
        evidence: { tp2_price: tp2Price, tp2_fraction: 0.33 }, handler_version: "style_c_v1.0.0",
      });
    }
    return Promise.resolve({ decision: "HOLD", new_stop: null, evidence: {}, handler_version: "style_c_v1.0.0" });
  }
  return Promise.resolve({ is_economic_event: false });
});

let claimRow: { closedAt: null; contracts: number; previousUnrealizedPnl: string } = {
  closedAt: null, contracts: 10, previousUnrealizedPnl: "0",
};

let mtmReturningRows: Array<{ id: string }> = [{ id: "pos-adaptive" }];

let selectQueue: Array<unknown[]> = [];
let selectCallIndex = 0;

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
        return (p as Promise<unknown>).then(onFulfilled as (v: unknown) => unknown, onRejected as (e: unknown) => unknown);
      },
      catch: (onRejected: unknown) => { settle(); return (p as Promise<unknown>).catch(onRejected as (e: unknown) => unknown); },
      finally: (onFinally: unknown) => { settle(); return (p as Promise<unknown>).finally(onFinally as () => unknown); },
    };
    const chainFn = () => chain;
    chain.from = chainFn;
    chain.where = chainFn;
    chain.limit = chainFn;
    chain.orderBy = chainFn;
    chain.returning = chainFn;
    return chain;
  }

  function makeOpenChain(rows: unknown[]) {
    const p: any = Promise.resolve(rows);
    p.limit = () => Promise.resolve(rows);
    return p;
  }

  const dbMock = {
    select: vi.fn(makeChain),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({ catch: vi.fn(), returning: vi.fn().mockResolvedValue([]) })),
    })),
    update: vi.fn(() => ({
      set: vi.fn((vals: Record<string, unknown>) => {
        if ("currentEquity" in vals) {
          return { where: vi.fn().mockResolvedValue(undefined) };
        }
        const p: any = Promise.resolve(undefined);
        p.returning = vi.fn().mockImplementation(() => Promise.resolve(mtmReturningRows));
        return { where: vi.fn().mockReturnValue(p) };
      }),
    })),
    transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({
      select: vi.fn(() => ({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        for: vi.fn(() => makeOpenChain([claimRow])),
        limit: vi.fn().mockResolvedValue([]),
      })),
      insert: vi.fn(() => ({
        values: vi.fn((row: Record<string, unknown>) => {
          if ("pnl" in row) capturedTradeInserts.push(row);
          return { returning: vi.fn().mockResolvedValue([{ id: "trade-adaptive", ...row }]), catch: vi.fn() };
        }),
      })),
      update: vi.fn(() => ({
        set: vi.fn((vals: Record<string, unknown>) => {
          if ("currentEquity" in vals) {
            capturedTxSessionUpdates.push({ ...vals });
            return { where: vi.fn().mockResolvedValue(undefined) };
          }
          if ("dailyPnlBreakdown" in vals) {
            return { where: vi.fn().mockResolvedValue(undefined) };
          }
          if ("closedAt" in vals) {
            const p: any = Promise.resolve(undefined);
            p.returning = vi.fn().mockImplementation(() => Promise.resolve([]));
            return { where: vi.fn().mockReturnValue(p) };
          }
          capturedTxPositionUpdates.push({ ...vals });
          return { where: vi.fn().mockResolvedValue(undefined) };
        }),
      })),
    })),
  };

  return { db: dbMock };
});

vi.mock("../routes/sse.js", () => ({
  broadcastSSE: vi.fn(),
  PAPER_EXIT_EVENTS: {
    TP1_FILLED: "paper:exit:tp1_filled", TP2_FILLED: "paper:exit:tp2_filled",
    BE_STOP_MOVED: "paper:exit:be_stop_moved", TRAIL_TIGHTENED: "paper:exit:trail_tightened",
    TIME_STOP_FLATTENED: "paper:exit:time_stop_flattened", HANDLER_ERROR: "paper:exit:handler_error",
  },
}));
vi.mock("../lib/python-runner.js", () => ({ runPythonModule: (...args: unknown[]) => mockRunPythonModule(...(args as [never])) }));
vi.mock("./pipeline-control-service.js", () => ({ isActive: vi.fn(() => true) }));
vi.mock("../lib/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../index.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../lib/tracing.js", () => ({ tracer: { startSpan: vi.fn(() => ({ setAttribute: vi.fn(), end: vi.fn() })) } }));
vi.mock("../scheduler.js", () => ({ onPaperTradeClose: vi.fn() }));
vi.mock("./paper-risk-gate.js", () => ({
  toEasternDateString: vi.fn(() => "2026-07-17"),
  toFuturesTradingDayString: vi.fn(() => "2026-07-17"),
  invalidateDailyLossCache: vi.fn(),
}));
vi.mock("../lib/roll-calendar-loader.js", () => ({
  computeRollSpreadCost: vi.fn(() => ({ estimatedSpreadCost: 0, rollDates: [] })),
}));
vi.mock("./alert-service.js", () => ({
  AlertFactory: { systemError: vi.fn(), criticalAlert: vi.fn(), driftAlert: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock("../lib/dst-utils.js", () => ({ getEtOffsetMinutes: vi.fn(() => -240), isUsDst: vi.fn(() => true) }));
vi.mock("./server-mediated-executor.js", () => ({
  routeLiveFlatten: vi.fn().mockResolvedValue(undefined),
  routeLiveExitPartial: vi.fn().mockResolvedValue(undefined),
  isServerMediatedExecutionEnabled: vi.fn().mockReturnValue(false),
}));
vi.mock("./adaptive-exit-engine.js", () => ({ computeExitPlan: vi.fn().mockResolvedValue(null) }));
vi.mock("./volume-profile-service.js", () => ({ getDevelopingSessionPoc: vi.fn().mockResolvedValue(null) }));
vi.mock("./strategy-lockout-service.js", () => ({ writeLockoutFromKillEvent: vi.fn() }));
vi.mock("../lib/audit-log-helper.js", () => ({ insertAuditRowSafe: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../shared/firm-config.js", () => ({
  getFirmAccount: vi.fn().mockReturnValue({ firmId: "topstep" }),
  CONTRACT_SPECS: { MES: { pointValue: 5, tickSize: 0.25, tickValue: 1.25 } },
}));
vi.mock("../lib/contract-class.js", () => ({
  getCommissionPerSide: vi.fn().mockReturnValue(0),
  getStopCeilingPts: vi.fn().mockReturnValue(40),
}));
vi.mock("../lib/metrics-registry.js", () => ({
  paperTrades: { labels: vi.fn(() => ({ inc: vi.fn() })) },
  dllHaltTotal: { labels: vi.fn(() => ({ inc: vi.fn() })), inc: vi.fn() },
}));
vi.mock("./prop-firm-health-service.js", () => ({
  isFirmSuspended: vi.fn().mockResolvedValue(false), registerSuspensionChangeCallback: vi.fn(),
}));
vi.mock("../lib/network-failover.js", () => ({ isConnectivityDegraded: vi.fn().mockReturnValue(false) }));
vi.mock("./strategy-assignment-service.js", () => ({ getActiveAssignment: vi.fn().mockResolvedValue(null) }));
vi.mock("./notification-service.js", () => ({
  notifyWarning: vi.fn().mockResolvedValue(undefined), notifyCritical: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../lib/notification-helpers.js", () => ({ appendFamilyGradePostscript: vi.fn().mockReturnValue("") }));
vi.mock("../production/kill-switch.js", () => ({ killSwitch: { isHaltedForProduction: vi.fn().mockResolvedValue(false) } }));
vi.mock("../lib/fill-model.js", () => ({ computeFillProbability: vi.fn().mockReturnValue(1.0) }));

import { updatePositionPrices, type StyleExitBarContext } from "./paper-execution-service.js";

// entryContracts=10; adaptive scaling 20/30/50 (a TRENDING-regime-shaped schedule, deliberately
// far from Style C's 33/33/34 so a pre-fix regression is unmistakable in the assertions below).
const ADAPTIVE_EXIT_PLAN = {
  tp1: { source: "liquidity", price: 5008, level_type: "vwap_1s", htf_significance: 2, r_multiple: 0.8 },
  tp2: { source: "liquidity", price: 5015, level_type: "hod", htf_significance: 3, r_multiple: 1.5 },
  runner: { trail_method: "developing_poc", trail_anchor_value: 5000, regime_source: "TRENDING_UP", method_source: "regime_default" },
  scaling: { tp1_pct: 0.2, tp2_pct: 0.3, runner_pct: 0.5, regime_source: "TRENDING_UP", schedule_source: "regime_default" },
  early_exit_threshold_delta_div: 0.6,
  early_exit_partial_pct: 0.25,
  pre_lunch_threshold_r: 0.3,
  pre_lunch_partial_pct: 0.5,
  audit_payload: {},
  runtime_state: {},
};

function makePos(overrides: Record<string, unknown> = {}) {
  return {
    id: "pos-adaptive", sessionId: "sess-adaptive", symbol: "MES", side: "long",
    entryPrice: "5000", currentPrice: "5000", contracts: 10, entryContracts: 10,
    unrealizedPnl: "0", previousUnrealizedPnl: "0",
    mae: null, mfe: null, fillRatio: "1.0", fillProbability: "1.0",
    trailHwm: null, closedAt: null, currentExitStyle: null, // NEVER set at open — confirmed by grep
    tp1Filled: false, tp2Filled: false, beStopApplied: false, currentTrailMethod: null,
    lastHandlerEvalAt: null, initialStopPrice: "4990",
    highSinceEntryPrice: "5000", lowSinceEntryPrice: "5000",
    correlationId: "corr-adaptive", exitPlan: ADAPTIVE_EXIT_PLAN,
    entryTime: new Date("2026-07-17T14:00:00.000Z"),
    arrivalPrice: null, implementationShortfall: null,
    ...overrides,
  };
}

function makeBarCtx(overrides: Partial<StyleExitBarContext> = {}): StyleExitBarContext {
  return {
    currentTimeEt: "10:30", atr14: { MES: 5.0 },
    barHigh: { MES: 5008.0 }, barLow: { MES: 5008.0 },
    currentBarHigh: { MES: 5008.0 }, currentBarLow: { MES: 5008.0 },
    barTimestamp: new Date("2026-07-17T14:30:00.000Z"), // 10:30 ET (RTH, deterministic slippage)
    ...overrides,
  };
}

function setupSelectQueue(originalPos: unknown) {
  selectQueue = [
    [originalPos],               // openPositions
    [{ strategyId: "strat-adaptive" }], // getSessionStrategyId
    [{ firmId: null }],          // bookPartialClose sessionForFirm
    [],
    [],
    [],
    [],
    [],
  ];
  selectCallIndex = 0;
}

beforeEach(() => {
  capturedTxPositionUpdates.length = 0;
  capturedTradeInserts.length = 0;
  capturedTxSessionUpdates.length = 0;
  selectQueue = [];
  selectCallIndex = 0;
  claimRow = { closedAt: null, contracts: 10, previousUnrealizedPnl: "0" };
  mtmReturningRows = [{ id: "pos-adaptive" }];
  mockRunPythonModule.mockClear();
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-17T14:31:00.000Z")); // 10:31 ET — RTH, matches barTimestamp
});

afterEach(() => {
  vi.useRealTimers();
});

describe("post-m3-paper-execution-lifecycle CRIT — adaptive exit plan applied at fill time", () => {
  it("TP1 fires at the adaptive liquidity-mapped price + regime scaling split, WITHOUT ever calling the Python style_c_handler subprocess", async () => {
    const pos = makePos();
    setupSelectQueue(pos);

    // Bar touches tp1.price (5008) but not tp2.price (5015).
    await updatePositionPrices("sess-adaptive", { MES: { close: 5008, high: 5008, low: 5008 } }, makeBarCtx());
    for (let i = 0; i < 12; i++) await Promise.resolve();

    // ── Core RED-proof: the adaptive TP1 decision itself must be made by the TS pre-check
    // BEFORE the Python subprocess is ever dispatched. Pre-fix, style_c_handler was ALWAYS
    // consulted for TP1 (and would have returned its Style-C-shaped FILL_TP1_50PCT default at
    // tp1_price=5010/fraction=0.33, ignoring the adaptive plan entirely). Post-fix, the ONLY
    // Python call observed is the F4 same-bar re-invocation that runs AFTER TP1 already filled
    // (tp1_filled=true in its state) to check whether TP2 ALSO fires this bar — it does not,
    // since the bar never reached tp2.price(5015), so it correctly falls through to Python and
    // gets HOLD back. If the adaptive pre-check had NOT short-circuited the TP1 decision, this
    // call would show tp1_filled=false instead.
    expect(mockRunPythonModule).toHaveBeenCalledTimes(1);
    const pyCall = mockRunPythonModule.mock.calls[0][0] as { config: { state: Record<string, unknown> } };
    expect(pyCall.config.state.tp1_filled).toBe(true);

    // ── Sizing: adaptiveScaleOut(10, 0.2, 0.3).tp1 = round(10*0.2) = 2 — NOT
    // styleCScaleOut(10).tp1 = round(10*0.33) = 3 (the pre-fix Style C default the bug produced).
    expect(capturedTradeInserts).toHaveLength(1);
    expect(capturedTradeInserts[0].contracts).toBe(2);

    // ── Pricing: the trade fills off the adaptive liquidity-mapped tp1.price=5008 (which is only
    // 0.8R, NOT the Python default's flat +1.0R=5010) — netPnl reflects the 5008 exit, not 5010.
    // (Position-state advance is captured via capturedTxPositionUpdates for the remaining-contracts check.)
    expect(capturedTxPositionUpdates).toHaveLength(1);
    expect(capturedTxPositionUpdates[0].contracts).toBe(8); // 10 - 2 (adaptive tp1 leg), NOT 10-3=7
    expect(capturedTxPositionUpdates[0].tp1Filled).toBe(true);
  });

  it("TP2 fires at the adaptive liquidity-mapped price + regime scaling split once TP1 has already filled", async () => {
    const pos = makePos({ contracts: 8, tp1Filled: true }); // post-TP1 state (2 of 10 already closed)
    setupSelectQueue(pos);
    claimRow = { closedAt: null, contracts: 8, previousUnrealizedPnl: "0" };

    // Bar touches tp2.price (5015).
    await updatePositionPrices(
      "sess-adaptive",
      { MES: { close: 5015, high: 5015, low: 5015 } },
      makeBarCtx({ barHigh: { MES: 5015.0 }, barLow: { MES: 5015.0 }, currentBarHigh: { MES: 5015.0 }, currentBarLow: { MES: 5015.0 } }),
    );
    for (let i = 0; i < 12; i++) await Promise.resolve();

    expect(mockRunPythonModule).not.toHaveBeenCalled();

    // adaptiveScaleOut(10, 0.2, 0.3): cumTp1=2, cumTp2=round(10*0.5)=5 -> tp2 leg = 5-2 = 3.
    // NOT styleCScaleOut(10).tp2 = round(10*0.66)-round(10*0.33) = 7-3 = 4 (Style C default).
    expect(capturedTradeInserts).toHaveLength(1);
    expect(capturedTradeInserts[0].contracts).toBe(3);
    expect(capturedTxPositionUpdates).toHaveLength(1);
    expect(capturedTxPositionUpdates[0].contracts).toBe(5); // 8 - 3 = 5 (runner: matches adaptiveScaleOut runner=5)
    expect(capturedTxPositionUpdates[0].tp2Filled).toBe(true);
  });

  it("static_styleC positions (no tp1.price/tp2.price on the plan) are completely unaffected — the pre-check is a no-op and Python still decides", async () => {
    // Legacy/static exit plan shape: static_styleC_tp2_price only, no tp1/tp2 sub-objects.
    const staticPos = makePos({
      exitPlan: { static_styleC_tp2_price: 5010, static_styleC_tp2_source: "r_multiple", static_styleC_tp2_level_type: null, static_styleC_tp2_r_multiple: 2.0, runtime_state: {} },
    });
    setupSelectQueue(staticPos);
    // Price 5003 is below every threshold (adaptive-flat-R TP1=5010 AND the static TP2=5010) —
    // the realistic style_c_handler mock naturally returns HOLD here, no override needed.

    await updatePositionPrices("sess-adaptive", { MES: { close: 5003, high: 5003, low: 5003 } }, makeBarCtx({ barHigh: { MES: 5003 }, barLow: { MES: 5003 }, currentBarHigh: { MES: 5003 }, currentBarLow: { MES: 5003 } }));
    for (let i = 0; i < 12; i++) await Promise.resolve();

    // Price (5003) is below both the static TP2 price (5010) and any adaptive threshold — no
    // adaptive tp1/tp2 sub-objects exist on this plan at all, so the new pre-check must never
    // fire; Python is reached exactly as before this wave's fix (HOLD, since 5003 < flat TP1=5010).
    expect(mockRunPythonModule).toHaveBeenCalledTimes(1);
    expect(capturedTradeInserts).toHaveLength(0);
  });
});
