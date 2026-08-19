/**
 * m3-sibling-stop-behavioral.test.ts — M3-core: PAPER Authority Flip
 * (2026-07-17), independent-grader Discrepancy F-2 closure.
 *
 * THE GAP THE GRADER FOUND: every existing test that references the M3
 * sibling-stop block (`lifecycle-service.ts` ~3433-3468, "if (fromState ===
 * 'PAPER' && isBrokerAuthoritativeState(toState))") is a static
 * `readFileSync` + string-match check (`deepscan14-shadow-stage.test.ts`,
 * `lifecycle-b3-b6-archetype-gate-stop-race.test.ts`) — none of them drive
 * the REAL `_promoteStrategyInner` (via the public `promoteStrategy()`) with
 * a mocked DB to confirm `stopStream()` is actually invoked with the correct
 * session on a genuine PAPER → DEPLOY_READY transition. The grader RED-proofed
 * this by silently breaking the block's own `paperSessions` WHERE-clause
 * status filter (`"active"` → a typo) and found zero test failures — the bug
 * would have been completely invisible in production (the sibling stream
 * would keep running past DEPLOY_READY, the exact double-writer hazard this
 * wave exists to close, just silently un-caught).
 *
 * WHY THE DB MOCK IS FILTER-AWARE FOR paperSessions (not the ignore-everything
 * table-routing style used by gate3-manual-precondition-wiring.test.ts, whose
 * pattern this file otherwise borrows): a naive table-routed mock that returns
 * whatever rows were seeded for `paperSessions` REGARDLESS of the WHERE clause
 * passed in would NOT have caught the grader's exact regression (a typo'd
 * status-string literal) — the mock would return the same row whether the
 * code filtered on "active" or on a typo. To make this test's RED-proof
 * meaningful, `drizzle-orm`'s `eq`/`and` are mocked to return inspectable
 * condition objects, and this file's `paperSessions` select handler
 * genuinely evaluates the `eq(paperSessions.status, <value>)` condition
 * against the seeded row's actual status — a status-string typo in
 * production code makes the mock correctly return zero rows, exactly
 * mirroring what a real Postgres WHERE clause would do.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── drizzle-orm: return INSPECTABLE condition objects (not opaque markers) ──
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((col: unknown, val: unknown) => ({ __op: "eq", col, val })),
  and: vi.fn((...conds: unknown[]) => ({ __op: "and", conds })),
  gte: vi.fn((col: unknown, val: unknown) => ({ __op: "gte", col, val })),
  lte: vi.fn((col: unknown, val: unknown) => ({ __op: "lte", col, val })),
  desc: vi.fn((col: unknown) => ({ __op: "desc", col })),
  asc: vi.fn((col: unknown) => ({ __op: "asc", col })),
  inArray: vi.fn(), isNull: vi.fn(), isNotNull: vi.fn(), min: vi.fn(),
  sql: Object.assign(vi.fn(), { raw: vi.fn() }),
  notInArray: vi.fn(),
}));

// ─── db mock: table-aware routing, but paperSessions genuinely filters ──────
vi.mock("../../db/index.js", () => {
  const routes = new Map<unknown, Record<string, unknown>[]>();
  const insertedRows: { table: unknown; row: Record<string, unknown> }[] = [];
  const updateReturning: Record<string, unknown>[] = [{}];
  // AR-1346A S4: the TESTING→PAPER gate chain (WFE/PBO/B14/DSR/exportability/...)
  // issues many sequential db.select() calls of different shapes against the SAME
  // tables the sibling-stop tests table-route by identity — a per-table route
  // cannot disambiguate "the 3rd select against backtests" from the 1st. When a
  // FIFO queue is armed via __setSelectQueue, it takes priority over table
  // routing for EVERY select() call; sibling-stop's existing tests never arm it,
  // so their table-routing behavior is unchanged.
  let selectQueueActive = false;
  const selectQueue: unknown[] = [];
  let paperSessionsTableRef: unknown;
  // Real column object REFERENCES (not string names) — registered by the test
  // file at beforeEach-time via __setPaperSessionsColumns, since schema.js is
  // NOT mocked here and the real `paperSessions.strategyId`/`.status` column
  // proxies are the exact objects the mocked `eq()` call below receives.
  let strategyIdColRef: unknown;
  let statusColRef: unknown;

  function conditionMatchesRow(condition: unknown, row: Record<string, unknown>): boolean {
    if (!condition || typeof condition !== "object") return true;
    const c = condition as { __op?: string; conds?: unknown[]; col?: unknown; val?: unknown };
    if (c.__op === "and") return (c.conds ?? []).every((sub) => conditionMatchesRow(sub, row));
    if (c.__op === "eq") {
      if (strategyIdColRef !== undefined && c.col === strategyIdColRef) return row.strategyId === c.val;
      if (statusColRef !== undefined && c.col === statusColRef) return row.status === c.val;
      return true; // unrecognized column reference — don't false-negative on unrelated filters
    }
    return true;
  }

  function makeSelectChain(table: unknown | undefined, whereCondition?: unknown) {
    const isPaperSessions = table === paperSessionsTableRef;
    const resolveRows = () => {
      if (selectQueueActive) return selectQueue.shift() ?? [];
      const seeded = table !== undefined ? routes.get(table) ?? [] : [];
      if (isPaperSessions && whereCondition) {
        return seeded.filter((row) => conditionMatchesRow(whereCondition, row));
      }
      return seeded;
    };
    const chain: Record<string, unknown> = {
      from: (t: unknown) => makeSelectChain(t, whereCondition),
      innerJoin: () => chain,
      leftJoin: () => chain,
      where: (cond: unknown) => makeSelectChain(table, cond),
      orderBy: () => chain,
      groupBy: () => chain,
      limit: () => Promise.resolve(resolveRows()),
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(resolveRows()).then(resolve, reject),
      catch: (reject: (e: unknown) => unknown) => Promise.resolve(resolveRows()).catch(reject),
    };
    return chain;
  }

  const dbMock: Record<string, unknown> = {
    select: (_cols?: unknown) => makeSelectChain(undefined),
    insert: (table: unknown) => ({
      values: (row: Record<string, unknown> | Record<string, unknown>[]) => {
        const rows = Array.isArray(row) ? row : [row];
        for (const r of rows) insertedRows.push({ table, row: r });
        return Promise.resolve([]);
      },
    }),
    update: (_table: unknown) => ({
      set: (_vals: Record<string, unknown>) => ({
        where: (_cond: unknown) => ({
          returning: (_sel?: unknown) => Promise.resolve(updateReturning),
        }),
      }),
    }),
    transaction: async (cb: (tx: unknown) => Promise<void>) => {
      await cb(dbMock);
    },
    __setRows: (table: unknown, rows: Record<string, unknown>[]) => routes.set(table, rows),
    __setPaperSessionsTableRef: (table: unknown) => { paperSessionsTableRef = table; },
    __setPaperSessionsColumns: (cols: { strategyId: unknown; status: unknown }) => {
      strategyIdColRef = cols.strategyId;
      statusColRef = cols.status;
    },
    __insertedRows: insertedRows,
    __setUpdateReturning: (rows: Record<string, unknown>[]) => {
      updateReturning.length = 0;
      updateReturning.push(...rows);
    },
    __setSelectQueue: (items: unknown[]) => {
      selectQueueActive = true;
      selectQueue.length = 0;
      selectQueue.push(...items);
    },
    __reset: () => {
      routes.clear();
      insertedRows.length = 0;
      selectQueueActive = false;
      selectQueue.length = 0;
    },
  };

  return { db: dbMock };
});

vi.mock("../../routes/sse.js", () => {
  const echoProxy = new Proxy({}, { get: (_t, prop: string) => prop });
  return { broadcastSSE: vi.fn(), LIFECYCLE_GATE_EVENTS: echoProxy, WAVE29_EVENTS: echoProxy };
});
vi.mock("../../lib/tracing.js", () => {
  const span = { setAttribute: vi.fn(), end: vi.fn() };
  return { tracer: { startSpan: vi.fn().mockReturnValue(span) }, OTEL_AVAILABLE: false };
});
vi.mock("../../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../index.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../evolution-service.js", () => ({ evolveStrategy: vi.fn().mockResolvedValue({ success: true }) }));
vi.mock("../alert-service.js", () => ({
  AlertFactory: {
    deployReady: vi.fn().mockResolvedValue(undefined),
    decayAlert: vi.fn().mockResolvedValue(undefined),
    signalCorrelation: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock("../pine-export-service.js", () => ({
  compilePineExport: vi.fn().mockResolvedValue({ id: "pine-export-uuid" }),
  compileDualPineExport: vi.fn().mockResolvedValue({ id: "pine-export-dual-uuid" }),
  checkExportability: vi.fn().mockResolvedValue({ ok: true, score: 100, band: "green", deductions: [] }),
}));
vi.mock("../agent-coordinator-service.js", () => ({
  agentCoordinator: { notify: vi.fn().mockResolvedValue(undefined), register: vi.fn().mockResolvedValue(undefined), emit: vi.fn().mockResolvedValue(undefined) },
}));
const checkSignalCorrelationGateMock = vi.fn();
vi.mock("../signal-correlation-service.js", () => ({
  checkSignalCorrelationGate: (...args: unknown[]) => checkSignalCorrelationGateMock(...args),
}));
const evaluatePaperToDeployReadyGatesMock = vi.fn();
vi.mock("../../lib/paper-to-deploy-ready-gates.js", () => ({
  evaluatePaperToDeployReadyGates: (...args: unknown[]) => evaluatePaperToDeployReadyGatesMock(...args),
}));

// ─── AR-1346A S4: the TESTING→PAPER manual-path gate chain's remaining deps ──
// (goalscan-crit-manual-path-hard-gate-parity.test.ts's mock set is the
// verified template for driving this exact manual path; B14/WFE/paramDrift/DSR
// are left REAL there and here too — mocking them would hide a wiring
// regression in the actual gates. Everything below is genuinely orthogonal to
// what this describe block is proving: PAPER-entry activation wiring.)
const mockFreezePolicyLifecycle = vi.fn();
vi.mock("../../lib/frozen-policy-contract.js", () => ({
  evaluateFrozenPolicyDriftAtPromotion: vi.fn(),
  freezePolicyForStrategy: (...args: unknown[]) => mockFreezePolicyLifecycle(...args),
}));
vi.mock("../../production/kill-switch.js", () => ({
  killSwitch: { isHaltedForProduction: vi.fn().mockResolvedValue(false), isHalted: vi.fn().mockReturnValue(false) },
}));
const mockEvaluatePboGate = vi.fn();
vi.mock("../../lib/pbo-gate.js", () => ({
  evaluatePboGate: (...args: unknown[]) => mockEvaluatePboGate(...args),
}));
vi.mock("../../lib/bif-gate.js", () => ({
  evaluateBifGate: vi.fn(() => ({ passed: true, reason: "bif.clean", legacyNull: false, auditPayload: {} })),
}));
vi.mock("../../lib/composite-shadow-gate.js", () => ({ evaluateCompositeShadow: vi.fn() }));
vi.mock("../../lib/composite-shadow-discord-router.js", () => ({ routeShadowDisagreementAlert: vi.fn() }));
vi.mock("../../lib/promotion-gate-orchestrator.js", () => ({
  evaluatePromotionGates: vi.fn(), getWfePromotionFloor: vi.fn(), getCpcvMinPaths: vi.fn(),
}));
vi.mock("../../lib/shadow-signal-divergence-checker.js", () => ({ compareShadowToBacktest: vi.fn() }));
vi.mock("../../lib/shadow-signal-divergence-loader.js", () => ({
  loadDivergenceInputs: vi.fn().mockResolvedValue({ shadowSignals: [], backtestExpected: [] }),
}));
vi.mock("../multi-firm-promotion-service.js", () => ({ evaluateMultiFirmEligibility: vi.fn() }));
const mockGetLatestAdversarialStressRun = vi.fn().mockResolvedValue(undefined);
vi.mock("../adversarial-stress-service.js", () => ({
  getLatestAdversarialStressRun: (...args: unknown[]) => mockGetLatestAdversarialStressRun(...args),
}));
const mockGetLatestFrankensteinRun = vi.fn().mockResolvedValue(undefined);
vi.mock("../frankenstein-service.js", () => ({
  getLatestFrankensteinRun: (...args: unknown[]) => mockGetLatestFrankensteinRun(...args),
}));
vi.mock("../../lib/quantum-agreement.js", () => ({
  computeAgreement: vi.fn(() => ({ score: null, delta: null, fallback: true, disagreementPct: null, withinTolerance: true })),
}));

// AR-1346A S3/S4's actual target: the verifier every PAPER-entry activation
// path (scheduler boot-resume/retry/reconnect AND this lifecycle transition)
// must call before startStream. Mocked at the module boundary — same accepted
// pattern as paper-start-activation-wiring.test.ts and the sibling scheduler
// witness files.
const mockVerifyPaperActivation = vi.fn();
vi.mock("../paper-qualification-activation-service.js", () => ({
  verifyPaperActivation: (...args: unknown[]) => mockVerifyPaperActivation(...args),
}));

// THE SPY THAT MATTERS: real paper-trading-stream module mocked so we can
// assert exactly what session id/args stopStream is invoked with.
const mockStartStream = vi.fn();
const mockStopStream = vi.fn().mockResolvedValue(undefined);
const mockIsStreaming = vi.fn().mockReturnValue(false);
vi.mock("../paper-trading-stream.js", () => ({
  startStream: mockStartStream,
  stopStream: mockStopStream,
  isStreaming: mockIsStreaming,
}));

import { LifecycleService } from "../lifecycle-service.js";
import { db } from "../../db/index.js";
import { strategies, backtests, paperTrades, paperSessions } from "../../db/schema.js";

type MockDb = {
  __setRows: (table: unknown, rows: Record<string, unknown>[]) => void;
  __setPaperSessionsTableRef: (table: unknown) => void;
  __setPaperSessionsColumns: (cols: { strategyId: unknown; status: unknown }) => void;
  __insertedRows: { table: unknown; row: Record<string, unknown> }[];
  __setUpdateReturning: (rows: Record<string, unknown>[]) => void;
  __setSelectQueue: (items: unknown[]) => void;
  __reset: () => void;
};

const STRATEGY_ID = "m3s10001-0000-0000-0000-000000000001";
const SESSION_ID = "m3sess01-0000-0000-0000-000000000001";

function makeStrategyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: STRATEGY_ID, name: "m3-sibling-stop-fixture", symbol: "MES", symbols: ["MES"],
    timeframe: "5m", config: {}, lifecycleState: "PAPER",
    lifecycleChangedAt: new Date("2026-01-01T00:00:00.000Z"),
    rollingSharpe30d: "2.1", forgeScore: "75", frozenPolicyHash: null,
    createdAt: new Date(), updatedAt: new Date(),
    ...overrides,
  };
}

const PASSING_EVALUATOR_RESULT = {
  passed: true, status: "passed", auditAction: null, auditPayload: {},
  reason: "mocked-pass — this test isolates the sibling-stop stream behavior, not the 9-gate evaluator",
  needsFirstTimeFreeze: false, incompleteGateCount: 0, gateEvidenceStatuses: [], survivalTwin: undefined,
};

const THIRTY_TRADING_DAYS = Array.from({ length: 30 }, (_, i) =>
  ({ day: `2026-${i < 22 ? "01" : "02"}-${String((i % 22) + 2).padStart(2, "0")}` }));

describe("M3 sibling-stop — PAPER→DEPLOY_READY genuinely stops the internal stream (grader F-2)", () => {
  let svc: LifecycleService;
  let mockDb: MockDb;

  beforeEach(() => {
    svc = new LifecycleService();
    mockDb = db as unknown as MockDb;
    vi.clearAllMocks();
    mockDb.__reset();
    mockDb.__setPaperSessionsTableRef(paperSessions);
    mockDb.__setPaperSessionsColumns({ strategyId: paperSessions.strategyId, status: paperSessions.status });

    mockDb.__setRows(backtests, []);
    mockDb.__setRows(paperTrades, THIRTY_TRADING_DAYS); // satisfies GATE3's precondition
    mockDb.__setUpdateReturning([{ id: STRATEGY_ID }]);

    checkSignalCorrelationGateMock.mockResolvedValue({
      allowed: true, reason: "mocked A7 pass", maxSimilarity: null, blockingStrategyId: null,
    });
    evaluatePaperToDeployReadyGatesMock.mockResolvedValue(PASSING_EVALUATOR_RESULT);
    mockIsStreaming.mockReturnValue(true); // stream is genuinely alive pre-transition (M3 invariant)
  });

  it("stops the internal stream for the strategy's active session on a real PAPER→DEPLOY_READY promotion", async () => {
    mockDb.__setRows(strategies, [makeStrategyRow()]);
    mockDb.__setRows(paperSessions, [{ id: SESSION_ID, strategyId: STRATEGY_ID, status: "active" }]);

    const result = await svc.promoteStrategy(STRATEGY_ID, "PAPER", "DEPLOY_READY");

    expect(result.success).toBe(true); // sanity: the promotion itself must still succeed
    expect(mockStopStream).toHaveBeenCalledTimes(1);
    expect(mockStopStream).toHaveBeenCalledWith(SESSION_ID);
  });

  it("does NOT call stopStream when no active session exists for the strategy (nothing to stop)", async () => {
    mockDb.__setRows(strategies, [makeStrategyRow()]);
    mockDb.__setRows(paperSessions, []); // no active session row at all

    const result = await svc.promoteStrategy(STRATEGY_ID, "PAPER", "DEPLOY_READY");

    expect(result.success).toBe(true);
    expect(mockStopStream).not.toHaveBeenCalled();
  });

  it("does NOT call stopStream for a session belonging to a DIFFERENT strategy (strategyId filter is real, not a table-wide match)", async () => {
    mockDb.__setRows(strategies, [makeStrategyRow()]);
    mockDb.__setRows(paperSessions, [
      { id: "other-session-id", strategyId: "some-other-strategy-id", status: "active" },
    ]);

    const result = await svc.promoteStrategy(STRATEGY_ID, "PAPER", "DEPLOY_READY");

    expect(result.success).toBe(true);
    expect(mockStopStream).not.toHaveBeenCalled();
  });

  it("does NOT call stopStream for a session that is not status='active' (e.g. already stopped)", async () => {
    mockDb.__setRows(strategies, [makeStrategyRow()]);
    mockDb.__setRows(paperSessions, [{ id: SESSION_ID, strategyId: STRATEGY_ID, status: "stopped" }]);

    const result = await svc.promoteStrategy(STRATEGY_ID, "PAPER", "DEPLOY_READY");

    expect(result.success).toBe(true);
    expect(mockStopStream).not.toHaveBeenCalled();
  });

  it("mock self-check: this file's paperSessions filter genuinely discriminates on status (not a naive ignore-the-WHERE-clause table router)", async () => {
    // Deliberately unrelated to any production string this file's own
    // RED-proof might ever mutate — seeds a row whose status is neither
    // "active" nor anything a future typo-mutation is likely to coincide
    // with, proving the mock's status comparison is real, not a pass-through.
    mockDb.__setRows(strategies, [makeStrategyRow()]);
    mockDb.__setRows(paperSessions, [{ id: SESSION_ID, strategyId: STRATEGY_ID, status: "some_unrelated_never_matches_active_status" }]);

    await svc.promoteStrategy(STRATEGY_ID, "PAPER", "DEPLOY_READY");

    expect(mockStopStream).not.toHaveBeenCalled();
  });
});

// ─── AR-1346A S4: lifecycle PAPER-ENTRY witness (TESTING→PAPER legacy path) ───
//
// Drives the REAL svc.promoteStrategy(STRATEGY_ID, "TESTING", "PAPER") all the
// way through the real TESTING→PAPER gate chain (DSL guards, invariants,
// WF-mode, B14/WFE/paramDrift/DSR [real evaluators, verified-clean synthetic
// data — same recipe as goalscan-crit-manual-path-hard-gate-parity.test.ts],
// PBO, honest-DSR, exportability, frozen-policy) to reach the real
// `if (toState === "PAPER")` activation block, which loads
// verifyPaperActivation and calls startStream(activeSessId, activation.symbols)
// on success. Only THAT boundary is mocked+asserted on; every surrounding gate
// runs for real or is mocked to a clean pass, per AR-1346A S4's own
// instruction: isolate the activation wiring, don't re-test every gate.
describe("AR-1346A lifecycle PAPER-entry witness — TESTING→PAPER real promoteStrategy() drives the real activation block", () => {
  let svc: LifecycleService;
  let mockDb: MockDb;
  const TP_STRATEGY_ID = "aaaaaaaa-2222-0000-0000-000000000001";
  const TP_SESSION_ID = "bbbbbbbb-2222-0000-0000-000000000001";
  const TP_BT_ID = "cccccccc-2222-0000-0000-000000000001";

  const tpStrategyRow = (overrides: Record<string, unknown> = {}) => ({
    id: TP_STRATEGY_ID,
    name: "ar1346a-lifecycle-paper-entry-fixture",
    symbol: "MES",
    lifecycleState: "TESTING",
    config: {},
    frozenPolicyHash: null,
    regimeTrainedOn: "TRENDING",
    ...overrides,
  });

  const dslGuardsCleanRow = () => ({ resultExtras: { dsl_guards: { guards_failed: false } } });
  const latestBtEvidenceRow = (overrides: Record<string, unknown> = {}) => ({
    id: TP_BT_ID,
    forgeScore: 75,
    resultExtras: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  });
  const cleanWalkForwardResultsRow = () => ({
    walkForwardResults: {
      wfe_overall: 0.95,
      wfe_status: "cpcv_combined_fold",
      param_stability: { drift_classification: "stable", drift_confidence: 0.9 },
      param_stability_status: "computed",
      wf_metadata: { dsr_pass: true, dsr_unavailable: false, dsr: 1.2 },
    },
  });
  const cleanMcSurvivalRow = () => ({ probabilityOfRuin: "0.05" });
  const cleanB14McRow = () => ({
    probabilityOfRuin: "0.05",
    riskMetrics: { probability_of_ruin_ci: { point_estimate: 0.05, ci_low: 0.02, ci_high: 0.08, ci_method: "bca", n_resamples: 1000 } },
  });

  /**
   * Positions 1-11 verified against goalscan-crit-manual-path-hard-gate-parity.test.ts's
   * own "passes B14/WFE/paramDrift/DSR (all clean)" case (same manual path,
   * same real B14/WFE/paramDrift/DSR evaluators, same clean synthetic shapes).
   * Positions 12+ are new — this file is the first to drive this path to
   * result.success===true, so they were derived by running against the real
   * source and reading the exact next db.select() this constructor needs.
   */
  /**
   * Exact 17-call sequence verified by running the real _promoteStrategyInner
   * for TESTING→PAPER with a stack-trace-instrumented select-queue mock and
   * reading off the real lifecycle-service.ts call sites in order (see
   * WORKER2-AR1346A-LIFECYCLE-WITNESS-QUEUE-DERIVATION note in the closeout
   * report — this is not a guess, it is a measured trace).
   */
  function armCleanSelectQueue(mockDb: MockDb, opts: { paperSessionActive?: boolean } = {}) {
    mockDb.__setSelectQueue([
      [tpStrategyRow()],                    // 1  (~684)  strategy fetch
      [dslGuardsCleanRow()],                 // 2  (1479) DSL guards
      [latestBtEvidenceRow()],               // 3  (1599) promotionEvidence backtest
      [],                                    // 4  (1607) mcEvidence (none)
      [],                                    // 5  (1652) qmcRun (none)
      [{ createdAt: new Date().toISOString() }], // 6 (1802) staleness (fresh)
      [{ resultExtras: null }],              // 7  (1863) invariants (legacy — no-op)
      [{ resultExtras: null }],              // 8  (1970) WF-mode (legacy — no-op)
      [cleanWalkForwardResultsRow()],        // 9  (2054) B14/WFE/paramDrift/DSR walkForwardResults fetch
      [cleanMcSurvivalRow()],                // 10 (2070) MC-survival (0.95 survival, clean)
      [cleanB14McRow()],                     // 11 (2103) B14 MC — clean, low ci_high
      [{ resultExtras: null }],              // 12 (2286) W24 secondary pbo_flag read (legacy — no-op)
      [{ walkForwardResults: null }],        // 13 (2359) Wave-29 PBO gate's own raw walkForwardResults read (evaluatePboGate itself is mocked — this only feeds its now-ignored args)
      [{ resultExtras: null }],              // 14 (2560) honest-DSR gate backtest re-read (legacy — no-op)
      [],                                    // 15 (2928) TESTING→PAPER compliance-drift propCompliance read (no row -> gate no-ops)
      [],                                    // 16 (3012) TESTING→PAPER frozen-policy-freeze biasState regimeLabel read (empty -> "UNKNOWN", non-fatal)
      opts.paperSessionActive === false
        ? []
        : [{ id: TP_SESSION_ID, strategyId: TP_STRATEGY_ID, status: "active" }], // 17 (3370) activation block's active paper session lookup — the one this witness targets
    ]);
  }

  beforeEach(() => {
    svc = new LifecycleService();
    mockDb = db as unknown as MockDb;
    vi.clearAllMocks();
    mockDb.__reset();
    mockDb.__setPaperSessionsTableRef(paperSessions);
    mockDb.__setPaperSessionsColumns({ strategyId: paperSessions.strategyId, status: paperSessions.status });
    mockDb.__setUpdateReturning([{ id: TP_STRATEGY_ID }]);

    checkSignalCorrelationGateMock.mockResolvedValue({
      allowed: true, reason: "mocked A7 pass", maxSimilarity: null, blockingStrategyId: null,
    });
    mockEvaluatePboGate.mockReturnValue({
      ok: true, pbo: null, threshold: 0.15, legacyNull: true, reason: "lifecycle.pbo_unavailable_legacy", auditPayload: {},
    });
    mockFreezePolicyLifecycle.mockResolvedValue({ hash: "a".repeat(64), frozen_at: new Date() });
    mockGetLatestAdversarialStressRun.mockResolvedValue(undefined);
    mockGetLatestFrankensteinRun.mockResolvedValue({
      passed: true, runId: "frank-run-clean", p95Sharpe: 0.1, medianPf: 1.0, nShuffles: 500,
    });
    mockIsStreaming.mockReturnValue(false);
    // The verifier this witness exists to prove: default approves with symbols
    // DELIBERATELY DIFFERENT from the strategy's own "MES" symbol, so a passing
    // assertion proves startStream received the VERIFIER's symbols, not a
    // fallback to strategy/config symbols.
    mockVerifyPaperActivation.mockResolvedValue({
      ok: true,
      symbols: ["MES-LIFECYCLE-VERIFIED"],
      stamped: true,
      identity: {},
    });
  });

  it("verifyPaperActivation -> ok:true: real promoteStrategy(TESTING, PAPER) reaches the activation block and calls startStream with VERIFIER symbols", async () => {
    armCleanSelectQueue(mockDb);

    const result = await svc.promoteStrategy(TP_STRATEGY_ID, "TESTING", "PAPER");

    expect(result.success).toBe(true);
    expect(mockVerifyPaperActivation).toHaveBeenCalledWith(TP_SESSION_ID, expect.objectContaining({ correlationId: null }));
    expect(mockStartStream).toHaveBeenCalledWith(TP_SESSION_ID, ["MES-LIFECYCLE-VERIFIED"]);
    // Verifier symbols reach startStream — NOT the strategy's stale "MES" symbol.
    expect(mockStartStream).not.toHaveBeenCalledWith(TP_SESSION_ID, ["MES"]);
  });

  it("verifyPaperActivation -> ok:false: real promoteStrategy(TESTING, PAPER) reaches the activation block but startStream is NEVER called", async () => {
    mockVerifyPaperActivation.mockResolvedValue({
      ok: false,
      reason: "runtime_revision_mismatch: test",
    });
    armCleanSelectQueue(mockDb);

    const result = await svc.promoteStrategy(TP_STRATEGY_ID, "TESTING", "PAPER");

    expect(mockVerifyPaperActivation).toHaveBeenCalledWith(TP_SESSION_ID, expect.objectContaining({ correlationId: null }));
    expect(mockStartStream).not.toHaveBeenCalled();
    // The rest of this file's own contract (F1-F10, AR-1155/AR-1342A, frozen):
    // the transition itself may still complete to PAPER even when the stream
    // is blocked — capital/lifecycle state and the internal-stream authority
    // are deliberately independent failure domains. Only the stream call is
    // this witness's claim.
    void result;
  });
});
