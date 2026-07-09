/**
 * deepscan15-fix1-correlation-id-plumbing.test.ts — deep-scan #15 FIX-1 (H1)
 *
 * Two automated backtest triggers were calling runBacktest() without a
 * correlationId, which breaks the 90-day audit reconstruction chain
 * (bar → handler → DB → SSE → audit_log) for backtests fired by:
 *
 *   1. matrix-backtest-service.ts::runMatrix (per-combo runBacktest calls,
 *      via the internal runWithConcurrency helper)
 *   2. shadow-rerun-service.ts::rerunOneStrategy (shadow-rerun runBacktest call)
 *
 * These tests mock backtest-service.js::runBacktest and assert each caller now
 * passes a non-null, non-undefined correlationId as the 5th positional arg
 * (matches the sibling pattern already used by agent-service.ts / evolution-service.ts:
 * runBacktest(strategyId, config, strategyClass, externalId, correlationId)).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Shared mock state ────────────────────────────────────────────────────────

let _runBacktestCalls: unknown[][] = [];
const _runBacktestResult = {
  id: "bt-result-id",
  forge_score: 50,
  sharpe_ratio: 1.2,
  total_trades: 10,
  win_rate: 0.5,
  profit_factor: 1.5,
  avg_daily_pnl: 100,
  max_drawdown: 500,
  tier: "TIER1",
  execution_time_ms: 1000,
  status: "completed",
};

vi.mock("../services/backtest-service.js", () => ({
  runBacktest: vi.fn((...args: unknown[]) => {
    _runBacktestCalls.push(args);
    return Promise.resolve(_runBacktestResult);
  }),
}));

vi.mock("../routes/sse.js", () => ({
  broadcastSSE: vi.fn(),
}));

vi.mock("../index.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((col: unknown, val: unknown) => ({ eq: col, val })),
  and: vi.fn((...c: unknown[]) => ({ and: c })),
  desc: vi.fn((col: unknown) => ({ desc: col })),
  isNotNull: vi.fn((col: unknown) => ({ isNotNull: col })),
  inArray: vi.fn((col: unknown, vals: unknown) => ({ inArray: col, vals })),
}));

vi.mock("../db/schema.js", () => ({
  backtestMatrix: { id: "id", strategyId: "strategy_id", $inferSelect: {} },
  backtests: {
    id: "id",
    strategyId: "strategy_id",
    status: "status",
    createdAt: "created_at",
    dailyPnls: "daily_pnls",
    $inferSelect: {},
  },
  strategies: { id: "id", config: "config", lifecycleState: "lifecycle_state", $inferSelect: {} },
  backtestProvenance: { backtestId: "backtest_id", $inferSelect: {} },
  shadowRerunFindings: {
    id: "srf_id",
    strategyId: "strategy_id",
    backtestId: "backtest_id",
    runAt: "run_at",
    $inferSelect: {},
  },
}));

let _matrixInsertReturning: unknown[] = [{ id: "matrix-run-id-123" }];
let _dbSeq: Array<unknown[]> = [];
let _dbIdx = 0;

vi.mock("../db/index.js", () => {
  const limit = vi.fn(() => {
    const result = _dbIdx < _dbSeq.length ? _dbSeq[_dbIdx++] : [];
    return Promise.resolve(result);
  });
  const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit,
  };
  const insertChain = {
    values: vi.fn().mockReturnThis(),
    returning: vi.fn(() => Promise.resolve(_matrixInsertReturning)),
    onConflictDoNothing: vi.fn(() => Promise.resolve(undefined)),
  };
  const updateChain = {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(undefined),
  };
  return {
    db: {
      select: vi.fn(() => selectChain),
      insert: vi.fn(() => insertChain),
      update: vi.fn(() => updateChain),
    },
  };
});

vi.mock("../services/pipeline-control-service.js", () => ({
  isActive: vi.fn(() => Promise.resolve(true)),
}));

vi.mock("../lib/result-hasher.js", () => ({
  computeResultHash: vi.fn(() => "hash"),
}));

beforeEach(() => {
  vi.clearAllMocks();
  _runBacktestCalls = [];
  _dbSeq = [];
  _dbIdx = 0;
});

// ─── H1.1: matrix-backtest-service.ts ─────────────────────────────────────────

describe("H1 — matrix-backtest-service.ts::runMatrix threads correlationId into runBacktest", () => {
  it("every runBacktest call fired during a matrix run carries the matrix row's own id as correlationId", async () => {
    _matrixInsertReturning = [{ id: "matrix-run-id-456" }];
    _dbSeq = [
      // Strategy lookup at the top of runMatrix
      [{ id: "strategy-xyz", config: { entry_quality: {} } }],
    ];

    const { runMatrix } = await import("../services/matrix-backtest-service.js");

    await runMatrix("strategy-xyz");

    // forgeScore=50 clears TIER1_CUTOFF(30) for all 3 symbols so tier2 also fires;
    // forgeScore=50 < PROMOTION_CUTOFF(60) so tier3 is skipped — at least tier1+tier2 calls exist.
    expect(_runBacktestCalls.length).toBeGreaterThan(0);
    for (const call of _runBacktestCalls) {
      // runBacktest(strategyId, config, strategyClass?, externalId?, correlationId?, ...)
      const correlationId = call[4];
      expect(correlationId).toBeDefined();
      expect(correlationId).not.toBeNull();
      expect(correlationId).toBe("matrix-run-id-456");
    }
  });
});

// ─── H1.2: shadow-rerun-service.ts ────────────────────────────────────────────

describe("H1 — shadow-rerun-service.ts::runShadowRerun threads correlationId into runBacktest", () => {
  it("the shadow-rerun runBacktest call passes a correlationId derived from the original backtestId", async () => {
    // DB call sequence per runShadowRerun (single strategy), mirrors the existing
    // shadow-rerun-service.test.ts documented sequence:
    //   [0] candidateStrategies query   → [{ strategyId }]
    //   [1] latest backtest per strat   → [{ id }]
    //   [2] original backtest (rerun)   → [backtest row]
    //   [3] provenance row (rerun)      → [provenance row]
    //   [4] shadow backtest (after run) → [shadow backtest row]
    _dbSeq = [
      [{ strategyId: "strategy-abc" }],
      [{ id: "original-bt-id-789" }],
      [{
        id: "original-bt-id-789",
        config: { entry_quality: {} },
        profitFactor: "1.5",
        sharpeRatio: "1.2",
        maxDrawdown: "500",
      }],
      [{ backtestId: "original-bt-id-789", resultHash: "oldhash", codeGitSha: "abc123" }],
      [{ id: "bt-result-id", profitFactor: "1.6", sharpeRatio: "1.3", maxDrawdown: "480" }],
    ];

    const { runShadowRerun } = await import("../services/shadow-rerun-service.js");

    await runShadowRerun("scheduled_shadow_rerun", ["strategy-abc"]);

    expect(_runBacktestCalls.length).toBe(1);
    const call = _runBacktestCalls[0]!;
    const correlationId = call[4];
    expect(correlationId).toBeDefined();
    expect(correlationId).not.toBeNull();
    // Must be DERIVED from the original backtestId, not a bare passthrough of undefined
    expect(String(correlationId)).toContain("original-bt-id-789");
  });
});
