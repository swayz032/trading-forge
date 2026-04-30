/**
 * Phase 1.1 — Journal Enrichment: closePosition() field population tests.
 *
 * Verifies that all 10 enrichment columns are computed and passed to the
 * paperTrades INSERT on every position close.
 *
 * Design:
 *   - DB is mocked at the module boundary.
 *   - A makeChain() factory builds a fresh chainable query object per call.
 *   - A selectQueue drives the response for each db.select() call in order.
 *   - tx.insert(paperTrades).values(...) is intercepted to capture the payload.
 *   - holdDurationMs, hourOfDay, dayOfWeek, sessionType are pure computations
 *     so they are asserted exactly.
 *   - macroRegime and skipSignal are asserted as their mocked return values.
 *   - eventActive propagates the Python runner result.
 *   - mae / mfe are asserted as null (known gap).
 *   - fillProbability is read from the position row.
 *
 * Parity assumption: every paper_trades row must carry full enrichment so
 * promotion-gate and parity diagnostic queries are never missing context.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Captured INSERT payload ──────────────────────────────────────────────────
let capturedTradeValues: Record<string, unknown> | null = null;

// ─── Select response queue ────────────────────────────────────────────────────
// Each entry is a response (array) for one db.select() call in call order:
//   0 → paperPositions (pos)
//   1 → paperSessions.firmId
//   2 → macroSnapshots (macroRegime enrichment)
//   3 → skipDecisions (skipSignal enrichment)
//   4 → paperSessions re-read after tx
//   5 → paperTrades rolling Sharpe (returns [] to short-circuit)
//   6 → strategies.rollingSharpe30d (only if strategyId present — skip by returning [])
let selectQueue: Array<unknown[] | Error> = [];
let selectCallIndex = 0;

// ─── Mock DB ──────────────────────────────────────────────────────────────────
vi.mock("../db/index.js", () => {
  /**
   * Build a chainable query object.
   * When any terminal (where / limit) is awaited it pops from the queue.
   * The chain always returns itself so .from().where().limit() all resolve
   * the same promise.
   */
  function makeChain(): Record<string, unknown> {
    // Promise that resolves/rejects from the queue when awaited
    let resolve: (v: unknown) => void;
    let reject: (e: unknown) => void;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });

    function settle() {
      const entry = selectQueue[selectCallIndex];
      selectCallIndex++;
      if (entry instanceof Error) {
        reject!(entry);
      } else {
        resolve!(entry ?? []);
      }
    }

    const chain: Record<string, unknown> = {
      then: (onFulfilled: unknown, onRejected: unknown) => {
        settle();
        return (promise as Promise<unknown>).then(
          onFulfilled as (v: unknown) => unknown,
          onRejected as (e: unknown) => unknown,
        );
      },
      catch: (onRejected: unknown) => {
        settle();
        return (promise as Promise<unknown>).catch(onRejected as (e: unknown) => unknown);
      },
      finally: (onFinally: unknown) => {
        settle();
        return (promise as Promise<unknown>).finally(onFinally as () => void);
      },
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockImplementation(() => {
        // limit() is also terminal — re-settle and return a new promise
        const entry = selectQueue[selectCallIndex];
        selectCallIndex++;
        if (entry instanceof Error) return Promise.reject(entry);
        return Promise.resolve(entry ?? []);
      }),
      set: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([]),
    };
    return chain;
  }

  // Transaction mock: captures tx.insert(paperTrades).values(payload)
  const txInsertMock = vi.fn().mockImplementation(() => ({
    values: (vals: Record<string, unknown>) => {
      // Capture when it looks like a paper_trades row (has pnl key)
      if ("pnl" in vals || "holdDurationMs" in vals) {
        capturedTradeValues = vals;
      }
      return { returning: vi.fn().mockResolvedValue([{ id: "trade-uuid-001", ...vals }]) };
    },
  }));

  const txUpdateMock = vi.fn().mockReturnValue({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    }),
  });

  return {
    db: {
      select: vi.fn().mockImplementation(makeChain),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }),
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
      }),
      transaction: vi.fn().mockImplementation(
        async (fn: (tx: { insert: typeof txInsertMock; update: typeof txUpdateMock }) => Promise<unknown>) =>
          fn({ insert: txInsertMock, update: txUpdateMock }),
      ),
    },
  };
});

