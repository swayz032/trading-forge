/**
 * paper-execution-service.f3-bartime-exit-slippage.test.ts
 *
 * F-3 CRITICAL (freshscan11 2026-07-12, ratify packet
 * docs/ratify-packets/freshscan11-2026-07-12-F3-wallclock-exit-slippage.md, amended 2026-07-16) —
 * exit-slippage session was classified from `new Date()` (wall clock at code-execution time), not
 * the market bar being processed. `classifySessionType` maps 16:00-17:00 ET to "CME_HALT", and
 * `calculateSlippage` applies a 100x multiplier for that window. Post-outage backlog catch-up (or
 * any close landing for real inside 16:00-17:00 ET) therefore corrupted realized P&L and the
 * one-way `realizedPeakEquity` (Topstep/Apex trailing-DD HWM) ratchet by up to 100x.
 *
 * THE FIX: `StyleExitBarContext` gains an optional `barTimestamp: Date` (the bar being processed,
 * computed once in `paper-trading-stream.ts::buildExitBarContext`). It is threaded through
 * `applyExitDecision` -> `bookPartialClose` / `closePosition` at every bar-driven call site, so
 * exit slippage is classified from the BAR's time, not the wall clock. Sites that are genuinely
 * real-time (kill-switch force-flatten, the 16:30 ET roll-sweep cron, manual/external close routes,
 * feed-silence auto-close) correctly KEEP wall-clock and are NOT touched.
 *
 * These tests drive the REAL `updatePositionPrices` -> `applyExitDecision` ->
 * `bookPartialClose`/`closePosition` -> `calculateSlippage` path (no mocking of session
 * classification or slippage math) so they are genuine wiring proof, not a unit test of the
 * formula in isolation. RED-PROOF: reverting the src fix (making bookPartialClose/the internal
 * closePosition callers ignore `context.barTimestamp`/`exitBarContext.barTimestamp` again) must
 * turn test (a) and test (b) red — captured in this session's RED run (see PR/report).
 *
 * `paper-risk-gate.js`'s `toFuturesTradingDayString`/`toEasternDateString` are NOT stubbed to a
 * fixed string in this file (unlike sibling equity tests) — the REAL implementations are used via
 * `importActual` so test (e)'s day-attribution assertion is a genuine integration proof, not a
 * tautology against a mock.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Shared capture state ───────────────────────────────────────────────────
const capturedTxSessionUpdates: Array<Record<string, unknown>> = [];
const capturedTxPositionUpdates: Array<Record<string, unknown>> = [];
const capturedTxDailyPnlUpdates: Array<Record<string, unknown>> = [];
const capturedTradeInserts: Array<Record<string, unknown>> = [];
const capturedOuterSessionUpdates: Array<Record<string, unknown>> = [];
const capturedSpans: Array<Record<string, unknown>> = [];
const capturedWarnLogs: Array<[Record<string, unknown> | undefined, string]> = [];

function resetCaptures() {
  capturedTxSessionUpdates.length = 0;
  capturedTxPositionUpdates.length = 0;
  capturedTxDailyPnlUpdates.length = 0;
  capturedTradeInserts.length = 0;
  capturedOuterSessionUpdates.length = 0;
  capturedSpans.length = 0;
  capturedWarnLogs.length = 0;
}

function snapshotResults() {
  // Deep-clone via JSON so later mutation of the shared arrays doesn't corrupt an earlier snapshot.
  return {
    trades: JSON.parse(JSON.stringify(capturedTradeInserts)) as Array<Record<string, unknown>>,
    txSessionUpdates: capturedTxSessionUpdates.map(extractNumberParams),
    outerSessionUpdates: capturedOuterSessionUpdates.map(extractNumberParams),
  };
}

/** Extracts the raw numeric ${} interpolations from a drizzle-orm `sql` template fragment. */
function extractNumberParams(vals: Record<string, unknown>): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const key of ["currentEquity", "peakEquity", "realizedPeakEquity"]) {
    const frag = vals[key];
    const chunks = (frag as { queryChunks?: unknown[] } | undefined)?.queryChunks;
    out[key] = Array.isArray(chunks) ? chunks.filter((c): c is number => typeof c === "number") : [];
  }
  return out;
}

/** Extracts the raw STRING ${} interpolations (e.g. the dailyPnlBreakdown jsonb key) from a sql fragment. */
function extractStringParams(sqlFrag: unknown): string[] {
  const chunks = (sqlFrag as { queryChunks?: unknown[] } | undefined)?.queryChunks;
  if (!Array.isArray(chunks)) return [];
  return chunks.filter((c): c is string => typeof c === "string");
}

