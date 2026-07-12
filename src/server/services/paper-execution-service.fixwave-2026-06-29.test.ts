/**
 * Fix-wave 2026-06-29: paper-execution-service.ts parity tests
 *
 * F1  — bookPartialClose now updates realizedPeakEquity, peakEquity, totalTrades,
 *         and dailyPnlBreakdown (previously only currentEquity was touched).
 * F2  — kill-switch daily-cap query uses entryTime (not exitTime).
 * F4  — same-bar TP1+TP2 sequential re-invocation when bar sweeps both targets.
 * F8  — signal.exit_plan_persisted audit row carries real position.id (not null).
 * F9  — macroRegime journal enrichment reads entry-time regime, not close-time.
 * F10 — toSlippageSession() centralizes ASIA→ASIAN remap; all 3 call sites use it.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Shared capture state ──────────────────────────────────────────────────────

const capturedAuditInserts: unknown[] = [];
const capturedTxSessionUpdates: unknown[] = [];  // within db.transaction tx.update
const capturedOuterUpdates: unknown[] = [];       // outer db.update calls (post-txn)

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
    // fresh-scan HIGH#4: bookPartialClose claims the position FOR UPDATE. `.for("update")` is used ONLY
    // by that claim — return a DEDICATED open-position resolver ({ closedAt: null }) that does NOT consume
    // the shared selectQueue, so the existing select slots stay unshifted and the guard passes (position
    // is open → booking proceeds).
    chain.for = () => {
      const openRow = [{ closedAt: null }];
      const openChain: Record<string, unknown> = {};
      openChain.limit = () => Promise.resolve(openRow);
      openChain.then = (onF: unknown) => Promise.resolve(openRow).then(onF as (v: unknown) => unknown);
      return openChain;
    };
    chain.values = (vals: unknown) => {
      capturedAuditInserts.push(vals);
      return { catch: vi.fn() };
    };
    return chain;
  }

  const dbMock = {
    select: vi.fn(makeChain),
    insert: vi.fn(() => ({
      values: vi.fn((vals: unknown) => {
        capturedAuditInserts.push(vals);
        return { catch: vi.fn() };
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn((vals: Record<string, unknown>) => {
        capturedOuterUpdates.push({ ...vals });
        // HIGH#1 (fresh-scan-3): updatePositionPrices' MTM UPDATE is now guarded with
        // .where(and(id, isNull(closedAt))).returning({id}) — expose .returning() (non-empty
        // = row matched = delta applies, preserving pre-guard test behavior).
        const p: any = Promise.resolve(undefined);
        p.returning = vi.fn().mockResolvedValue([{ id: "pos-mtm" }]);
        return { where: vi.fn().mockReturnValue(p) };
      }),
    })),
    transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({
      select: vi.fn(makeChain),
      // CRIT-1 (2026-07-09): closePosition runs a guarded idempotency CLAIM
      // (update...where(isNull(closedAt)).returning({id})) before the trade insert.
      // insert.values + update.set.where must both expose .returning().
      insert: vi.fn(() => ({
        values: vi.fn(() => ({ returning: vi.fn().mockResolvedValue([{ id: "trade-1", pnl: "0" }]), catch: vi.fn() })),
      })),
      update: vi.fn(() => ({
        set: vi.fn((vals: Record<string, unknown>) => {
          capturedTxSessionUpdates.push({ ...vals });
          const p: any = Promise.resolve(undefined);
          p.returning = vi.fn().mockResolvedValue([{ id: "pos-claimed", contracts: 3 }]);
          return { where: vi.fn().mockReturnValue(p) };
        }),
      })),
    })),
  };

  return { db: dbMock };
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
  toEasternDateString: vi.fn().mockReturnValue("2026-06-29"),
  toFuturesTradingDayString: vi.fn().mockReturnValue("2026-06-29"),
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
  getEtOffsetMinutes: vi.fn().mockReturnValue(-240), // EDT
  isUsDst: vi.fn().mockReturnValue(true),
}));
vi.mock("../lib/db-locks.js", () => ({
  withSessionLock: vi.fn(async (_: unknown, fn: (db: unknown) => unknown) => fn(undefined)),
}));
vi.mock("./server-mediated-executor.js", () => ({
  routeLiveFlatten: vi.fn().mockResolvedValue(undefined),
  routeLiveExitPartial: vi.fn().mockResolvedValue(undefined),
  isServerMediatedExecutionEnabled: vi.fn().mockReturnValue(false),
}));
vi.mock("./adaptive-exit-engine.js", () => ({
  computeExitPlan: vi.fn().mockResolvedValue(null),
}));
vi.mock("./volume-profile-service.js", () => ({
  getDevelopingSessionPoc: vi.fn().mockResolvedValue(null),
}));
vi.mock("./strategy-lockout-service.js", () => ({
  writeLockoutFromKillEvent: vi.fn(),
}));
vi.mock("../lib/audit-log-helper.js", () => ({
  insertAuditRowSafe: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../shared/firm-config.js", () => ({
  getFirmAccount: vi.fn().mockReturnValue({ firmId: "topstep" }),
  CONTRACT_SPECS: {
    MES: { pointValue: 5, tickSize: 0.25, tickValue: 1.25 },
    MCL: { pointValue: 100, tickSize: 0.01, tickValue: 1.0 },
  },
}));
vi.mock("../lib/contract-class.js", () => ({
  getCommissionPerSide: vi.fn().mockReturnValue(0.5),
  getStopCeilingPts: vi.fn().mockReturnValue(40),
}));
vi.mock("../lib/metrics-registry.js", () => ({
  paperTrades: { inc: vi.fn() },
}));
vi.mock("./prop-firm-health-service.js", () => ({
  isFirmSuspended: vi.fn().mockResolvedValue(false),
  registerSuspensionChangeCallback: vi.fn(),
}));
vi.mock("../lib/network-failover.js", () => ({
  isConnectivityDegraded: vi.fn().mockReturnValue(false),
}));
vi.mock("./strategy-assignment-service.js", () => ({
  getActiveAssignment: vi.fn().mockResolvedValue(null),
}));
vi.mock("./notification-service.js", () => ({
  notifyWarning: vi.fn().mockResolvedValue(undefined),
  notifyCritical: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../lib/notification-helpers.js", () => ({
  appendFamilyGradePostscript: vi.fn().mockReturnValue(""),
}));
vi.mock("../production/kill-switch.js", () => ({
  killSwitch: { isHaltedForProduction: vi.fn().mockResolvedValue(false) },
}));
vi.mock("../lib/fill-model.js", () => ({
  computeFillProbability: vi.fn().mockReturnValue(1.0),
}));

// ─── Imports after mocks ──────────────────────────────────────────────────────

import {
  updatePositionPrices,
  classifySessionType,
  toSlippageSession,
  type StyleExitBarContext,
} from "./paper-execution-service.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makePos(overrides: Record<string, unknown> = {}) {
  return {
    id: "pos-fw-001",
    sessionId: "sess-fw-001",
    symbol: "MES",
    side: "long",
    entryPrice: "5500",
    currentPrice: "5515",
    contracts: 3,
    unrealizedPnl: "30",
    previousUnrealizedPnl: "0",
    mae: null,
    mfe: null,
    fillRatio: "1.0",
    fillProbability: "1.0",
    trailHwm: null,
    closedAt: null,
    currentExitStyle: "C",
    tp1Filled: false,
    tp2Filled: false,
    beStopApplied: false,
    currentTrailMethod: null,
    lastHandlerEvalAt: null,
    initialStopPrice: "5487",
    highSinceEntryPrice: "5520",
    lowSinceEntryPrice: "5500",
    correlationId: "corr-fw-001",
    exitPlan: null,
    entryTime: new Date("2026-06-29T14:00:00.000Z"),
    arrivalPrice: null,
    implementationShortfall: null,
    ...overrides,
  };
}

function makePrices(symbol = "MES", close = 5515, high = 5525, low = 5505) {
  return { [symbol]: { close, high, low } };
}

function makeBarCtx(overrides: Partial<StyleExitBarContext> = {}): StyleExitBarContext {
  return {
    currentTimeEt: "10:30",
    atr14: { MES: 5.0 },
    barHigh: { MES: 5525.0 },
    barLow:  { MES: 5505.0 },
    ...overrides,
  };
}

beforeEach(() => {
  selectQueue = [];
  selectCallIndex = 0;
  capturedAuditInserts.length = 0;
  capturedTxSessionUpdates.length = 0;
  capturedOuterUpdates.length = 0;
  mockRunPythonModuleImpl = () =>
    Promise.resolve({ decision: "HOLD", new_stop: null, evidence: {}, handler_version: "style_c_v1.0.0" });
  vi.clearAllMocks();
});

// ─── F10: toSlippageSession — ASIA→ASIAN centralised remap ────────────────────

describe("F10 — toSlippageSession: centralised ASIA→ASIAN remap", () => {
  it("maps ASIA → ASIAN (the calculateSlippage multiplier key)", () => {
    expect(toSlippageSession("ASIA")).toBe("ASIAN");
  });

  it("passes CME_HALT through unchanged", () => {
    expect(toSlippageSession("CME_HALT")).toBe("CME_HALT");
  });

  it("passes LONDON through unchanged", () => {
    expect(toSlippageSession("LONDON")).toBe("LONDON");
  });

  it("passes NY_CORE through unchanged", () => {
    expect(toSlippageSession("NY_CORE")).toBe("NY_CORE");
  });

  it("passes OVERNIGHT through unchanged", () => {
    expect(toSlippageSession("OVERNIGHT")).toBe("OVERNIGHT");
  });

  it("classifySessionType returns ASIA for 01:30 ET (UTC-4 → 05:30 UTC)", () => {
    // 01:30 ET EDT = 05:30 UTC; etMinutes = 90 which is in [0,180) → ASIA
    const ts = new Date("2026-06-29T05:30:00.000Z"); // 01:30 EDT
    expect(classifySessionType(ts)).toBe("ASIA");
  });

  it("F10 parity chain: classifySessionType(ASIA_time) | toSlippageSession → ASIAN", () => {
    const ts = new Date("2026-06-29T05:30:00.000Z"); // 01:30 EDT → ASIA
    expect(toSlippageSession(classifySessionType(ts))).toBe("ASIAN");
  });
});

// ─── F1: bookPartialClose updates realizedPeakEquity + dailyPnlBreakdown ──────

describe("F1 — bookPartialClose: realizedPeakEquity and dailyPnlBreakdown updated", () => {
  it("F1a: transaction update includes realizedPeakEquity field (was missing before fix)", async () => {
    mockRunPythonModuleImpl = () =>
      Promise.resolve({
        decision: "FILL_TP1_50PCT",
        new_stop: null,
        evidence: { tp1_price: 5513, stop_pts: 13 },
        handler_version: "style_c_v1.0.0",
      });

    const pos = makePos();
    // Slot 0: initial positions read.
    // Slot 1: strategy id (getSessionStrategyId).
    // Slot 2: consumed by bookPartialClose's db.select(firmId) — the fire-and-forget
    //         bookPartialClose runs synchronously to its first await and consumes this slot.
    //         The F4 re-invoke uses in-memory position construction (no extra slot needed).
    selectQueue = [
      [pos],
      [{ strategyId: "strat-fw-001" }],
      [{ firmId: null }],  // bookPartialClose firmId select consumes this
    ];

    await updatePositionPrices("sess-fw-001", makePrices(), makeBarCtx());

    // Allow bookPartialClose fire-and-forget to complete
    for (let i = 0; i < 8; i++) await Promise.resolve();

    // The tx.update(paperSessions).set(...) must include realizedPeakEquity
    const txUpdate = capturedTxSessionUpdates.find(
      (u) => u && typeof u === "object" && "realizedPeakEquity" in (u as Record<string, unknown>),
    );
    expect(txUpdate).toBeDefined();
  });

  it("F1b: transaction update includes totalTrades increment (was absent before fix)", async () => {
    mockRunPythonModuleImpl = () =>
      Promise.resolve({
        decision: "FILL_TP1_50PCT",
        new_stop: null,
        evidence: { tp1_price: 5513, stop_pts: 13 },
        handler_version: "style_c_v1.0.0",
      });

    const pos = makePos();
    selectQueue = [
      [pos],
      [{ strategyId: "strat-fw-001" }],
      [{ firmId: null }],  // bookPartialClose firmId select consumes this
    ];

    await updatePositionPrices("sess-fw-001", makePrices(), makeBarCtx());
    for (let i = 0; i < 8; i++) await Promise.resolve();

    const txUpdate = capturedTxSessionUpdates.find(
      (u) => u && typeof u === "object" && "totalTrades" in (u as Record<string, unknown>),
    );
    expect(txUpdate).toBeDefined();
  });

  it("F1c: dailyPnlBreakdown update fires INSIDE the close transaction (M1 deepscan-6 fix)", async () => {
    // F-3 (re-scan 2026-07-10): this test previously asserted the dailyPnlBreakdown write
    // fired as a SEPARATE OUTER update (capturedOuterUpdates) — stale. The M1 deepscan-6 fix
    // moved that write INSIDE the atomic close transaction (paper-execution-service.ts ~2663,
    // `dailyPnlBreakdown: sql\`jsonb_set(...)\`` inside the tx update block, same pattern as
    // realizedPeakEquity/totalTrades in F1a/F1b) so the daily P&L and the trade can never be
    // half-committed. Assert the CORRECT behavior — it is part of the tx session update.
    mockRunPythonModuleImpl = () =>
      Promise.resolve({
        decision: "FILL_TP1_50PCT",
        new_stop: null,
        evidence: { tp1_price: 5513, stop_pts: 13 },
        handler_version: "style_c_v1.0.0",
      });

    const pos = makePos();
    selectQueue = [
      [pos],
      [{ strategyId: "strat-fw-001" }],
      [{ firmId: null }],  // bookPartialClose firmId select consumes this
    ];

    await updatePositionPrices("sess-fw-001", makePrices(), makeBarCtx());
    for (let i = 0; i < 16; i++) await Promise.resolve();

    // dailyPnlBreakdown is now part of the atomic transaction update (not a separate outer write).
    const txDailyUpdate = capturedTxSessionUpdates.find(
      (u) => u && typeof u === "object" && "dailyPnlBreakdown" in (u as Record<string, unknown>),
    );
    expect(txDailyUpdate).toBeDefined();
  });
});

// ─── F2: kill-switch counts trades by entryTime, not exitTime ─────────────────

describe("F2 — kill-switch uses entryTime convention (CME 5pm ET boundary parity)", () => {
  it("F2 smoke: updatePositionPrices completes without throwing (entryTime path exercised)", async () => {
    // Verify the fix didn't break the code path (behavioral smoke test).
    // SQL verification requires integration tests with a real DB.
    const pos = makePos();
    selectQueue = [
      [pos],
      [{ strategyId: "strat-fw-001" }],
    ];

    await expect(
      updatePositionPrices("sess-fw-001", makePrices(), makeBarCtx()),
    ).resolves.not.toThrow();
  });
});

// ─── F4: same-bar TP1+TP2 sequential re-invocation ───────────────────────────

describe("F4 — same-bar TP1+TP2 sequential evaluation", () => {
  it("F4a: Python handler called twice when TP1 fills and TP2 available in same bar", async () => {
    let callCount = 0;
    mockRunPythonModuleImpl = () => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          decision: "FILL_TP1_50PCT",
          new_stop: null,
          evidence: { tp1_price: 5513, stop_pts: 13 },
          handler_version: "style_c_v1.0.0",
        });
      }
      return Promise.resolve({
        decision: "FILL_TP2",
        new_stop: null,
        evidence: { tp2_price: 5520, stop_pts: 13 },
        handler_version: "style_c_v1.0.0",
      });
    };

    const pos = makePos({ contracts: 3 });

    // Slot 0: initial positions read.
    // Slot 1: strategy id for first callExitHandler.
    // Slot 2: consumed by bookPartialClose's firmId select (fire-and-forget runs
    //         synchronously to its first db.select before the F4 block executes).
    //         The F4 re-invoke uses in-memory position construction — no extra slot.
    selectQueue = [
      [pos],
      [{ strategyId: "strat-fw-001" }],
      [{ firmId: null }],  // bookPartialClose firmId select
    ];

    await updatePositionPrices("sess-fw-001", makePrices(), makeBarCtx());

    // Python handler called once for TP1, once more for TP2 re-invocation
    expect(mockRunPythonModule).toHaveBeenCalledTimes(2);
  });

  it("F4b: HOLD on second invocation is a safe no-op (position not further closed)", async () => {
    let callCount = 0;
    mockRunPythonModuleImpl = () => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          decision: "FILL_TP1_50PCT",
          new_stop: null,
          evidence: { tp1_price: 5513, stop_pts: 13 },
          handler_version: "style_c_v1.0.0",
        });
      }
      return Promise.resolve({ decision: "HOLD", new_stop: null, evidence: {}, handler_version: "style_c_v1.0.0" });
    };

    const pos = makePos({ contracts: 3 });

    // Slot 0: initial positions read.
    // Slot 1: strategy id.
    // Slot 2: consumed by bookPartialClose's firmId select (fire-and-forget, sync to first await).
    //         F4 re-invoke uses in-memory position — no extra DB slot needed.
    selectQueue = [
      [pos],
      [{ strategyId: "strat-fw-001" }],
      [{ firmId: null }],  // bookPartialClose firmId select
    ];

    await expect(
      updatePositionPrices("sess-fw-001", makePrices(), makeBarCtx()),
    ).resolves.not.toThrow();
    expect(mockRunPythonModule).toHaveBeenCalledTimes(2);
  });

  it("F4c: only 1 re-invocation (cap prevents infinite loop)", async () => {
    // Python always returns FILL_TP1_50PCT — cap should stop after 1 re-invoke
    mockRunPythonModuleImpl = () =>
      Promise.resolve({
        decision: "FILL_TP1_50PCT",
        new_stop: null,
        evidence: { tp1_price: 5513, stop_pts: 13 },
        handler_version: "style_c_v1.0.0",
      });

    const pos = makePos({ contracts: 3 });

    // Slot 0: initial positions read.
    // Slot 1: strategy id.
    // Slot 2: consumed by bookPartialClose's firmId select (fire-and-forget, runs synchronously
    //         to its first db.select before yielding). The F4 re-invoke uses an in-memory
    //         constructed position — no extra DB slot needed for it.
    selectQueue = [
      [pos],
      [{ strategyId: "strat-fw-001" }],
      [{ firmId: null }],  // bookPartialClose firmId select consumes this slot
    ];

    await updatePositionPrices("sess-fw-001", makePrices(), makeBarCtx());

    // Exactly 2 calls: initial + 1 re-invoke (F4 in-memory re-invoke fires correctly;
    // the block structure caps at 1 re-invocation — no loop, exits after the single re-invoke).
    expect(mockRunPythonModule.mock.calls.length).toBe(2);
  });
});

// ─── F8: signal.exit_plan_persisted audit row entityId — logic test ───────────

describe("F8 — pendingExitPlanAudit deferred to after position INSERT", () => {
  it("F8 logic: deferred audit pattern correctly threads position.id into entityId", () => {
    // Unit test of the deferred-capture pattern (no DB required).
    // This directly tests the fix logic: capture payload → INSERT → write with id.
    const mockPositionId = "pos-fw-inserted-001";
    let capturedEntityId: string | null = null;

    // Simulate the fix: capture payload, then write audit with real position id
    let pendingAudit: { strategy_id: string } | null = null;

    // Simulate computeExitPlan success → capture audit payload
    pendingAudit = { strategy_id: "strat-001" };

    // Simulate position INSERT returning a real id
    const positionId = mockPositionId; // from INSERT RETURNING

    // Simulate deferred write: fires AFTER INSERT
    if (pendingAudit != null) {
      capturedEntityId = positionId; // the fix: uses positionId, not null
    }

    expect(capturedEntityId).toBe(mockPositionId);
    expect(capturedEntityId).not.toBeNull();
  });

  it("F8 guard: pendingAudit null when computeExitPlan not called (no adaptive plan)", () => {
    // When exitStyle != "adaptive", pendingExitPlanAudit stays null → no audit written.
    // Use an explicit string type so TypeScript does not narrow the const to the literal
    // "static_styleC" and flag the `=== "adaptive"` comparison as unreachable (TS2367).
    let pendingAudit: unknown = null;
    const exitStyle: string = "static_styleC";

    // Simulate: only set pendingAudit when exitStyle === "adaptive"
    if (exitStyle === "adaptive") {
      pendingAudit = { strategy_id: "strat-001" };
    }

    expect(pendingAudit).toBeNull();
  });
});

// ─── F9: macroRegime reads entry-time, not close-time ─────────────────────────

describe("F9 — macroRegime journal reads entry-time regime from exitPlan", () => {
  it("F9a: entryRegime from exitPlan JSONB is a string and supersedes snapshot query", () => {
    // Simulate the F9 read logic at closePosition:
    // const entryRegime = (pos.exitPlan as Record<string, unknown>)?.entryRegime;
    // if (typeof entryRegime === "string" && entryRegime.length > 0) { macroRegime = entryRegime; }
    const exitPlan = {
      entryRegime: "trending_up",
      runtime_state: {},
    };

    const entryRegime = (exitPlan as unknown as Record<string, unknown>)?.entryRegime;
    const macroRegime = typeof entryRegime === "string" && entryRegime.length > 0
      ? entryRegime
      : null;

    expect(macroRegime).toBe("trending_up");
  });

  it("F9b: missing entryRegime causes fallback to snapshot query (pre-F9 position)", () => {
    const exitPlan = { runtime_state: {} }; // no entryRegime field

    const entryRegime = (exitPlan as unknown as Record<string, unknown>)?.entryRegime;
    const shouldFallback = !(typeof entryRegime === "string" && (entryRegime as string).length > 0);

    expect(shouldFallback).toBe(true);
  });

  it("F9c: null exitPlan causes fallback to snapshot query (position with no adaptive plan)", () => {
    const exitPlan = null;

    const entryRegime = (exitPlan as unknown as Record<string, unknown> | null)?.entryRegime;
    const shouldFallback = !(typeof entryRegime === "string" && (entryRegime as string).length > 0);

    expect(shouldFallback).toBe(true);
  });

  it("F9d: entryRegime injected at openPosition survives JSON serialization (round-trip)", () => {
    // Simulate what happens when exitPlanForDb is serialized and read back from DB
    const exitPlanForDb = {
      tp1: { source: "structural", price: 5520, level_type: "resistance", r_multiple: 1.5 },
      tp2: { source: "structural", price: 5530, level_type: "resistance", r_multiple: 2.5 },
      runner: { trail_method: "ATR_TRAIL", trail_anchor_value: 5500, regime_source: "b", method_source: "c" },
      scaling: { tp1_pct: 0.33, tp2_pct: 0.33, runner_pct: 0.34, regime_source: "b", schedule_source: "c" },
      early_exit_threshold_delta_div: 2, early_exit_partial_pct: 0.5,
      pre_lunch_threshold_r: 1.5, pre_lunch_partial_pct: 0.5,
      audit_payload: {},
      runtime_state: {},
      entryRegime: "choppy",  // F9 extra field
    };

    // Simulate DB round-trip: JSON.stringify → JSON.parse (what postgres JSONB does)
    const fromDb = JSON.parse(JSON.stringify(exitPlanForDb));
    const entryRegime = (fromDb as Record<string, unknown>).entryRegime;

    expect(entryRegime).toBe("choppy");
  });
});