vi.mock("../routes/sse.js", () => ({ broadcastSSE: vi.fn() }));

vi.mock("../index.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../lib/tracing.js", () => ({
  tracer: {
    startSpan: vi.fn().mockReturnValue({
      setAttribute: vi.fn(),
      end: vi.fn(),
    }),
  },
}));

vi.mock("../scheduler.js", () => ({ onPaperTradeClose: vi.fn() }));

vi.mock("./paper-risk-gate.js", () => ({
  toEasternDateString: vi.fn().mockReturnValue("2026-03-27"),
  invalidateDailyLossCache: vi.fn(),
}));

vi.mock("../lib/python-runner.js", () => ({
  runPythonModule: vi.fn().mockResolvedValue({ is_economic_event: false }),
}));

import { closePosition, __resetCalendarCacheForTests } from "./paper-execution-service.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────
// entryTime = 2026-01-15T15:00:00Z (January, standard time EST = UTC-5)
//   → ET 10:00 which is NY_OPEN (09:30–10:30)
// 2026-01-15 is a Thursday → dayOfWeek = 4
// UTC hour = 15 → hourOfDay = 15
// entryTime is in the past (relative to current date 2026-03-29), so
// holdDurationMs is a large positive integer.
const ENTRY_UTC = new Date("2026-01-15T15:00:00Z");

function buildMockPosition(overrides: Record<string, unknown> = {}) {
  return {
    id: "pos-uuid-001",
    sessionId: "sess-uuid-001",
    symbol: "MES",
    side: "long",
    entryPrice: "5000",
    currentPrice: "5010",
    contracts: 1,
    unrealizedPnl: "50",
    entryTime: ENTRY_UTC,
    closedAt: null,
    arrivalPrice: "5000",
    implementationShortfall: "0",
    fillRatio: "1.0",
    trailHwm: null,
    barsHeld: 0,
    fillProbability: "0.85",
    // mae/mfe explicitly null — they're populated only when updatePositionPrices()
    // runs per bar (see paper-trading-stream.ts). This unit test stubs that path,
    // so the watermark fields must be present with null so the INSERT carries them.
    mae: null,
    mfe: null,
    ...overrides,
  };
}

const MOCK_SESSION = {
  id: "sess-uuid-001",
  strategyId: null,
  firmId: "topstep",
  status: "active",
  currentEquity: "50000",
  peakEquity: "50050",
  totalTrades: 1,
  lastSignalTime: null,
  cooldownUntil: null,
  dailyPnlBreakdown: {},
  metricsSnapshot: {},
  config: {},
};

/**
 * Standard select queue for a successful close.
 *
 * closePosition() makes select() calls in this exact order:
 *   0 — paperPositions (posForLock — outside withSessionLock — only sessionId)
 *   1 — paperPositions (re-read inside lock — full row, including symbol)
 *   2 — paperSessions.firmId (commission lookup)
 *   3 — macroSnapshots (macroRegime enrichment)
 *   4 — skipDecisions (skipSignal enrichment)
 *   5 — paperSessions re-read after tx (downstream logic)
 *   6 — paperTrades rolling Sharpe (returns [] to short-circuit at < 5 trades)
 */
function makeDefaultQueue(position = buildMockPosition()): Array<unknown[]> {
  return [
    [{ sessionId: position.sessionId }],   // posForLock
    [position],                             // pos (full row inside lock)
    [{ firmId: "topstep" }],
    [{ macroRegime: "TRENDING_UP" }],
    [{ decision: "REDUCE" }],
    [MOCK_SESSION],
    [],   // rolling Sharpe — short-circuits at < 5 trades
  ];
}