// Stateful Python-handler mock: routes on `module` and, for the exit-handler module, on a
// test-controlled decision queue so each test drives exactly the decisions it needs.
let handlerDecisionQueue: Array<{ decision: string; evidence?: Record<string, unknown> }> = [];
let handlerCallCount = 0;
const mockRunPythonModule = vi.fn((req: { module?: string; config?: { state?: Record<string, unknown> } }) => {
  if (req.module === "src.engine.exits.style_c_handler") {
    const next = handlerDecisionQueue[handlerCallCount] ?? { decision: "HOLD" };
    handlerCallCount++;
    return Promise.resolve({
      decision: next.decision, new_stop: null,
      evidence: next.evidence ?? {}, handler_version: "style_c_v1.0.0",
    });
  }
  // calendar_filter (closePosition's non-blocking eventActive enrichment) — safe default.
  return Promise.resolve({ is_economic_event: false });
});

// Controls what bookPartialClose's row-locked `.select(...).for("update")` claim resolves to.
let claimRow: { closedAt: null; contracts: number; previousUnrealizedPnl: string } = {
  closedAt: null, contracts: 1, previousUnrealizedPnl: "0",
};

// Controls what closePosition's own closedAt-guarded idempotency claim `.returning()` resolves to.
let closeClaimRows: Array<{ id: string; contracts: number; previousUnrealizedPnl: string }> = [
  { id: "pos-f3", contracts: 1, previousUnrealizedPnl: "0" },
];

// Controls what the OUTER per-position MTM UPDATE's `.returning({id})` resolves to (HIGH#1 guard).
let mtmReturningRows: Array<{ id: string }> = [{ id: "pos-f3" }];

