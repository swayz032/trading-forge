/**
 * lifecycle-service.paper-position-force-close.test.ts — M3 CRIT fix
 * (2026-07-17): the PAPER→broker-authoritative sibling block at
 * lifecycle-service.ts ~3438 (`if (fromState === "PAPER" &&
 * isBrokerAuthoritativeState(toState))`) tore down the internal simulator's
 * WebSocket via stopStream(sessionId) but never checked for or closed any
 * OPEN paper_positions row for that session first. A position open at the
 * moment of promotion froze forever (closedAt stayed NULL, no bar ever
 * reached it again once the stream stopped), and because
 * DLL_AGGREGATE_SESSION_STATUSES intentionally includes 'stopped' sessions,
 * the frozen unrealizedPnl kept feeding the real kill-switch Layer 2/3
 * (checkLayer2DailyLoss/checkLayer3TrailingDD) aggregation for that account
 * indefinitely — a stale phantom loss/gain risking a false-positive halt or
 * masking a real one.
 *
 * This file drives the REAL `_promoteStrategyInner` (via the public
 * `promoteStrategy()`) with a mocked DB, seeding an OPEN paper_positions row
 * for the strategy's active PAPER session, and asserts the row's closedAt is
 * genuinely set (not just that some function was called with some args) by
 * having the update mock apply real WHERE-clause filtering + row mutation —
 * same "filter-aware, not table-wide" discipline as
 * m3-sibling-stop-behavioral.test.ts, extended to the update path.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── drizzle-orm: return INSPECTABLE condition objects (not opaque markers) ──
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((col: unknown, val: unknown) => ({ __op: "eq", col, val })),
  and: vi.fn((...conds: unknown[]) => ({ __op: "and", conds })),
  isNull: vi.fn((col: unknown) => ({ __op: "isNull", col })),
  gte: vi.fn((col: unknown, val: unknown) => ({ __op: "gte", col, val })),
  lte: vi.fn((col: unknown, val: unknown) => ({ __op: "lte", col, val })),
  desc: vi.fn((col: unknown) => ({ __op: "desc", col })),
  asc: vi.fn((col: unknown) => ({ __op: "asc", col })),
  inArray: vi.fn(), isNotNull: vi.fn(), min: vi.fn(),
  sql: Object.assign(vi.fn(), { raw: vi.fn() }),
  notInArray: vi.fn(),
  count: vi.fn(),
}));

// ─── db mock: table-aware routing; paperSessions + paperPositions genuinely
//     filter their WHERE clause (select AND update-with-mutation) ──────────
vi.mock("../../db/index.js", () => {
  const routes = new Map<unknown, Record<string, unknown>[]>();
  const insertedRows: { table: unknown; row: Record<string, unknown> }[] = [];
  const updateReturning: Record<string, unknown>[] = [{}];

  let paperSessionsTableRef: unknown;
  let paperPositionsTableRef: unknown;
  let strategyIdColRef: unknown;
  let statusColRef: unknown;
  let sessionIdColRef: unknown;
  let closedAtColRef: unknown;

  function conditionMatchesRow(condition: unknown, row: Record<string, unknown>): boolean {
    if (!condition || typeof condition !== "object") return true;
    const c = condition as { __op?: string; conds?: unknown[]; col?: unknown; val?: unknown };
    if (c.__op === "and") return (c.conds ?? []).every((sub) => conditionMatchesRow(sub, row));
    if (c.__op === "eq") {
      if (strategyIdColRef !== undefined && c.col === strategyIdColRef) return row.strategyId === c.val;
      if (statusColRef !== undefined && c.col === statusColRef) return row.status === c.val;
      if (sessionIdColRef !== undefined && c.col === sessionIdColRef) return row.sessionId === c.val;
      return true; // unrecognized column reference — don't false-negative on unrelated filters
    }
    if (c.__op === "isNull") {
      if (closedAtColRef !== undefined && c.col === closedAtColRef) return row.closedAt == null;
      return true;
    }
    return true;
  }

  function makeSelectChain(table: unknown | undefined, whereCondition?: unknown) {
    const isFilterAware = table === paperSessionsTableRef || table === paperPositionsTableRef;
    const resolveRows = () => {
      const seeded = table !== undefined ? routes.get(table) ?? [] : [];
      if (isFilterAware && whereCondition) {
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
    update: (table: unknown) => ({
      set: (vals: Record<string, unknown>) => ({
        where: (cond: unknown) => ({
          returning: (sel?: Record<string, unknown>) => {
            if (table === paperPositionsTableRef) {
              const seeded = routes.get(table) ?? [];
              const matched = seeded.filter((row) => conditionMatchesRow(cond, row));
              for (const row of matched) Object.assign(row, vals);
              if (!sel) return Promise.resolve(matched);
              const keys = Object.keys(sel);
              return Promise.resolve(
                matched.map((row) => {
                  const projected: Record<string, unknown> = {};
                  for (const k of keys) projected[k] = row[k];
                  return projected;
                }),
              );
            }
            return Promise.resolve(updateReturning);
          },
        }),
      }),
    }),
    transaction: async (cb: (tx: unknown) => Promise<void>) => {
      await cb(dbMock);
    },
    __setRows: (table: unknown, rows: Record<string, unknown>[]) => routes.set(table, rows),
    __setPaperSessionsTableRef: (table: unknown) => { paperSessionsTableRef = table; },
    __setPaperPositionsTableRef: (table: unknown) => { paperPositionsTableRef = table; },
    __setPaperSessionsColumns: (cols: { strategyId: unknown; status: unknown }) => {
      strategyIdColRef = cols.strategyId;
      statusColRef = cols.status;
    },
    __setPaperPositionsColumns: (cols: { sessionId: unknown; closedAt: unknown }) => {
      sessionIdColRef = cols.sessionId;
      closedAtColRef = cols.closedAt;
    },
    __insertedRows: insertedRows,
    __setUpdateReturning: (rows: Record<string, unknown>[]) => {
      updateReturning.length = 0;
      updateReturning.push(...rows);
    },
    __getRows: (table: unknown) => routes.get(table) ?? [],
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

// paper-trading-stream.js is mocked exactly like m3-sibling-stop-behavioral.test.ts —
// this file is NOT testing stream teardown itself, only the NEW force-close step
// that must run before it.
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
import { strategies, backtests, paperTrades, paperSessions, paperPositions } from "../../db/schema.js";

type MockDb = {
  __setRows: (table: unknown, rows: Record<string, unknown>[]) => void;
  __setPaperSessionsTableRef: (table: unknown) => void;
  __setPaperPositionsTableRef: (table: unknown) => void;
  __setPaperSessionsColumns: (cols: { strategyId: unknown; status: unknown }) => void;
  __setPaperPositionsColumns: (cols: { sessionId: unknown; closedAt: unknown }) => void;
  __insertedRows: { table: unknown; row: Record<string, unknown> }[];
  __setUpdateReturning: (rows: Record<string, unknown>[]) => void;
  __getRows: (table: unknown) => Record<string, unknown>[];
  __reset: () => void;
};

const STRATEGY_ID = "m3p10001-0000-0000-0000-000000000001";
const SESSION_ID = "m3psess1-0000-0000-0000-000000000001";
const POSITION_ID = "m3pposn1-0000-0000-0000-000000000001";

function makeStrategyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: STRATEGY_ID, name: "m3-force-close-fixture", symbol: "MES", symbols: ["MES"],
    timeframe: "5m", config: {}, lifecycleState: "PAPER",
    lifecycleChangedAt: new Date("2026-01-01T00:00:00.000Z"),
    rollingSharpe30d: "2.1", forgeScore: "75", frozenPolicyHash: null,
    createdAt: new Date(), updatedAt: new Date(),
    ...overrides,
  };
}

function makeOpenPositionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: POSITION_ID, sessionId: SESSION_ID, symbol: "MES", side: "long",
    entryPrice: "5000.00", currentPrice: "5010.00", contracts: 9,
    unrealizedPnl: "180.00", closedAt: null,
    entryTime: new Date("2026-07-17T14:00:00.000Z"),
    ...overrides,
  };
}

const PASSING_EVALUATOR_RESULT = {
  passed: true, status: "passed", auditAction: null, auditPayload: {},
  reason: "mocked-pass — this test isolates the force-close-on-promotion behavior, not the 9-gate evaluator",
  needsFirstTimeFreeze: false, incompleteGateCount: 0, gateEvidenceStatuses: [], survivalTwin: undefined,
};

const THIRTY_TRADING_DAYS = Array.from({ length: 30 }, (_, i) =>
  ({ day: `2026-${i < 22 ? "01" : "02"}-${String((i % 22) + 2).padStart(2, "0")}` }));

describe("M3 CRIT fix — PAPER→DEPLOY_READY force-closes an open internal-engine position before stream teardown", () => {
  let svc: LifecycleService;
  let mockDb: MockDb;

  beforeEach(() => {
    svc = new LifecycleService();
    mockDb = db as unknown as MockDb;
    vi.clearAllMocks();
    mockDb.__reset();
    mockDb.__setPaperSessionsTableRef(paperSessions);
    mockDb.__setPaperPositionsTableRef(paperPositions);
    mockDb.__setPaperSessionsColumns({ strategyId: paperSessions.strategyId, status: paperSessions.status });
    mockDb.__setPaperPositionsColumns({ sessionId: paperPositions.sessionId, closedAt: paperPositions.closedAt });

    mockDb.__setRows(backtests, []);
    mockDb.__setRows(paperTrades, THIRTY_TRADING_DAYS); // satisfies GATE3's precondition
    mockDb.__setUpdateReturning([{ id: STRATEGY_ID }]);

    checkSignalCorrelationGateMock.mockResolvedValue({
      allowed: true, reason: "mocked A7 pass", maxSimilarity: null, blockingStrategyId: null,
    });
    evaluatePaperToDeployReadyGatesMock.mockResolvedValue(PASSING_EVALUATOR_RESULT);
    mockIsStreaming.mockReturnValue(true); // stream is genuinely alive pre-transition (M3 invariant)
  });

  it("force-closes the OPEN paper_positions row for the leaving session on a real PAPER→DEPLOY_READY promotion (RED-proof target)", async () => {
    mockDb.__setRows(strategies, [makeStrategyRow()]);
    mockDb.__setRows(paperSessions, [{ id: SESSION_ID, strategyId: STRATEGY_ID, status: "active" }]);
    mockDb.__setRows(paperPositions, [makeOpenPositionRow()]);

    const result = await svc.promoteStrategy(STRATEGY_ID, "PAPER", "DEPLOY_READY");

    expect(result.success).toBe(true); // sanity: the promotion itself must still succeed

    // THE ASSERTION THAT MATTERS: the position row genuinely has closedAt set —
    // read straight from the mock DB's backing store, not from a spy call.
    const positionsAfter = mockDb.__getRows(paperPositions);
    expect(positionsAfter).toHaveLength(1);
    expect(positionsAfter[0].closedAt).not.toBeNull();
    expect(positionsAfter[0].id).toBe(POSITION_ID);
    // unrealizedPnl is deliberately left untouched — it becomes the frozen final figure.
    expect(positionsAfter[0].unrealizedPnl).toBe("180.00");

    // Stream teardown must still happen, and AFTER the force-close conceptually
    // (both must have run; order is enforced structurally in the source, this
    // just confirms neither step was skipped).
    expect(mockStopStream).toHaveBeenCalledTimes(1);
    expect(mockStopStream).toHaveBeenCalledWith(SESSION_ID);

    // A distinct, queryable audit row was written for the force-close.
    const forceCloseAudit = mockDb.__insertedRows.find(
      (r) => (r.row as { action?: string }).action === "lifecycle.paper_position_force_closed_on_promotion",
    );
    expect(forceCloseAudit).toBeDefined();
    expect((forceCloseAudit!.row as { entityId?: string }).entityId).toBe(STRATEGY_ID);
  });

  it("does NOT touch a position belonging to a DIFFERENT session (scoped, not table-wide)", async () => {
    mockDb.__setRows(strategies, [makeStrategyRow()]);
    mockDb.__setRows(paperSessions, [{ id: SESSION_ID, strategyId: STRATEGY_ID, status: "active" }]);
    mockDb.__setRows(paperPositions, [
      makeOpenPositionRow({ id: "other-position-id", sessionId: "some-other-session-id" }),
    ]);

    await svc.promoteStrategy(STRATEGY_ID, "PAPER", "DEPLOY_READY");

    const positionsAfter = mockDb.__getRows(paperPositions);
    expect(positionsAfter[0].closedAt).toBeNull(); // untouched — different session
  });

  it("is a no-op (and still promotes cleanly) when there is no open position for the session", async () => {
    mockDb.__setRows(strategies, [makeStrategyRow()]);
    mockDb.__setRows(paperSessions, [{ id: SESSION_ID, strategyId: STRATEGY_ID, status: "active" }]);
    mockDb.__setRows(paperPositions, []);

    const result = await svc.promoteStrategy(STRATEGY_ID, "PAPER", "DEPLOY_READY");

    expect(result.success).toBe(true);
    const forceCloseAudit = mockDb.__insertedRows.find(
      (r) => (r.row as { action?: string }).action === "lifecycle.paper_position_force_closed_on_promotion",
    );
    expect(forceCloseAudit).toBeUndefined();
  });

  it("does not re-close an already-closed position (idempotency claim guard)", async () => {
    mockDb.__setRows(strategies, [makeStrategyRow()]);
    mockDb.__setRows(paperSessions, [{ id: SESSION_ID, strategyId: STRATEGY_ID, status: "active" }]);
    const alreadyClosedAt = new Date("2026-07-16T20:00:00.000Z");
    mockDb.__setRows(paperPositions, [makeOpenPositionRow({ closedAt: alreadyClosedAt, unrealizedPnl: "0" })]);

    await svc.promoteStrategy(STRATEGY_ID, "PAPER", "DEPLOY_READY");

    const positionsAfter = mockDb.__getRows(paperPositions);
    // untouched — the isNull(closedAt) claim guard must not match an already-closed row
    expect(positionsAfter[0].closedAt).toBe(alreadyClosedAt);
  });
});