// ─── Test setup ───────────────────────────────────────────────────────────────

beforeEach(() => {
  capturedTradeValues = null;
  selectCallIndex = 0;
  selectQueue = [];
  vi.clearAllMocks();
  __resetCalendarCacheForTests();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("closePosition() — Phase 1.1 journal enrichment", () => {

  it("populates holdDurationMs as exitTime - entryTime", async () => {
    selectQueue = makeDefaultQueue();
    const before = Date.now();
    await closePosition("pos-uuid-001", 5010);
    const after = Date.now();

    expect(capturedTradeValues).not.toBeNull();
    const held = capturedTradeValues!.holdDurationMs as number;
    const expectedMin = before - ENTRY_UTC.getTime();
    const expectedMax = after - ENTRY_UTC.getTime();
    expect(held).toBeGreaterThanOrEqual(expectedMin);
    expect(held).toBeLessThanOrEqual(expectedMax);
    expect(held).toBeGreaterThan(0);
  });

  it("populates hourOfDay as UTC hour of entryTime", async () => {
    selectQueue = makeDefaultQueue();
    await closePosition("pos-uuid-001", 5010);

    expect(capturedTradeValues).not.toBeNull();
    // ENTRY_UTC = 2026-01-15T15:00:00Z → UTC hour 15
    expect(capturedTradeValues!.hourOfDay).toBe(15);
  });

  it("populates dayOfWeek as JS day (0=Sun) of entryTime", async () => {
    selectQueue = makeDefaultQueue();
    await closePosition("pos-uuid-001", 5010);

    expect(capturedTradeValues).not.toBeNull();
    // 2026-01-15 is Thursday → 4
    expect(capturedTradeValues!.dayOfWeek).toBe(4);
  });

  it("populates sessionType from classifySessionType(entryTime)", async () => {
    selectQueue = makeDefaultQueue();
    await closePosition("pos-uuid-001", 5010);

    expect(capturedTradeValues).not.toBeNull();
    // ENTRY_UTC = 2026-01-15T15:00:00Z → EST (UTC-5) → ET 10:00 → NY_OPEN (09:30–10:30)
    expect(capturedTradeValues!.sessionType).toBe("NY_OPEN");
  });

  it("populates macroRegime from macroSnapshots query", async () => {
    selectQueue = makeDefaultQueue();
    await closePosition("pos-uuid-001", 5010);

    expect(capturedTradeValues).not.toBeNull();
    expect(capturedTradeValues!.macroRegime).toBe("TRENDING_UP");
  });

  it("populates skipSignal from skipDecisions query", async () => {
    selectQueue = makeDefaultQueue();
    await closePosition("pos-uuid-001", 5010);

    expect(capturedTradeValues).not.toBeNull();
    expect(capturedTradeValues!.skipSignal).toBe("REDUCE");
  });

  it("propagates fillProbability from position row to trade journal", async () => {
    selectQueue = makeDefaultQueue();
    await closePosition("pos-uuid-001", 5010);

    expect(capturedTradeValues).not.toBeNull();
    expect(capturedTradeValues!.fillProbability).toBe("0.85");
  });

  // mae/mfe per-bar tracking IS implemented (paper-execution-service.ts:1256 updatePositionPrices called from paper-trading-stream.ts:108). The test fixture below uses a simplified mock that doesn't trigger per-bar updates — assertion of null is acceptable for this unit test scope.
  it("mae is null in this fixture (mock skips per-bar updatePositionPrices path)", async () => {
    selectQueue = makeDefaultQueue();
    await closePosition("pos-uuid-001", 5010);

    expect(capturedTradeValues).not.toBeNull();
    expect(capturedTradeValues!.mae).toBeNull();
  });

  it("mfe is null in this fixture (mock skips per-bar updatePositionPrices path)", async () => {
    selectQueue = makeDefaultQueue();
    await closePosition("pos-uuid-001", 5010);

    expect(capturedTradeValues).not.toBeNull();
    expect(capturedTradeValues!.mfe).toBeNull();
  });

  it("eventActive is false when Python calendar_filter returns is_economic_event=false", async () => {
    selectQueue = makeDefaultQueue();
    await closePosition("pos-uuid-001", 5010);

    expect(capturedTradeValues).not.toBeNull();
    expect(capturedTradeValues!.eventActive).toBe(false);
  });

  it("eventActive is true when Python calendar_filter returns is_economic_event=true", async () => {
    const { runPythonModule } = await import("../lib/python-runner.js");
    (runPythonModule as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ is_economic_event: true });

    selectQueue = makeDefaultQueue();
    await closePosition("pos-uuid-001", 5010);

    expect(capturedTradeValues).not.toBeNull();
    expect(capturedTradeValues!.eventActive).toBe(true);
  });

  it("macroRegime is null when macroSnapshots query returns no rows", async () => {
    // Mirror queue order documented on makeDefaultQueue (posForLock → pos → ... ).
    const pos = buildMockPosition();
    selectQueue = [
      [{ sessionId: pos.sessionId }],   // posForLock
      [pos],                             // pos
      [{ firmId: "topstep" }],
      [],   // macroSnapshots: no rows
      [],   // skipDecisions: no rows
      [MOCK_SESSION],
      [],
    ];
    await closePosition("pos-uuid-001", 5010);

    expect(capturedTradeValues).not.toBeNull();
    expect(capturedTradeValues!.macroRegime).toBeNull();
    expect(capturedTradeValues!.skipSignal).toBeNull();
  });

  it("macroRegime is null when macroSnapshots query throws — close still succeeds (non-blocking)", async () => {
    // Replace macroSnapshots queue entry (now index 3) with an Error to simulate DB failure.
    const pos = buildMockPosition();
    selectQueue = [
      [{ sessionId: pos.sessionId }],   // posForLock
      [pos],                             // pos
      [{ firmId: "topstep" }],
      new Error("DB timeout") as unknown as unknown[],
      [{ decision: "TRADE" }],
      [MOCK_SESSION],
      [],
    ];
    await expect(closePosition("pos-uuid-001", 5010)).resolves.not.toThrow();

    expect(capturedTradeValues).not.toBeNull();
    expect(capturedTradeValues!.macroRegime).toBeNull();
  });

  it("fillProbability is null when position row has no fillProbability (market order bypass)", async () => {
    const pos = buildMockPosition({ fillProbability: null });
    selectQueue = [
      [{ sessionId: pos.sessionId }],   // posForLock
      [pos],                             // pos
      [{ firmId: "mffu" }],
      [{ macroRegime: "RANGE_BOUND" }],
      [{ decision: "TRADE" }],
      [{ ...MOCK_SESSION, firmId: "mffu" }],
      [],
    ];
    await closePosition("pos-uuid-001", 5010);

    expect(capturedTradeValues).not.toBeNull();
    expect(capturedTradeValues!.fillProbability).toBeNull();
  });

  it("all 10 enrichment fields are present in the INSERT payload", async () => {
    selectQueue = makeDefaultQueue();
    await closePosition("pos-uuid-001", 5010);

    expect(capturedTradeValues).not.toBeNull();
    const keys = Object.keys(capturedTradeValues!);
    const required = [
      "mae", "mfe", "holdDurationMs", "hourOfDay", "dayOfWeek",
      "sessionType", "macroRegime", "eventActive", "skipSignal", "fillProbability",
    ];
    for (const key of required) {
      expect(keys, `Expected key "${key}" in INSERT payload`).toContain(key);
    }
  });
});
