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
    __reset: () => {
      routes.clear();
      insertedRows.length = 0;
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
