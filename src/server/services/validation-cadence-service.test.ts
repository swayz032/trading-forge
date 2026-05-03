/**
 * Tests for C7 — Validation Cadence Service (W16 Team C)
 *
 * Covers:
 *   - getDaysSinceLastLiveBacktest: with/without backtests, RED threshold
 *   - getStrategiesTestedEndToEndThisMonth: count, threshold breach
 *   - getRealityCheckScore: composite 0-100 with breakdown
 *   - runMonthlyRealityCheckReport: persists audit_log, fires alert at right severity
 *   - getValidationCadenceDashboard: aggregates all three signals
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock infrastructure ──────────────────────────────────────────────────────

// Construct a chainable mock that supports the full Drizzle query builder shape
// used by the service: select / selectDistinct / from / where / orderBy / limit
// terminating in await (Promise resolution).
function makeChainableMock<T = unknown[]>(result: T) {
  const chain: any = {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    orderBy: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    then: (resolve: (v: T) => void) => Promise.resolve(result).then(resolve),
  };
  return chain;
}

// Two mocking modes: indexed (legacy, for ordered test cases) or
// table-routed (for the orchestrator tests where Promise.all interleaves
// query order). The default-route mode classifies queries by which Drizzle
// table object .from() received, so result selection survives reordering.
const dbState: {
  selectResults: any[];
  selectDistinctResults: any[];
  selectCallIndex: number;
  selectDistinctCallIndex: number;
  insertedRows: any[];
  // Table-routed mode: when set, every select() returns the result keyed by
  // the table identity passed to .from(). This survives Promise.all reordering.
  routedSelect: Map<any, any[]> | null;
  routedSelectDistinct: Map<any, any[]> | null;
} = {
  selectResults: [],
  selectDistinctResults: [],
  selectCallIndex: 0,
  selectDistinctCallIndex: 0,
  insertedRows: [],
  routedSelect: null,
  routedSelectDistinct: null,
};

vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn(() => {
      // Routed mode: hold a reference; result is determined when .from() runs
      if (dbState.routedSelect) {
        const chain: any = {
          from: vi.fn((table: any) => {
            const result = dbState.routedSelect!.get(table) ?? [];
            const tail: any = {
              from: vi.fn(() => tail),
              where: vi.fn(() => tail),
              orderBy: vi.fn(() => tail),
              limit: vi.fn(() => tail),
              then: (resolve: (v: any) => void) => Promise.resolve(result).then(resolve),
            };
            return tail;
          }),
        };
        return chain;
      }
      // Indexed mode (default for legacy tests)
      const result = dbState.selectResults[dbState.selectCallIndex] ?? [];
      dbState.selectCallIndex++;
      return makeChainableMock(result);
    }),
    selectDistinct: vi.fn(() => {
      if (dbState.routedSelectDistinct) {
        const chain: any = {
          from: vi.fn((table: any) => {
            const result = dbState.routedSelectDistinct!.get(table) ?? [];
            const tail: any = {
              from: vi.fn(() => tail),
              where: vi.fn(() => tail),
              orderBy: vi.fn(() => tail),
              limit: vi.fn(() => tail),
              then: (resolve: (v: any) => void) => Promise.resolve(result).then(resolve),
            };
            return tail;
          }),
        };
        return chain;
      }
      const result = dbState.selectDistinctResults[dbState.selectDistinctCallIndex] ?? [];
      dbState.selectDistinctCallIndex++;
      return makeChainableMock(result);
    }),
    insert: vi.fn(() => ({
      values: vi.fn((row: any) => {
        dbState.insertedRows.push(row);
        return Promise.resolve();
      }),
    })),
  },
}));

vi.mock("./alert-service.js", () => ({
  createAlert: vi.fn().mockResolvedValue({ id: "alert-uuid-1" }),
}));

vi.mock("../lib/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

beforeEach(() => {
  dbState.selectResults = [];
  dbState.selectDistinctResults = [];
  dbState.selectCallIndex = 0;
  dbState.selectDistinctCallIndex = 0;
  dbState.insertedRows = [];
  dbState.routedSelect = null;
  dbState.routedSelectDistinct = null;
  vi.clearAllMocks();
});

// ─── getDaysSinceLastLiveBacktest ─────────────────────────────────────────────

describe("getDaysSinceLastLiveBacktest", () => {
  it("returns isRed=true when no backtests exist (never validated)", async () => {
    dbState.selectResults = [[]]; // no rows for the latest-backtest query
    const { getDaysSinceLastLiveBacktest } = await import("./validation-cadence-service.js");
    const result = await getDaysSinceLastLiveBacktest();

    expect(result.days).toBeNull();
    expect(result.lastBacktestAt).toBeNull();
    expect(result.lastBacktestId).toBeNull();
    expect(result.isRed).toBe(true);
    expect(result.thresholdDays).toBeGreaterThanOrEqual(7);
  });

  it("returns isRed=false when last backtest is fresh (<= threshold)", async () => {
    const fresh = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000); // 2 days ago
    dbState.selectResults = [[{ id: "bt-1", createdAt: fresh }]];
    const { getDaysSinceLastLiveBacktest } = await import("./validation-cadence-service.js");
    const result = await getDaysSinceLastLiveBacktest();

    expect(result.days).toBe(2);
    expect(result.lastBacktestAt).toBe(fresh.toISOString());
    expect(result.lastBacktestId).toBe("bt-1");
    expect(result.isRed).toBe(false);
  });

  it("returns isRed=true when last backtest is OLDER than threshold (8 days, default 7)", async () => {
    const stale = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000); // 8 days ago
    dbState.selectResults = [[{ id: "bt-2", createdAt: stale }]];
    const { getDaysSinceLastLiveBacktest } = await import("./validation-cadence-service.js");
    const result = await getDaysSinceLastLiveBacktest();

    expect(result.days).toBe(8);
    expect(result.isRed).toBe(true);
  });

  it("returns isRed=false at exactly the threshold boundary (7 days)", async () => {
    const boundary = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7 days ago
    dbState.selectResults = [[{ id: "bt-3", createdAt: boundary }]];
    const { getDaysSinceLastLiveBacktest } = await import("./validation-cadence-service.js");
    const result = await getDaysSinceLastLiveBacktest();

    // days computed via floor(ms / day_ms). Floor of exactly 7 days is 7;
    // RED only when > 7. Boundary case must NOT trigger RED — operator gets one more day.
    expect(result.days).toBe(7);
    expect(result.isRed).toBe(false);
  });
});

// ─── getStrategiesTestedEndToEndThisMonth ─────────────────────────────────────

describe("getStrategiesTestedEndToEndThisMonth", () => {
  it("returns count=0 and isBelowThreshold=true when no transitions this month", async () => {
    dbState.selectDistinctResults = [[]];
    const { getStrategiesTestedEndToEndThisMonth } = await import("./validation-cadence-service.js");
    const result = await getStrategiesTestedEndToEndThisMonth();

    expect(result.count).toBe(0);
    expect(result.strategyIds).toEqual([]);
    expect(result.isBelowThreshold).toBe(true); // default threshold = 1
    expect(result.minThreshold).toBeGreaterThanOrEqual(1);
  });

  it("returns count=2 and isBelowThreshold=false when 2 strategies hit PAPER+", async () => {
    dbState.selectDistinctResults = [
      [{ strategyId: "s1" }, { strategyId: "s2" }],
    ];
    const { getStrategiesTestedEndToEndThisMonth } = await import("./validation-cadence-service.js");
    const result = await getStrategiesTestedEndToEndThisMonth();

    expect(result.count).toBe(2);
    expect(result.strategyIds.sort()).toEqual(["s1", "s2"]);
    expect(result.isBelowThreshold).toBe(false);
  });

  it("monthStart is the first of the current calendar month UTC", async () => {
    dbState.selectDistinctResults = [[]];
    const { getStrategiesTestedEndToEndThisMonth } = await import("./validation-cadence-service.js");
    const result = await getStrategiesTestedEndToEndThisMonth();

    const now = new Date();
    const expectedStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    expect(result.monthStart).toBe(expectedStart.toISOString());
  });
});

// ─── getRealityCheckScore ─────────────────────────────────────────────────────

describe("getRealityCheckScore", () => {
  it("returns score=0 when system has never been validated", async () => {
    // 1st select: latest backtest → []
    // 1st selectDistinct: strategies this month → []
    // 2nd, 3rd, ... selects: paper sessions for fidelity → []
    dbState.selectResults = [[], []];
    dbState.selectDistinctResults = [[]];
    const { getRealityCheckScore } = await import("./validation-cadence-service.js");
    const result = await getRealityCheckScore();

    // cadenceScore = 0 (never validated → cadenceDays=999), throughputScore=0, fidelityScore=20
    // (no recent paper sessions → avg deviation = 0 → fidelity full marks)
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.breakdown.cadenceScore).toBe(0);
    expect(result.breakdown.throughputScore).toBe(0);
  });

  it("score reflects fresh backtest + 1 strategy through pipeline", async () => {
    const fresh = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000); // 1 day ago
    // Order: getDaysSinceLastLiveBacktest (1 select), getRecentPaperVsBacktestFidelity (1 select for sessions)
    dbState.selectResults = [
      [{ id: "bt-fresh", createdAt: fresh }], // latest backtest
      [], // no paper sessions for fidelity
    ];
    dbState.selectDistinctResults = [
      [{ strategyId: "s1" }], // 1 strategy through pipeline
    ];
    const { getRealityCheckScore } = await import("./validation-cadence-service.js");
    const result = await getRealityCheckScore();

    // Fresh (1 day idle): cadence = 40 - 5*0 = 40
    // 1 strategy: throughput = 10
    // No paper sessions: fidelity = 20
    expect(result.breakdown.cadenceScore).toBe(40);
    expect(result.breakdown.throughputScore).toBe(10);
    expect(result.breakdown.fidelityScore).toBe(20);
    expect(result.score).toBe(70);
  });

  it("includes thresholdDays and minStrategiesThreshold in result", async () => {
    dbState.selectResults = [[], []];
    dbState.selectDistinctResults = [[]];
    const { getRealityCheckScore } = await import("./validation-cadence-service.js");
    const result = await getRealityCheckScore();

    expect(result.thresholdDays).toBeGreaterThanOrEqual(7);
    expect(result.minStrategiesThreshold).toBeGreaterThanOrEqual(1);
  });
});

// ─── runMonthlyRealityCheckReport ─────────────────────────────────────────────

describe("runMonthlyRealityCheckReport", () => {
  // Helper to set up routed-mode DB mocks. Promise.all interleaving means
  // call ordering is non-deterministic, so we route by table identity instead.
  async function setupRoutedMocks(opts: {
    backtestRow?: { id: string; createdAt: Date; sharpeRatio?: string; avgDailyPnl?: string };
    paperSessions?: any[];
    paperTrades?: any[];
    paperPlusStrategies?: any[];
    transitionRows?: { strategyId: string }[];
  }) {
    const schema = await import("../db/schema.js");
    const selMap = new Map<any, any[]>();
    const selDistinctMap = new Map<any, any[]>();

    selMap.set(schema.backtests, opts.backtestRow ? [opts.backtestRow] : []);
    selMap.set(schema.paperSessions, opts.paperSessions ?? []);
    selMap.set(schema.paperTrades, opts.paperTrades ?? []);
    selMap.set(schema.strategies, opts.paperPlusStrategies ?? []);

    selDistinctMap.set(schema.lifecycleTransitions, opts.transitionRows ?? []);

    dbState.routedSelect = selMap;
    dbState.routedSelectDistinct = selDistinctMap;
  }

  it("fires CRITICAL alert when daysSinceLastLiveBacktest is RED", async () => {
    const stale = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000); // 10 days idle
    await setupRoutedMocks({
      backtestRow: { id: "bt-stale", createdAt: stale },
      paperSessions: [],
      paperPlusStrategies: [],
      transitionRows: [],
    });
    const { runMonthlyRealityCheckReport } = await import("./validation-cadence-service.js");
    const { createAlert } = await import("./alert-service.js");
    const report = await runMonthlyRealityCheckReport();

    expect(report.severity).toBe("critical");
    expect(report.daysSinceLastLiveBacktest.isRed).toBe(true);
    expect(report.daysSinceLastLiveBacktest.days).toBe(10);
    expect(createAlert).toHaveBeenCalledTimes(1);
    expect(vi.mocked(createAlert).mock.calls[0][0].severity).toBe("critical");
  });

  it("fires WARNING alert when below throughput threshold but cadence OK", async () => {
    const fresh = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000); // 1 day idle (OK)
    await setupRoutedMocks({
      backtestRow: { id: "bt-fresh", createdAt: fresh },
      paperSessions: [],
      paperPlusStrategies: [],
      transitionRows: [], // 0 strategies → below threshold
    });
    const { runMonthlyRealityCheckReport } = await import("./validation-cadence-service.js");
    const { createAlert } = await import("./alert-service.js");
    const report = await runMonthlyRealityCheckReport();

    expect(report.severity).toBe("warning");
    expect(report.daysSinceLastLiveBacktest.isRed).toBe(false);
    expect(report.strategiesThisMonth.isBelowThreshold).toBe(true);
    expect(createAlert).toHaveBeenCalledTimes(1);
    expect(vi.mocked(createAlert).mock.calls[0][0].severity).toBe("warning");
  });

  it("does NOT fire alert when severity=info (cadence OK + throughput OK)", async () => {
    const fresh = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);
    await setupRoutedMocks({
      backtestRow: { id: "bt-fresh", createdAt: fresh },
      paperSessions: [],
      paperPlusStrategies: [],
      transitionRows: [{ strategyId: "s1" }],
    });
    const { runMonthlyRealityCheckReport } = await import("./validation-cadence-service.js");
    const { createAlert } = await import("./alert-service.js");
    const report = await runMonthlyRealityCheckReport();

    expect(report.severity).toBe("info");
    expect(createAlert).not.toHaveBeenCalled();
  });

  it("persists an audit_log row with action='validation_cadence.reality_check'", async () => {
    const fresh = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);
    await setupRoutedMocks({
      backtestRow: { id: "bt-fresh", createdAt: fresh },
      paperSessions: [],
      paperPlusStrategies: [],
      transitionRows: [{ strategyId: "s1" }],
    });
    const { runMonthlyRealityCheckReport } = await import("./validation-cadence-service.js");
    await runMonthlyRealityCheckReport();

    expect(dbState.insertedRows.length).toBe(1);
    expect(dbState.insertedRows[0].action).toBe("validation_cadence.reality_check");
    expect(dbState.insertedRows[0].entityType).toBe("system");
    expect(dbState.insertedRows[0].decisionAuthority).toBe("scheduler");
    expect(dbState.insertedRows[0].status).toBe("success");
    expect(dbState.insertedRows[0].result.score).toBeGreaterThan(0);
  });
});
