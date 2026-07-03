/**
 * deepscan8-mc-ruin-basis.test.ts — deep-scan #8 2026-07-02
 *
 * Tests the mc:completed SSE payload ruin_basis field and survivalRate computation.
 *
 * Fix: monte-carlo-service.ts SSE broadcast now prefers
 * result.risk_metrics.probability_of_ruin_ci.point_estimate (firm-breach basis)
 * over result.risk_metrics.probability_of_ruin (terminal-negative scalar).
 * Falls back to scalar for legacy runs where ci is absent.
 *
 * Column write is UNCHANGED — downstream consumers (carter, lifecycle, critic,
 * quantum-mc, pine-export, routes) read probabilityOfRuin expecting the
 * terminal-negative scalar; only the SSE broadcast and auto-matrix trigger
 * change basis.
 *
 * DB mock pattern:
 *   The db mock is made THENABLE (has `.then`) so that queries ending at
 *   `.where()` (like the backtestTrades query) resolve to [] by default.
 *   Queries ending at `.limit()` or `.returning()` use their own mock Promises.
 *   This is the established pattern for services where some queries omit .limit().
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── DB mock factory — must be self-contained (vi.mock hoisting) ──────────────

vi.mock("../db/index.js", () => {
  // Build a mock db that is both chainable AND thenable.
  // Methods that form the query chain return `db` so they can be chained.
  // The `then` property makes `await db.chain()` resolve to [] by default.
  // Terminal methods (.limit, .returning) return their own Promises.
  const db: Record<string, ReturnType<typeof vi.fn>> = {
    select:    vi.fn(),
    insert:    vi.fn(),
    update:    vi.fn(),
    from:      vi.fn(),
    where:     vi.fn(),
    set:       vi.fn(),
    values:    vi.fn(),
    orderBy:   vi.fn(),
    limit:     vi.fn(),
    returning: vi.fn(),
    // Make db thenable: `await db.where(...)` resolves to [] for terminal queries
    then: vi.fn((onFulfilled: (v: unknown) => unknown) =>
      typeof onFulfilled === "function"
        ? Promise.resolve(onFulfilled([]))
        : Promise.resolve([])
    ),
  };
  const chainKeys = ["select", "insert", "update", "from", "where", "set", "values", "orderBy"];
  for (const k of chainKeys) db[k].mockReturnValue(db);
  db.limit.mockResolvedValue([]);
  db.returning.mockResolvedValue([{ id: "mc-id-1" }]);
  return { db };
});

vi.mock("../routes/sse.js",        () => ({ broadcastSSE: vi.fn() }));
vi.mock("../index.js",             () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../lib/tracing.js",       () => ({
  tracer: { startSpan: vi.fn().mockReturnValue({ setAttribute: vi.fn(), end: vi.fn() }) },
}));
vi.mock("../lib/python-runner.js", () => ({ runPythonModule: vi.fn() }));
vi.mock("../services/matrix-backtest-service.js",  () => ({ runMatrix: vi.fn().mockResolvedValue({ id: "mx-1", status: "completed" }) }));
vi.mock("../services/quantum-mc-service.js",       () => ({ runQuantumMC: vi.fn().mockResolvedValue({ id: "qmc-1", status: "completed" }) }));
vi.mock("../services/pine-export-service.js",      () => ({ compilePineExport: vi.fn().mockResolvedValue({ id: "pe-1" }) }));
vi.mock("../lib/dlq-service.js",           () => ({ captureToDLQ: vi.fn() }));
vi.mock("../services/notification-service.js",     () => ({ notifyCritical: vi.fn() }));
vi.mock("../lib/notification-helpers.js",  () => ({ appendFamilyGradePostscript: vi.fn().mockResolvedValue("") }));
vi.mock("../lib/firm-rules-version.js",    () => ({ computeFirmRulesVersion: vi.fn().mockReturnValue("v-test-hash") }));

// ─── SUT imports (after mocks) ────────────────────────────────────────────────

import { runMonteCarlo } from "../services/monte-carlo-service.js";
import { broadcastSSE } from "../routes/sse.js";
import { runPythonModule } from "../lib/python-runner.js";
import { db } from "../db/index.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const dbAny = db as any;

// ─── Fixture helpers ──────────────────────────────────────────────────────────

const BACKTEST_ID = "bt-dead-beef-0001";

function makeBacktest(override: Record<string, unknown> = {}) {
  return {
    id:             BACKTEST_ID,
    strategyId:     "strat-1",
    status:         "completed",
    resultExtras:   null,
    propCompliance: null,
    config:         {},
    ...override,
  };
}

function makeMcResult(riskMetrics: Record<string, unknown>) {
  return {
    num_simulations: 1000,
    method: "trade_resample",
    confidence_intervals: { max_drawdown: {}, sharpe_ratio: {} },
    risk_metrics: riskMetrics,
    paths: [],
    execution_time_ms: 50,
    gpu_accelerated: false,
  };
}

// Set up the stateful limit mock so first .limit() call returns the backtest fixture.
function setupDbForBacktest(backtest: Record<string, unknown>) {
  let limitCallCount = 0;
  dbAny.limit.mockImplementation(() => {
    limitCallCount++;
    if (limitCallCount === 1) return Promise.resolve([backtest]); // backtests query
    return Promise.resolve([]);                                   // strategies / any later
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("mc:completed SSE payload — ruin_basis field (deep-scan #8 2026-07-02)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-wire chain methods (clearAllMocks clears .mock history but not implementations;
    // re-wiring is defensive in case mockReturnValue was stale)
    const chainKeys = ["select", "insert", "update", "from", "where", "set", "values", "orderBy"];
    for (const k of chainKeys) dbAny[k].mockReturnValue(dbAny);
    dbAny.limit.mockResolvedValue([]);
    dbAny.returning.mockResolvedValue([{ id: "mc-id-1" }]);
    // Restore thenable behavior
    dbAny.then.mockImplementation((onFulfilled: (v: unknown) => unknown) =>
      typeof onFulfilled === "function"
        ? Promise.resolve(onFulfilled([]))
        : Promise.resolve([])
    );
  });

  it("uses probability_of_ruin_ci.point_estimate when present and emits ruin_basis from ci", async () => {
    setupDbForBacktest(makeBacktest());
    vi.mocked(runPythonModule).mockResolvedValue(makeMcResult({
      probability_of_ruin:    0.40,   // terminal-negative scalar
      probability_of_ruin_ci: {
        point_estimate: 0.12,          // firm-breach point estimate
        ruin_basis:    "firm_breach",
        ci_high:        0.18,
      },
    }));

    await runMonteCarlo(BACKTEST_ID, {});

    expect(broadcastSSE).toHaveBeenCalledWith(
      "mc:completed",
      expect.objectContaining({
        survivalRate: 0.88,             // 1 - 0.12 (ci.point_estimate, NOT scalar 0.40)
        ruin_basis:  "firm_breach",
      }),
    );
  });

  it("falls back to terminal-negative scalar when ci is absent; emits ruin_basis='terminal_negative_legacy'", async () => {
    setupDbForBacktest(makeBacktest());
    vi.mocked(runPythonModule).mockResolvedValue(makeMcResult({
      probability_of_ruin: 0.25,       // no ci present
    }));

    await runMonteCarlo(BACKTEST_ID, {});

    expect(broadcastSSE).toHaveBeenCalledWith(
      "mc:completed",
      expect.objectContaining({
        survivalRate: 0.75,             // 1 - 0.25 (scalar fallback)
        ruin_basis:  "terminal_negative_legacy",
      }),
    );
  });

  it("treats ci.point_estimate=0 as valid (zero ruin → survivalRate=1.00)", async () => {
    setupDbForBacktest(makeBacktest());
    vi.mocked(runPythonModule).mockResolvedValue(makeMcResult({
      probability_of_ruin:    0.30,
      probability_of_ruin_ci: { point_estimate: 0, ruin_basis: "firm_breach" },
    }));

    await runMonteCarlo(BACKTEST_ID, {});

    expect(broadcastSSE).toHaveBeenCalledWith(
      "mc:completed",
      expect.objectContaining({
        survivalRate: 1,
        ruin_basis:  "firm_breach",
      }),
    );
  });

  it("falls back when ci.point_estimate is undefined (but ci object exists)", async () => {
    setupDbForBacktest(makeBacktest());
    vi.mocked(runPythonModule).mockResolvedValue(makeMcResult({
      probability_of_ruin:    0.30,
      probability_of_ruin_ci: { ruin_basis: "firm_breach" }, // point_estimate missing
    }));

    await runMonteCarlo(BACKTEST_ID, {});

    expect(broadcastSSE).toHaveBeenCalledWith(
      "mc:completed",
      expect.objectContaining({
        survivalRate: 0.7,              // 1 - 0.30 (scalar; point_estimate undefined)
        ruin_basis:  "terminal_negative_legacy",
      }),
    );
  });

  it("db column probabilityOfRuin is written from terminal-negative scalar (not ci.point_estimate)", async () => {
    setupDbForBacktest(makeBacktest());
    vi.mocked(runPythonModule).mockResolvedValue(makeMcResult({
      probability_of_ruin:    0.35,   // scalar → must be written to DB
      probability_of_ruin_ci: { point_estimate: 0.10, ruin_basis: "firm_breach" },
    }));

    await runMonteCarlo(BACKTEST_ID, {});

    // Find the update(monteCarloRuns).set({...}) call containing probabilityOfRuin
    const setCalls = (dbAny.set.mock.calls as Array<[Record<string, unknown>]>);
    const mcUpdateCall = setCalls.find(([arg]) => arg && "probabilityOfRuin" in arg);
    expect(mcUpdateCall).toBeDefined();
    // Must be String(0.35) — the terminal-negative scalar, NOT String(0.10)
    expect(mcUpdateCall![0].probabilityOfRuin).toBe("0.35");
  });
});