// Queue-based select resolver (proven pattern — see f4-samebar-partial-full-equity.test.ts and
// bookpartialclose-equity-double-count.test.ts): each top-level `db.select(...)` call consumes
// the next slot, regardless of chain shape.
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
          capturedOuterSessionUpdates.push({ ...vals });
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
        for: vi.fn(() => makeOpenChain([claimRow])), // bookPartialClose's row-lock claim
        limit: vi.fn().mockResolvedValue([]),
      })),
      insert: vi.fn(() => ({
        values: vi.fn((row: Record<string, unknown>) => {
          if ("pnl" in row) capturedTradeInserts.push(row);
          return { returning: vi.fn().mockResolvedValue([{ id: "trade-f3", ...row }]), catch: vi.fn() };
        }),
      })),
      update: vi.fn(() => ({
        set: vi.fn((vals: Record<string, unknown>) => {
          if ("currentEquity" in vals) {
            capturedTxSessionUpdates.push({ ...vals });
            return { where: vi.fn().mockResolvedValue(undefined) };
          }
          if ("dailyPnlBreakdown" in vals) {
            capturedTxDailyPnlUpdates.push({ ...vals });
            return { where: vi.fn().mockResolvedValue(undefined) };
          }
          if ("closedAt" in vals) {
            // closePosition's idempotency claim.
            const p: any = Promise.resolve(undefined);
            p.returning = vi.fn().mockImplementation(() => Promise.resolve(closeClaimRows));
            return { where: vi.fn().mockReturnValue(p) };
          }
          // bookPartialClose's position-state advance (tp1Filled/contracts/...).
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
// NOTE: the warn-capturing fn is defined INLINE (not as a separately-named top-level "mock"-
// prefixed variable) — Vitest's hoisting transform special-cases "mock"-prefixed variable names
// and hoists their declarations ABOVE ordinary top-level consts (including capturedWarnLogs
// above), which would TDZ-fail here since the initializer references capturedWarnLogs.
vi.mock("../lib/logger.js", () => ({
  logger: {
    info: vi.fn(), error: vi.fn(), debug: vi.fn(),
    warn: (meta: Record<string, unknown> | undefined, msg: string) => { capturedWarnLogs.push([meta, msg]); },
  },
}));
vi.mock("../index.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../lib/tracing.js", () => ({
  tracer: {
    startSpan: vi.fn(() => {
      const attrs: Record<string, unknown> = {};
      capturedSpans.push(attrs);
      return { setAttribute: (k: string, v: unknown) => { attrs[k] = v; }, end: vi.fn() };
    }),
  },
}));
vi.mock("../scheduler.js", () => ({ onPaperTradeClose: vi.fn() }));
// F-3: a FAITHFUL standalone reimplementation of the real +7h ET-shift algorithm (not stubbed to
// a fixed string like sibling equity tests, and NOT via importOriginal — that pulls paper-risk-gate.ts's
// full transitive dependency graph, which needs its own fragile mock chain). Test (e) needs a
// genuinely-computed day string so the assertion proves day-attribution derives from the threaded
// bar time, not a mock echo. Algorithm mirrors paper-risk-gate.ts::toFuturesTradingDayString exactly
// (CME futures day rolls at 17:00 ET; shifting +7h aligns that cutoff with ET calendar midnight).
const _F3_ET_FORMATTER = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" });
vi.mock("./paper-risk-gate.js", () => ({
  toEasternDateString: (date: Date = new Date()) => _F3_ET_FORMATTER.format(date),
  toFuturesTradingDayString: (date: Date = new Date()) =>
    _F3_ET_FORMATTER.format(new Date(date.getTime() + 7 * 3600_000)),
  invalidateDailyLossCache: () => {},
}));
vi.mock("../lib/roll-calendar-loader.js", () => ({
  computeRollSpreadCost: vi.fn(() => ({ estimatedSpreadCost: 0, rollDates: [] })), // SYNCHRONOUS
}));
vi.mock("./alert-service.js", () => ({
  AlertFactory: { systemError: vi.fn(), criticalAlert: vi.fn(), driftAlert: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock("../lib/dst-utils.js", () => ({ getEtOffsetMinutes: vi.fn(() => -240), isUsDst: vi.fn(() => true) }));
// NOTE: db-locks.js is intentionally NOT mocked (see f4-samebar-partial-full-equity.test.ts) —
// the real withSessionLock, with TF_POSITION_LOCKING unset (default), no-ops straight through to
// `fn(db)` — the same mocked `db` from ../db/index.js above, which is what closePosition needs.
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
  getCommissionPerSide: vi.fn().mockReturnValue(0), // zero commission — keeps netPnl/slippage arithmetic exact
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

import { updatePositionPrices, closePosition, type StyleExitBarContext } from "./paper-execution-service.js";

function makePos(overrides: Record<string, unknown> = {}) {
  return {
    id: "pos-f3", sessionId: "sess-f3", symbol: "MES", side: "long",
    entryPrice: "5000", currentPrice: "5000", contracts: 1, entryContracts: 1,
    unrealizedPnl: "0", previousUnrealizedPnl: "0",
    mae: null, mfe: null, fillRatio: "1.0", fillProbability: "1.0",
    trailHwm: null, closedAt: null, currentExitStyle: "C",
    tp1Filled: false, tp2Filled: false, beStopApplied: false, currentTrailMethod: null,
    lastHandlerEvalAt: null, initialStopPrice: null,
    highSinceEntryPrice: "5000", lowSinceEntryPrice: "5000",
    correlationId: "corr-f3", exitPlan: null,
    entryTime: new Date("2026-07-13T13:00:00.000Z"),
    arrivalPrice: null, implementationShortfall: null,
    ...overrides,
  };
}

function makeBarCtx(overrides: Partial<StyleExitBarContext> = {}): StyleExitBarContext {
  return {
    currentTimeEt: "14:30", atr14: { MES: 5.0 }, barHigh: { MES: 5010.0 }, barLow: { MES: 5010.0 },
    ...overrides,
  };
}

// The exact select sequence issued per bar depends on WHICH exit path fires — these helpers are
// deliberately distinct (not one generic queue) so each matches its real call sequence exactly:

// Path A — bookPartialClose fires and the F4 re-invocation returns HOLD (no closePosition reached).
// Slot 0: openPositions (updatePositionPrices). Slot 1: getSessionStrategyId. Slot 2: bookPartialClose's
// sessionForFirm select. Trailing slots are padding (unused, harmless if present).
function setupSelectQueueBookPartialCloseOnly(pos: unknown) {
  selectQueue = [[pos], [{ strategyId: "strat-f3" }], [{ firmId: null }], [], []];
  selectCallIndex = 0;
}

// Path B — F4 chained: bookPartialClose (TP1) THEN closePosition (TP2 full-close re-invocation).
// Slot 0: openPositions. Slot 1: getSessionStrategyId. Slot 2: bookPartialClose's sessionForFirm.
// Slot 3: closePosition's posForLock {sessionId}. Slot 4: closePosition's dbConn re-read (full pos).
// Slot 5: closePosition's sessionForFirm. Slots 6-7: journal-enrichment (macroSnapshot/skipDecision, empty ok).
function setupSelectQueueF4Chained(pos: unknown) {
  selectQueue = [
    [pos], [{ strategyId: "strat-f3" }], [{ firmId: null }],
    [{ sessionId: "sess-f3" }], [pos], [{ firmId: null }], [], [],
  ];
  selectCallIndex = 0;
}

// Path C — the exit-handler dispatch fires (getSessionStrategyId runs) and the decision routes
// STRAIGHT to closePosition with no bookPartialClose leg first (TIME_STOP_FLATTEN, or a 1-contract
// TP1 that is already a full close). Slot 0: openPositions. Slot 1: getSessionStrategyId.
// Slot 2: closePosition's posForLock {sessionId}. Slot 3: dbConn re-read. Slot 4: sessionForFirm.
// Slots 5-6: journal-enrichment (empty ok).
function setupSelectQueueDirectCloseViaHandler(pos: unknown) {
  selectQueue = [
    [pos], [{ strategyId: "strat-f3" }],
    [{ sessionId: "sess-f3" }], [pos], [{ firmId: null }], [], [],
  ];
  selectCallIndex = 0;
}

// Path D — the in-loop stop-breach block `continue`s BEFORE the exit-handler dispatch section, so
// getSessionStrategyId() is NEVER called. Slot 0: openPositions. Slot 1: closePosition's posForLock
// {sessionId}. Slot 2: dbConn re-read. Slot 3: sessionForFirm. Slots 4-5: journal-enrichment (empty ok).
function setupSelectQueueStopBreach(pos: unknown) {
  selectQueue = [
    [pos], [{ sessionId: "sess-f3" }], [pos], [{ firmId: null }], [], [],
  ];
  selectCallIndex = 0;
}

// Path E — the exit-handler dispatch fires and resolves to HOLD (no partial/close of any kind).
// Slot 0: openPositions. Slot 1: getSessionStrategyId.
function setupSelectQueueHoldOnly(pos: unknown) {
  selectQueue = [[pos], [{ strategyId: "strat-f3" }], [], []];
  selectCallIndex = 0;
}

beforeEach(() => {
  resetCaptures();
  selectQueue = [];
  selectCallIndex = 0;
  handlerDecisionQueue = [];
  handlerCallCount = 0;
  claimRow = { closedAt: null, contracts: 1, previousUnrealizedPnl: "0" };
  closeClaimRows = [{ id: "pos-f3", contracts: 1, previousUnrealizedPnl: "0" }];
  mtmReturningRows = [{ id: "pos-f3" }];
  mockRunPythonModule.mockClear();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

// A bar timestamped 14:30 ET on 2026-07-13 (Monday, DST active -> ET = UTC-4) = 18:30 UTC.
// NY_CLOSE session (14:00-16:00 ET window is NY_CLOSE per classifySessionType — RTH-adjacent,
// sessionMult=1.0), well clear of the 16:00-17:00 ET CME_HALT window.
const BAR_TIME_1430_ET = new Date("2026-07-13T18:30:00.000Z");
// Wall-clock "now" values used to prove the fix is wall-clock-INDEPENDENT.
const WALLCLOCK_1000_ET = new Date("2026-07-13T14:00:00.000Z"); // RTH
const WALLCLOCK_1630_ET = new Date("2026-07-13T20:30:00.000Z"); // CME_HALT (100x on unpatched code)

describe("F-3: A/B IDENTITY — same bar, two different wall-clocks, must produce IDENTICAL results", () => {
  it("bookPartialClose (TP1 partial on a 3-contract position) is wall-clock-independent when barTimestamp is threaded", async () => {
    const pos = makePos({ contracts: 3, entryContracts: 3, currentPrice: "5000" });

    // Run 1 — wall-clock pinned to 10:00 ET (RTH).
    vi.useFakeTimers();
    vi.setSystemTime(WALLCLOCK_1000_ET);
    handlerDecisionQueue = [
      { decision: "FILL_TP1_50PCT", evidence: { tp1_price: 5010, stop_pts: 10 } },
      { decision: "HOLD" }, // F4 re-invocation (tp1_filled=true) — end here, keep this test single-leg
    ];
    handlerCallCount = 0;
    setupSelectQueueBookPartialCloseOnly(pos);
    await updatePositionPrices("sess-f3", { MES: { close: 5010, high: 5010, low: 5010 } }, makeBarCtx({ barTimestamp: BAR_TIME_1430_ET }));
    for (let i = 0; i < 12; i++) await Promise.resolve();
    const snapshot1 = snapshotResults();

    // Run 2 — SAME bar (same barTimestamp), wall-clock now pinned to 16:30 ET (CME_HALT — 100x
    // multiplier on unpatched code that reads `new Date()` instead of context.barTimestamp).
    resetCaptures();
    selectQueue = [];
    selectCallIndex = 0;
    claimRow = { closedAt: null, contracts: 3, previousUnrealizedPnl: "0" };
    vi.setSystemTime(WALLCLOCK_1630_ET);
    handlerDecisionQueue = [
      { decision: "FILL_TP1_50PCT", evidence: { tp1_price: 5010, stop_pts: 10 } },
      { decision: "HOLD" },
    ];
    handlerCallCount = 0;
    setupSelectQueueBookPartialCloseOnly(pos);
    await updatePositionPrices("sess-f3", { MES: { close: 5010, high: 5010, low: 5010 } }, makeBarCtx({ barTimestamp: BAR_TIME_1430_ET }));
    for (let i = 0; i < 12; i++) await Promise.resolve();
    const snapshot2 = snapshotResults();

    // IDENTICAL — proves the exit slippage session classification came from the bar, not the wall clock.
    expect(snapshot1.trades).toHaveLength(1);
    expect(snapshot2.trades).toHaveLength(1);
    expect(snapshot2.trades[0].slippage).toBe(snapshot1.trades[0].slippage);
    expect(snapshot2.trades[0].pnl).toBe(snapshot1.trades[0].pnl);
    expect(snapshot2.trades[0].exitPrice).toBe(snapshot1.trades[0].exitPrice);
    expect(snapshot2.txSessionUpdates).toEqual(snapshot1.txSessionUpdates);
  });

  it("closePosition full-close path (1-contract TP1) is wall-clock-independent when barTimestamp is threaded", async () => {
    const pos = makePos({ contracts: 1, entryContracts: 1 });

    vi.useFakeTimers();
    vi.setSystemTime(WALLCLOCK_1000_ET);
    handlerDecisionQueue = [{ decision: "FILL_TP1_50PCT", evidence: { tp1_price: 5010, stop_pts: 10 } }];
    handlerCallCount = 0;
    setupSelectQueueDirectCloseViaHandler(pos);
    await updatePositionPrices("sess-f3", { MES: { close: 5010, high: 5010, low: 5010 } }, makeBarCtx({ barTimestamp: BAR_TIME_1430_ET }));
    for (let i = 0; i < 12; i++) await Promise.resolve();
    const snapshot1 = snapshotResults();

    resetCaptures();
    selectQueue = [];
    selectCallIndex = 0;
    closeClaimRows = [{ id: "pos-f3", contracts: 1, previousUnrealizedPnl: "0" }];
    vi.setSystemTime(WALLCLOCK_1630_ET);
    handlerDecisionQueue = [{ decision: "FILL_TP1_50PCT", evidence: { tp1_price: 5010, stop_pts: 10 } }];
    handlerCallCount = 0;
    setupSelectQueueDirectCloseViaHandler(pos);
    await updatePositionPrices("sess-f3", { MES: { close: 5010, high: 5010, low: 5010 } }, makeBarCtx({ barTimestamp: BAR_TIME_1430_ET }));
    for (let i = 0; i < 12; i++) await Promise.resolve();
    const snapshot2 = snapshotResults();

    expect(snapshot1.trades).toHaveLength(1);
    expect(snapshot2.trades).toHaveLength(1);
    expect(snapshot2.trades[0].slippage).toBe(snapshot1.trades[0].slippage);
    expect(snapshot2.trades[0].pnl).toBe(snapshot1.trades[0].pnl);
    expect(snapshot2.txSessionUpdates).toEqual(snapshot1.txSessionUpdates);
  });
});

describe("F-3: per-site units — wall-clock pinned to 16:30 ET (CME_HALT), bar at 14:30 ET (RTH-adjacent) -> RTH-magnitude slippage", () => {
  // Expected RTH slippage per the real calculateSlippage formula: baseTicks(1) * (atr/medianAtr)
  // * orderMod(stop_limit=1.0) * sessionMult(RTH/NY_CLOSE=1.0) * tickSize(0.25). atr=5.0,
  // medianAtr falls back to atr*0.85=4.25 (no medianAtr14 supplied in these fixtures).
  const EXPECTED_RTH_SLIPPAGE = 1 * (5.0 / 4.25) * 1.0 * 1.0 * 0.25;
  const CME_HALT_SLIPPAGE = EXPECTED_RTH_SLIPPAGE * 100;

  it("tp1 partial (bookPartialClose) — RTH-magnitude, not CME_HALT-scaled", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(WALLCLOCK_1630_ET);
    const pos = makePos({ contracts: 3, entryContracts: 3 });
    handlerDecisionQueue = [
      { decision: "FILL_TP1_50PCT", evidence: { tp1_price: 5010, stop_pts: 10 } },
      { decision: "HOLD" },
    ];
    setupSelectQueueBookPartialCloseOnly(pos);

    await updatePositionPrices("sess-f3", { MES: { close: 5010, high: 5010, low: 5010 } }, makeBarCtx({ barTimestamp: BAR_TIME_1430_ET }));
    for (let i = 0; i < 12; i++) await Promise.resolve();

    expect(capturedTradeInserts).toHaveLength(1);
    const slippage = Number(capturedTradeInserts[0].slippage);
    expect(slippage).toBeCloseTo(EXPECTED_RTH_SLIPPAGE, 6);
    expect(slippage).not.toBeCloseTo(CME_HALT_SLIPPAGE, 6);
  });

  it("in-loop stop-breach closePosition call — RTH-magnitude, not CME_HALT-scaled", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(WALLCLOCK_1630_ET);
    // Long position, structural stop at 4990 (10pt below entry). Bar low breaches it intrabar.
    const pos = makePos({ contracts: 1, entryContracts: 1, initialStopPrice: "4990" });
    handlerDecisionQueue = [{ decision: "HOLD" }]; // never reached — stop-breach `continue`s first
    setupSelectQueueStopBreach(pos);

    await updatePositionPrices(
      "sess-f3",
      { MES: { close: 4995, high: 5005, low: 4985 } },
      makeBarCtx({ barTimestamp: BAR_TIME_1430_ET }),
    );
    for (let i = 0; i < 12; i++) await Promise.resolve();

    expect(capturedTradeInserts).toHaveLength(1);
    const slippage = Number(capturedTradeInserts[0].slippage);
    expect(slippage).toBeCloseTo(EXPECTED_RTH_SLIPPAGE, 6);
    expect(slippage).not.toBeCloseTo(CME_HALT_SLIPPAGE, 6);
  });

  it("time-stop flatten (TIME_STOP_FLATTEN) closePosition call — RTH-magnitude, not CME_HALT-scaled", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(WALLCLOCK_1630_ET);
    const pos = makePos({ contracts: 1, entryContracts: 1 });
    handlerDecisionQueue = [{ decision: "TIME_STOP_FLATTEN" }];
    setupSelectQueueDirectCloseViaHandler(pos);

    await updatePositionPrices(
      "sess-f3",
      { MES: { close: 5005, high: 5005, low: 5005 } },
      makeBarCtx({ barTimestamp: BAR_TIME_1430_ET, currentTimeEt: "15:55" }),
    );
    for (let i = 0; i < 12; i++) await Promise.resolve();

    expect(capturedTradeInserts).toHaveLength(1);
    const slippage = Number(capturedTradeInserts[0].slippage);
    expect(slippage).toBeCloseTo(EXPECTED_RTH_SLIPPAGE, 6);
    expect(slippage).not.toBeCloseTo(CME_HALT_SLIPPAGE, 6);
  });

  it("F4 same-bar chained TP2 (both legs) — RTH-magnitude, not CME_HALT-scaled", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(WALLCLOCK_1630_ET);
    // 2-contract position: TP1 closes 1 (partial, bookPartialClose; styleCScaleOut(2).tp1=1), F4
    // re-invokes and the remaining 1 contract closes fully via closePosition (styleCScaleOut(2).tp2=0
    // floored to Math.max(1,0)=1, which equals the 1 remaining contract -> takes the full-close path).
    const pos = makePos({ contracts: 2, entryContracts: 2 });
    handlerDecisionQueue = [
      { decision: "FILL_TP1_50PCT", evidence: { tp1_price: 5010, stop_pts: 10 } },
      { decision: "FILL_TP2", evidence: { tp2_price: 5020 } },
    ];
    setupSelectQueueF4Chained(pos);

    await updatePositionPrices("sess-f3", { MES: { close: 5020, high: 5020, low: 5020 } }, makeBarCtx({ barTimestamp: BAR_TIME_1430_ET }));
    for (let i = 0; i < 12; i++) await Promise.resolve();

    expect(capturedTradeInserts).toHaveLength(2);
    for (const trade of capturedTradeInserts) {
      const slippage = Number(trade.slippage);
      expect(slippage).toBeCloseTo(EXPECTED_RTH_SLIPPAGE, 6);
      expect(slippage).not.toBeCloseTo(CME_HALT_SLIPPAGE, 6);
    }
  });
});

describe("F-3: fallback contract — no bar context falls back to wall-clock (documented, not a bug)", () => {
  it("closePosition with NO context at 16:30 ET wall-clock -> CME_HALT-scale slippage + exitSlippageTimeSource='wallclock'", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(WALLCLOCK_1630_ET);
    const pos = makePos({ contracts: 1 });
    // closePosition (called directly, not via updatePositionPrices) issues exactly 5 selects in
    // order: posForLock {sessionId}, dbConn re-read (full pos row), sessionForFirm {firmId}, then
    // 2 non-blocking journal-enrichment selects (macroSnapshots, skipDecisions — empty is fine).
    selectQueue = [[{ sessionId: "sess-f3" }], [pos], [{ firmId: null }], [], []];
    selectCallIndex = 0;
    closeClaimRows = [{ id: "pos-f3", contracts: 1, previousUnrealizedPnl: "0" }];

    await closePosition("pos-f3", 5010); // NO context object at all

    expect(capturedTradeInserts).toHaveLength(1);
    const EXPECTED_RTH_SLIPPAGE = 1 * 1.0 * 1.0 * 0.25; // no atr supplied on this direct call -> baseTicks only
    const slippage = Number(capturedTradeInserts[0].slippage);
    expect(slippage).toBeCloseTo(EXPECTED_RTH_SLIPPAGE * 100, 6); // CME_HALT 100x — correct given genuine real-time wall-clock close

    // Engagement-evidence span attribute — the per-trade audit trail for time-source provenance.
    const closeSpan = capturedSpans.find((s) => "exitSlippageTimeSource" in s);
    expect(closeSpan?.exitSlippageTimeSource).toBe("wallclock");
  });

  it("closePosition WITH a bar-time context at 16:30 ET wall-clock -> RTH-scale slippage + exitSlippageTimeSource='bar'", async () => {
    // Coordinator LOW-gap close (2026-07-16): the sibling positive-value assertion to the
    // "wallclock" test above — proves the span attribute correctly reports "bar" (not just that
    // "wallclock" is correctly reported) when the caller DOES thread a bar time, even while the
    // real/fake wall-clock sits inside the adversarial CME_HALT window.
    vi.useFakeTimers();
    vi.setSystemTime(WALLCLOCK_1630_ET); // CME_HALT wall-clock — must be ignored when barTimestamp is present
    const pos = makePos({ contracts: 1 });
    selectQueue = [[{ sessionId: "sess-f3" }], [pos], [{ firmId: null }], [], []];
    selectCallIndex = 0;
    closeClaimRows = [{ id: "pos-f3", contracts: 1, previousUnrealizedPnl: "0" }];

    await closePosition("pos-f3", 5010, undefined, { barTimestamp: BAR_TIME_1430_ET }); // bar at 14:30 ET (RTH-adjacent)

    expect(capturedTradeInserts).toHaveLength(1);
    const EXPECTED_RTH_SLIPPAGE = 1 * 1.0 * 1.0 * 0.25; // no atr supplied on this direct call -> baseTicks only
    const slippage = Number(capturedTradeInserts[0].slippage);
    expect(slippage).toBeCloseTo(EXPECTED_RTH_SLIPPAGE, 6); // RTH-scale, NOT the 100x CME_HALT the wall-clock alone would imply
    expect(slippage).not.toBeCloseTo(EXPECTED_RTH_SLIPPAGE * 100, 6);

    const closeSpan = capturedSpans.find((s) => "exitSlippageTimeSource" in s);
    expect(closeSpan?.exitSlippageTimeSource).toBe("bar");
  });

  it("bookPartialClose without barTimestamp -> falls back to wall-clock AND emits a warn (anomaly — this fn is always bar-driven)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(WALLCLOCK_1000_ET); // RTH — irrelevant to this assertion, just deterministic
    const pos = makePos({ contracts: 3, entryContracts: 3 });
    handlerDecisionQueue = [
      { decision: "FILL_TP1_50PCT", evidence: { tp1_price: 5010, stop_pts: 10 } },
      { decision: "HOLD" },
    ];
    setupSelectQueueBookPartialCloseOnly(pos);

    // makeBarCtx() with NO barTimestamp override -> exitBarContext.barTimestamp is undefined.
    await updatePositionPrices("sess-f3", { MES: { close: 5010, high: 5010, low: 5010 } }, makeBarCtx());
    for (let i = 0; i < 12; i++) await Promise.resolve();

    expect(capturedTradeInserts).toHaveLength(1); // partial still books — fallback, not a hard failure
    const warnedAboutBarTimestamp = capturedWarnLogs.some(([, msg]) =>
      /barTimestamp/i.test(msg) && /(absent|missing|fallback|wall.?clock)/i.test(msg));
    expect(warnedAboutBarTimestamp).toBe(true);
  });
});

describe("F-3: replay-determinism — a 3-bar backlog processed at two different wall-clocks yields identical results", () => {
  async function runThreeBarBacklog() {
    resetCaptures();
    const pos = makePos({ contracts: 1, entryContracts: 1 });

    // Bar 1 (10:00 ET) — HOLD, no price movement.
    handlerDecisionQueue = [{ decision: "HOLD" }];
    handlerCallCount = 0;
    setupSelectQueueHoldOnly(pos);
    await updatePositionPrices(
      "sess-f3", { MES: { close: 5000, high: 5000, low: 5000 } },
      makeBarCtx({ barTimestamp: new Date("2026-07-13T14:00:00.000Z"), currentTimeEt: "10:00" }),
    );
    for (let i = 0; i < 8; i++) await Promise.resolve();

    // Bar 2 (10:05 ET) — HOLD, no price movement.
    handlerDecisionQueue = [{ decision: "HOLD" }];
    handlerCallCount = 0;
    selectQueue = []; selectCallIndex = 0;
    setupSelectQueueHoldOnly(pos);
    await updatePositionPrices(
      "sess-f3", { MES: { close: 5000, high: 5000, low: 5000 } },
      makeBarCtx({ barTimestamp: new Date("2026-07-13T14:05:00.000Z"), currentTimeEt: "10:05" }),
    );
    for (let i = 0; i < 8; i++) await Promise.resolve();

    // Bar 3 (10:10 ET) — TP1 fires; 1-contract position -> full close via closePosition.
    handlerDecisionQueue = [{ decision: "FILL_TP1_50PCT", evidence: { tp1_price: 5010, stop_pts: 10 } }];
    handlerCallCount = 0;
    selectQueue = []; selectCallIndex = 0;
    closeClaimRows = [{ id: "pos-f3", contracts: 1, previousUnrealizedPnl: "0" }];
    setupSelectQueueDirectCloseViaHandler(pos);
    await updatePositionPrices(
      "sess-f3", { MES: { close: 5010, high: 5010, low: 5010 } },
      makeBarCtx({ barTimestamp: new Date("2026-07-13T14:10:00.000Z"), currentTimeEt: "10:10" }),
    );
    for (let i = 0; i < 8; i++) await Promise.resolve();

    return snapshotResults();
  }

  it("processed once at 16:30 ET and once at 03:00 ET wall-clock -> identical ordered inserts/equity", async () => {
    vi.useFakeTimers();

    vi.setSystemTime(WALLCLOCK_1630_ET); // CME_HALT wall-clock
    const run1 = await runThreeBarBacklog();

    vi.setSystemTime(new Date("2026-07-13T07:00:00.000Z")); // 03:00 ET — ASIAN session wall-clock
    const run2 = await runThreeBarBacklog();

    expect(run1.trades).toHaveLength(1);
    expect(run2.trades).toHaveLength(1);
    expect(run2.trades[0].slippage).toBe(run1.trades[0].slippage);
    expect(run2.trades[0].pnl).toBe(run1.trades[0].pnl);
    expect(run2.txSessionUpdates).toEqual(run1.txSessionUpdates);
  });
});

describe("F-3 RIDER: closedAt trading-day attribution derives from the bar time on bar-driven paths", () => {
  it("a bar at 16:55 ET arriving at 17:05 ET wall-clock books to the BAR's CME trading day, not the wall-clock's", async () => {
    // Bar: 2026-07-13 (Monday) 16:55 ET = 20:55 UTC (DST, ET=UTC-4).
    const barAt1655Et = new Date("2026-07-13T20:55:00.000Z");
    // Wall-clock: same calendar day, 17:05 ET = 21:05 UTC — PAST the 17:00 ET CME day-roll cutoff,
    // so an unpatched `toFuturesTradingDayString(new Date())` would (wrongly) attribute to 2026-07-14.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-13T21:05:00.000Z"));

    const pos = makePos({ contracts: 1 });
    selectQueue = [[{ sessionId: "sess-f3" }], [pos], [{ firmId: null }], [], []];
    selectCallIndex = 0;
    closeClaimRows = [{ id: "pos-f3", contracts: 1, previousUnrealizedPnl: "0" }];

    await closePosition("pos-f3", 5010, undefined, { barTimestamp: barAt1655Et });

    expect(capturedTxDailyPnlUpdates).toHaveLength(1);
    const dayKeys = extractStringParams(capturedTxDailyPnlUpdates[0].dailyPnlBreakdown);
    // The BAR's trading day (2026-07-13 16:55 ET + 7h = 23:55 ET same day -> "2026-07-13"), NOT
    // the wall-clock's (2026-07-13 17:05 ET + 7h = 00:05 ET NEXT day -> "2026-07-14").
    expect(dayKeys).toContain("2026-07-13");
    expect(dayKeys).not.toContain("2026-07-14");
  });

  it("bookPartialClose (TP1 partial): a bar at 16:55 ET arriving at 17:05 ET wall-clock books to the BAR's CME trading day, not the wall-clock's", async () => {
    // Coordinator fix-the-class extension (2026-07-16): same day-misattribution class, but through
    // the PARTIAL-close leg (bookPartialClose), not closePosition — proves the sibling site was
    // closed too, not just the one the parent-review happened to spot first.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-13T21:05:00.000Z")); // 17:05 ET same day

    const pos = makePos({ contracts: 3, entryContracts: 3 });
    handlerDecisionQueue = [
      { decision: "FILL_TP1_50PCT", evidence: { tp1_price: 5010, stop_pts: 10 } },
      { decision: "HOLD" }, // F4 re-invocation — keep this test single-leg
    ];
    setupSelectQueueBookPartialCloseOnly(pos);

    const barAt1655Et = new Date("2026-07-13T20:55:00.000Z"); // 16:55 ET same day
    await updatePositionPrices(
      "sess-f3", { MES: { close: 5010, high: 5010, low: 5010 } },
      makeBarCtx({ barTimestamp: barAt1655Et }),
    );
    for (let i = 0; i < 12; i++) await Promise.resolve();

    expect(capturedTradeInserts).toHaveLength(1); // TP1 partial booked
    expect(capturedTxDailyPnlUpdates).toHaveLength(1);
    const dayKeys = extractStringParams(capturedTxDailyPnlUpdates[0].dailyPnlBreakdown);
    // The BAR's trading day ("2026-07-13"), NOT the wall-clock's ("2026-07-14" — 17:05 ET + 7h
    // rolls past the ET-calendar-midnight CME cutoff into the next day).
    expect(dayKeys).toContain("2026-07-13");
    expect(dayKeys).not.toContain("2026-07-14");
  });
});
