/**
 * Tests for candidate-backtest-conveyor-service.ts
 *
 * 5 cases:
 *  (a) Happy path: zero-backtest CANDIDATE → one backtest enqueued with REAL config spread
 *  (b) Slot math: MAX_CONCURRENT_BACKTESTS=1 + one already running → 0 enqueued
 *  (c) Idempotency: second tick returns no candidates (DB guard prevents double-enqueue)
 *  (d) Paused pipeline → 0 enqueued, no DB calls
 *  (e) Failed-in-24h guard: candidates query returns empty → 0 enqueued
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Hoisted mock factories (vi.hoisted runs before module imports) ────────────
const pipelineMocks = vi.hoisted(() => ({
  getMode: vi.fn(async () => "ACTIVE"),
}));

const backtestMocks = vi.hoisted(() => ({
  runBacktest: vi.fn(),
}));

const lifecycleMocks = vi.hoisted(() => ({
  checkAutoPromotions: vi.fn(async () => []),
}));

const sseMocks = vi.hoisted(() => ({
  broadcastSSE: vi.fn(),
}));

const metricsMocks = vi.hoisted(() => ({
  inc: vi.fn(),
}));

// D-10 F-8: the drizzle `sql` mock was write-only (an opaque "__sql__" sentinel),
// so the WHERE clause the conveyor actually builds was UNOBSERVABLE — no test could
// tell whether a status predicate existed at all. Capturing the template text is
// what lets the eligibility-query control go RED.
// `A COMPARISON THAT CANNOT FAIL IS A PRINTOUT` — this one now can.
const sqlMocks = vi.hoisted(() => ({
  captured: [] as string[],
}));

// ── Module mocks ─────────────────────────────────────────────────────────────
vi.mock("../services/pipeline-control-service.js", () => ({
  getMode: pipelineMocks.getMode,
}));

vi.mock("../services/backtest-service.js", () => ({
  runBacktest: backtestMocks.runBacktest,
}));

vi.mock("../services/lifecycle-service.js", () => ({
  LifecycleService: vi.fn().mockImplementation(() => ({
    checkAutoPromotions: lifecycleMocks.checkAutoPromotions,
  })),
}));

vi.mock("../routes/sse.js", () => ({
  broadcastSSE: sseMocks.broadcastSSE,
}));

vi.mock("../lib/metrics-registry.js", () => ({
  candidateConveyorEnqueuedTotal: { inc: metricsMocks.inc },
}));

// DB mock — rebuilt per test in beforeEach
const mockSelectFn = vi.fn();
const mockInsertFn = vi.fn();

vi.mock("../db/index.js", () => ({
  db: {
    get select() { return mockSelectFn; },
    get insert() { return mockInsertFn; },
  },
}));

// Schema import is used only for type references in the WHERE clause builder;
// the mock db never calls Drizzle internals, so an empty mock is fine.
// D-10 F-8 / pre-empting D-9 F-3: `BACKTEST_STATUS_REFUSED` is pulled from the REAL
// schema module via importActual rather than restated as a literal here.
// `A MOCK THAT RESTATES THE VALUE IT IS CHECKING IS A COPY, NOT A CONTROL` (R-753 §2)
// — this way a rename or value change in production turns these tests RED.
vi.mock("../db/schema.js", async () => {
  const actual = await vi.importActual<typeof import("../db/schema.js")>("../db/schema.js");
  return {
    strategies: {},
    backtests: {},
    auditLog: {},
    BACKTEST_STATUS_REFUSED: actual.BACKTEST_STATUS_REFUSED,
  };
});

// drizzle-orm: the conveyor calls eq(), and(), sql`` from drizzle-orm.
// These are used to BUILD the query object passed to the mocked db chain,
// so we need them to return something the mock chain can call .limit() on, etc.
// The simplest approach: return an opaque sentinel so the mock chain ignores it.
vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => "__eq__"),
  and: vi.fn(() => "__and__"),
  // STALE-MOCK REPAIR (found while red-proofing D-10 F-8): the service's FIX-3 FIFO
  // ordering calls `asc(strategies.createdAt)`, which this mock never exported. The
  // resulting TypeError was swallowed by the service's own try/catch ("aborting
  // tick"), so cases (a) and (c) had been RED at HEAD — measured, not assumed, by
  // running the unmodified HEAD copy of this file as a probe.
  asc: vi.fn(() => "__asc__"),
  // Still returns the same opaque sentinel the mock db chain expects — the ONLY
  // change is that the template text is recorded on the way through, so the
  // eligibility predicate becomes observable (D-10 F-8).
  sql: new Proxy(
    (strings: TemplateStringsArray, ...values: unknown[]) => {
      const raw = (strings as unknown as { raw?: readonly string[] })?.raw;
      if (Array.isArray(raw)) {
        // Interpolate the VALUES, not a "?" placeholder: the refusal predicate is
        // required to use the shared `BACKTEST_STATUS_REFUSED` constant rather than
        // a bare literal (R-754 §3 amendment 1), so a placeholder-only capture
        // would hide exactly the thing the control has to see.
        sqlMocks.captured.push(
          raw.reduce(
            (acc, part, i) => acc + part + (i < values.length ? String(values[i]) : ""),
            "",
          ),
        );
      }
      return "__sql__";
    },
    { get: () => () => "__sql__" },
  ),
}));

// ── Strategy fixture ─────────────────────────────────────────────────────────
const strategyFixture = {
  id: "00000000-0000-0000-0000-000000000001",
  name: "EMA-Cross MES 5m",
  symbol: "MES",
  lifecycleState: "CANDIDATE",
  config: {
    strategy: {
      name: "EMA-Cross MES 5m",
      symbol: "MES",
      timeframe: "5m",
      indicators: [
        { type: "ema", period: 9 },
        { type: "ema", period: 21 },
      ],
      entry_long: "ema9 > ema21",
      entry_short: "ema9 < ema21",
      exit: "trail_stop",
      stop_loss: { type: "atr", multiplier: 1.5 },
      position_size: { type: "risk_pct", value: 0.01 },
    },
  },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Build a two-call db.select() mock chain.
 *  Call 1: running-count query → [{ c: runningCount }]
 *  Call 2: candidates query   → candidatesResult
 */
function setupSelectMock(runningCount: number, candidatesResult: unknown[]) {
  mockSelectFn
    .mockReturnValueOnce({
      from: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve([{ c: runningCount }])),
      })),
    })
    .mockReturnValueOnce({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          // `.orderBy()` sits between `.where()` and `.limit()` in the real chain
          // (FIX-3 FIFO). Its absence here is what made the tick throw.
          orderBy: vi.fn(() => ({
            limit: vi.fn(() => Promise.resolve(candidatesResult)),
          })),
        })),
      })),
    });
}

/** Build a single-call db.select() mock chain for running-count only. */
function setupSelectMockCountOnly(runningCount: number) {
  mockSelectFn.mockReturnValueOnce({
    from: vi.fn(() => ({
      where: vi.fn(() => Promise.resolve([{ c: runningCount }])),
    })),
  });
}

function setupInsertMock() {
  mockInsertFn.mockReturnValue({
    values: vi.fn(() => ({
      catch: vi.fn(),
    })),
  });
}

// ── Subject under test ───────────────────────────────────────────────────────
import { runCandidateBacktestConveyor } from "../services/candidate-backtest-conveyor-service.js";

// ── Tests ────────────────────────────────────────────────────────────────────
describe("candidate-backtest-conveyor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.MAX_CONCURRENT_BACKTESTS;

    // Default pipeline mode: ACTIVE
    pipelineMocks.getMode.mockResolvedValue("ACTIVE");

    // Default runBacktest result: success with a backtest UUID
    backtestMocks.runBacktest.mockResolvedValue({
      id: "bt-00000000-0000-0000-0000-000000000001",
      status: "running",
    });

    // Default audit insert: no-op
    setupInsertMock();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── (a) Happy path: CANDIDATE → one backtest enqueued with REAL config ───
  it("(a) enqueues one backtest for a zero-backtest CANDIDATE with the real config spread", async () => {
    setupSelectMock(0, [strategyFixture]);

    await runCandidateBacktestConveyor();

    // runBacktest called exactly once
    expect(backtestMocks.runBacktest).toHaveBeenCalledTimes(1);

    const [calledStrategyId, calledCfg, , , , calledActor] =
      backtestMocks.runBacktest.mock.calls[0];

    // Strategy ID forwarded correctly
    expect(calledStrategyId).toBe(strategyFixture.id);

    // actor must be "automated" — never "operator"
    expect(calledActor).toBe("automated");

    // Config must be a REAL spread: all original fields preserved + mode overridden
    expect(calledCfg).toMatchObject({
      ...(strategyFixture.config as Record<string, unknown>),
      mode: "walkforward",
    });

    // Observability: SSE broadcast fired
    expect(sseMocks.broadcastSSE).toHaveBeenCalledWith(
      "factory:candidate_backtest_enqueued",
      expect.objectContaining({ strategyId: strategyFixture.id }),
    );

    // Prometheus counter incremented
    expect(metricsMocks.inc).toHaveBeenCalledTimes(1);

    // Audit log written (non-blocking)
    expect(mockInsertFn).toHaveBeenCalled();
  });

  // ── (b) Slot math: running = cap → no enqueue ────────────────────────────
  it("(b) does not enqueue when running count equals MAX_CONCURRENT_BACKTESTS cap", async () => {
    process.env.MAX_CONCURRENT_BACKTESTS = "1";

    // Only the running-count select is needed (slots ≤ 0 returns early)
    setupSelectMockCountOnly(1); // 1 running, cap=1 → slots=0

    await runCandidateBacktestConveyor();

    // Must not query candidates or call runBacktest
    expect(backtestMocks.runBacktest).not.toHaveBeenCalled();
    expect(sseMocks.broadcastSSE).not.toHaveBeenCalled();
    expect(metricsMocks.inc).not.toHaveBeenCalled();

    // select called only once (running-count check)
    expect(mockSelectFn).toHaveBeenCalledTimes(1);
  });

  // ── (c) Idempotency: second tick returns no candidates ───────────────────
  it("(c) does not double-enqueue when the same strategy is returned by a second tick", async () => {
    // First tick: 1 candidate returned, backtest enqueued
    setupSelectMock(0, [strategyFixture]);

    await runCandidateBacktestConveyor();
    expect(backtestMocks.runBacktest).toHaveBeenCalledTimes(1);

    // Reset select mock for second tick
    mockSelectFn.mockReset();
    setupInsertMock(); // audit insert no-op for second tick

    // Second tick: candidates query now returns [] because the NOT EXISTS
    // subquery on status='running' filters out the strategy that was just
    // handed to runBacktest(). Mock this outcome.
    setupSelectMock(1, []); // 1 running now, OR 0 candidates returned

    await runCandidateBacktestConveyor();

    // runBacktest must NOT have been called a second time
    // (total = 1 from first tick only)
    expect(backtestMocks.runBacktest).toHaveBeenCalledTimes(1);
    expect(metricsMocks.inc).toHaveBeenCalledTimes(1);
  });

  // ── (d) Pipeline paused → 0 enqueued, no DB calls ───────────────────────
  it("(d) skips entirely and makes no DB calls when pipeline mode is PAUSED", async () => {
    pipelineMocks.getMode.mockResolvedValue("PAUSED");

    await runCandidateBacktestConveyor();

    expect(mockSelectFn).not.toHaveBeenCalled();
    expect(backtestMocks.runBacktest).not.toHaveBeenCalled();
    expect(sseMocks.broadcastSSE).not.toHaveBeenCalled();
    expect(metricsMocks.inc).not.toHaveBeenCalled();
  });

  // ── (e) Failed-in-24h guard: candidates filtered out → 0 enqueued ────────
  it("(e) skips strategies with a failed backtest in the last 24h (candidates query returns empty)", async () => {
    // The NOT EXISTS(... AND status='failed' AND created_at >= 24h-ago) clause
    // would exclude the strategy in real DB. Simulate by returning empty candidates.
    setupSelectMock(0, []);

    await runCandidateBacktestConveyor();

    expect(backtestMocks.runBacktest).not.toHaveBeenCalled();
    expect(sseMocks.broadcastSSE).not.toHaveBeenCalled();
    expect(metricsMocks.inc).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D-10 `F-8` (R-754 §3) — a REFUSED backtest is TERMINAL eligibility evidence.
//
// Two distinct defects live in this one file and they need separate controls:
//   (i)  the eligibility query tests only 'completed' / 'running' / 'failed', so a
//        refused candidate stays eligible and is re-enqueued EVERY TICK, forever;
//   (ii) the post-run branch returns early only on "skipped", so a REFUSAL falls
//        through and is counted by candidateConveyorEnqueuedTotal + announced as
//        factory:candidate_backtest_enqueued — a refusal booked as a success.
//
// `F-8` is ordered FIRST of the four because it is the only one that COMPOUNDS.
// ─────────────────────────────────────────────────────────────────────────────
describe("D-10 F-8 — a refused backtest is terminal eligibility evidence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sqlMocks.captured.length = 0;
    delete process.env.MAX_CONCURRENT_BACKTESTS;
    pipelineMocks.getMode.mockResolvedValue("ACTIVE");
    backtestMocks.runBacktest.mockResolvedValue({
      id: "bt-00000000-0000-0000-0000-000000000001",
      status: "running",
    });
    setupInsertMock();
  });

  it("F-8.1 — the eligibility query excludes strategies whose backtest was REFUSED", async () => {
    setupSelectMock(0, []);

    await runCandidateBacktestConveyor();

    const predicate = sqlMocks.captured.join("\n");

    // POSITIVE CONTROL, ASSERTED FIRST: prove the capture instrument actually sees
    // the real WHERE clause. Without this, a capture bug produces an empty string
    // and the 'refused' assertion below would fail for the wrong reason — which
    // would read as a defect in production code that is fine.
    expect(predicate).toContain("b.status = 'completed'");
    expect(predicate).toContain("b.status = 'running'");

    // THE ASSERTION UNDER TEST — RED before the fix. Accepts the constant either
    // quoted or interpolated, because amendment 1 requires the SHARED CONSTANT and
    // the point of the control is the PREDICATE, not its quoting style.
    expect(predicate).toMatch(/b\.status\s*=\s*'?refused'?/);
  });

  it("F-8.2 — a refused run is NOT counted or announced as a successful enqueue", async () => {
    setupSelectMock(0, [strategyFixture]);
    backtestMocks.runBacktest.mockResolvedValue({
      id: "bt-refused-0000-0000-0000-000000000001",
      status: "refused",
    });

    await runCandidateBacktestConveyor();

    // POSITIVE WITNESS THAT THE PATH RAN. Every assertion below is an ABSENCE, and
    // an absence is satisfied by a function that returned early for an unrelated
    // reason. `A NEGATIVE ASSERTION NEEDS A POSITIVE WITNESS THAT THE PATH EXECUTED.`
    expect(backtestMocks.runBacktest).toHaveBeenCalledTimes(1);

    expect(metricsMocks.inc).not.toHaveBeenCalled();
    const events = sseMocks.broadcastSSE.mock.calls.map((c) => c[0] as string);
    expect(events).not.toContain("factory:candidate_backtest_enqueued");
  });

  it("F-8.3 POSITIVE CONTROL — an ordinary candidate still enqueues, counts and announces", async () => {
    // R-754 §3: four of the ten controls are POSITIVE. A conveyor that enqueues
    // nothing would satisfy F-8.2 perfectly and is not a repair.
    setupSelectMock(0, [strategyFixture]);

    await runCandidateBacktestConveyor();

    expect(backtestMocks.runBacktest).toHaveBeenCalledTimes(1);
    expect(metricsMocks.inc).toHaveBeenCalledTimes(1);
    const events = sseMocks.broadcastSSE.mock.calls.map((c) => c[0] as string);
    expect(events).toContain("factory:candidate_backtest_enqueued");
  });
});
