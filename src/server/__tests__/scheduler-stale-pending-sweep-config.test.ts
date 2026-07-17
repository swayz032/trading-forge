/**
 * Tests for scheduler.ts::buildStalePendingSweepTableConfig()
 *
 * deep-scan (DeepAR MED-1, 2026-07-17): 662 `deepar_training_runs` rows were stuck
 * status='running' since 2026-04/05 and never swept by the stale-pending-sweeper
 * cron. Root cause: the sweeper loop hardcoded `(table as any).createdAt` for every
 * table's cutoff comparison, but `deeparTrainingRuns` has no `createdAt` column
 * (schema.ts only defines `trainedAt`, populated via defaultNow() at INSERT time).
 * `.createdAt` silently resolved to `undefined`, so `lt(undefined, cutoff)` never
 * matched a row for that table — every other table in the sweep genuinely has
 * `createdAt` and swept fine.
 *
 * This test imports the real (side-effect-free) schema module directly — schema.ts
 * only defines Drizzle table metadata, it does not open a DB connection — and
 * verifies buildStalePendingSweepTableConfig() resolves a real, defined column
 * for every table, in particular that deepar_training_runs resolves to
 * `trainedAt` (not `createdAt`, not undefined).
 */

import { describe, it, expect, vi } from "vitest";

// ── Mock heavy server dependencies so scheduler.ts can be imported without a
// live DB/network — mirrors the proven pattern in scheduler-retry.test.ts.
// db/schema.js is intentionally NOT mocked: this test needs the real Drizzle
// column objects to verify identity (deeparTrainingRuns.trainedAt vs createdAt).
vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => Promise.resolve([])) })) })),
    execute: vi.fn(() => Promise.resolve([])),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => Promise.resolve([])) })) })),
    insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: vi.fn(() => Promise.resolve([])) })) })),
  },
  client: { end: vi.fn() },
}));
vi.mock("../routes/sse.js", () => ({ broadcastSSE: vi.fn() }));
vi.mock("../index.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../lib/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../services/notification-service.js", () => ({ notifyWarning: vi.fn(), notifyCritical: vi.fn() }));
vi.mock("../services/lifecycle-service.js", () => ({
  LifecycleService: vi.fn().mockImplementation(() => ({
    checkAutoPromotions: vi.fn(() => Promise.resolve([])),
    checkAutoDemotions: vi.fn(() => Promise.resolve([])),
  })),
}));
vi.mock("../services/alert-service.js", () => ({ AlertFactory: { circuitOpen: vi.fn() } }));
vi.mock("../lib/python-runner.js", () => ({ runPythonModule: vi.fn() }));
vi.mock("../services/paper-trading-stream.js", () => ({
  startStream: vi.fn(),
  stopStream: vi.fn(),
  isStreaming: vi.fn(() => false),
  getActiveStreams: vi.fn(() => []),
  getStreamHealth: vi.fn(() => ({})),
  getBarBuffer: vi.fn(() => []),
}));
vi.mock("../services/paper-signal-service.js", () => ({
  restorePositionState: vi.fn(),
  cleanupSession: vi.fn(),
  restoreGovernorState: vi.fn(),
}));
vi.mock("../services/deepar-service.js", () => ({
  trainDeepAR: vi.fn(() => Promise.resolve({})),
  predictRegime: vi.fn(() => Promise.resolve({})),
  validatePastForecasts: vi.fn(() => Promise.resolve({})),
  isDeepARDeferred: vi.fn(() => false),
}));
vi.mock("../lib/circuit-breaker.js", () => ({
  CircuitBreakerRegistry: { setOnStateChange: vi.fn(), statusAll: vi.fn(() => ({})) },
}));

import { buildStalePendingSweepTableConfig, buildStalePendingSweeperTickBeacon } from "../scheduler.js";
import {
  monteCarloRuns,
  sqaOptimizationRuns,
  quboTimingRuns,
  tensorPredictions,
  rlTrainingRuns,
  quantumMcRuns,
  deeparTrainingRuns,
} from "../db/schema.js";

describe("buildStalePendingSweepTableConfig", () => {
  const config = buildStalePendingSweepTableConfig({
    monteCarloRuns,
    sqaOptimizationRuns,
    quboTimingRuns,
    tensorPredictions,
    rlTrainingRuns,
    quantumMcRuns,
    deeparTrainingRuns,
  });

  it("resolves a defined (non-undefined) timestampColumn for every table", () => {
    for (const entry of config) {
      expect(entry.timestampColumn, `table "${entry.name}" resolved an undefined timestampColumn`).toBeDefined();
    }
  });

  it("deepar_training_runs resolves to the trainedAt column, not createdAt", () => {
    const deeparEntry = config.find((e) => e.name === "deepar_training_runs");
    expect(deeparEntry).toBeDefined();
    // The regression: deeparTrainingRuns has no `createdAt` field at all, so a
    // fix that reverted to `(table as any).createdAt` would resolve `undefined`
    // here instead of the real trainedAt column object.
    expect(deeparEntry!.timestampColumn).toBe(deeparTrainingRuns.trainedAt);
    expect((deeparTrainingRuns as unknown as Record<string, unknown>).createdAt).toBeUndefined();
  });

  it("every other table resolves its own createdAt column (identity check)", () => {
    const expectedCreatedAtByName: Record<string, unknown> = {
      monte_carlo_runs: monteCarloRuns.createdAt,
      sqa_optimization_runs: sqaOptimizationRuns.createdAt,
      qubo_timing_runs: quboTimingRuns.createdAt,
      tensor_predictions: tensorPredictions.createdAt,
      rl_training_runs: rlTrainingRuns.createdAt,
      quantum_mc_runs: quantumMcRuns.createdAt,
    };
    for (const [name, expectedColumn] of Object.entries(expectedCreatedAtByName)) {
      const entry = config.find((e) => e.name === name);
      expect(entry, `missing sweep config entry for "${name}"`).toBeDefined();
      expect(entry!.timestampColumn).toBe(expectedColumn);
    }
  });

  it("thresholdMin matches the documented per-table cutoffs (90/60/30 min)", () => {
    const thresholds = Object.fromEntries(config.map((e) => [e.name, e.thresholdMin]));
    expect(thresholds.monte_carlo_runs).toBe(90);
    expect(thresholds.quantum_mc_runs).toBe(60);
    expect(thresholds.sqa_optimization_runs).toBe(30);
    expect(thresholds.qubo_timing_runs).toBe(30);
    expect(thresholds.tensor_predictions).toBe(30);
    expect(thresholds.rl_training_runs).toBe(30);
    expect(thresholds.deepar_training_runs).toBe(30);
  });

  it("covers exactly the 7 fire-and-forget async run tables (no duplicates, none dropped)", () => {
    const names = config.map((e) => e.name).sort();
    expect(names).toEqual([
      "deepar_training_runs",
      "monte_carlo_runs",
      "quantum_mc_runs",
      "qubo_timing_runs",
      "rl_training_runs",
      "sqa_optimization_runs",
      "tensor_predictions",
    ]);
  });
});

/**
 * Tests for scheduler.ts::buildStalePendingSweeperTickBeacon()
 *
 * deep-scan (DeepAR MED-1 liveness follow-up, 2026-07-17): the per-table
 * `.swept` audit rows only fire when a table's swept count is > 0, so a table
 * that silently stops matching (the exact deepar_training_runs regression class
 * this wave fixed) produces ZERO audit trail — indistinguishable from "nothing
 * was ever stale." The unconditional tick beacon closes that gap: every 5-minute
 * tick writes ONE audit row with the full per-table breakdown, 0s included, so
 * the sweeper's execution is durably provable and a future silent-regression on
 * any one table shows up as a persistent 0 in its slot across history.
 */
describe("buildStalePendingSweeperTickBeacon", () => {
  it("includes every configured table plus the 4 hardcoded critic/backtest/agent_jobs sweeps", () => {
    const beacon = buildStalePendingSweeperTickBeacon(
      ["monte_carlo_runs", "deepar_training_runs"],
      { monte_carlo_runs: 0, deepar_training_runs: 0 },
      0,
    );
    expect(beacon.input.tablesChecked).toEqual([
      "monte_carlo_runs",
      "deepar_training_runs",
      "critic_optimization_runs",
      "critic_candidates",
      "backtests",
      "agent_jobs",
    ]);
  });

  it("preserves a zero swept count for a table instead of omitting it — the liveness-critical property", () => {
    // This is the exact regression-detection property: a silently-broken table
    // (e.g. deepar_training_runs matching nothing due to a reverted column fix)
    // must still appear in the beacon with swept=0, not be dropped entirely.
    const beacon = buildStalePendingSweeperTickBeacon(
      ["deepar_training_runs"],
      { deepar_training_runs: 0 },
      0,
    );
    expect(beacon.result.perTableSwept).toHaveProperty("deepar_training_runs", 0);
    expect(beacon.result.totalSwept).toBe(0);
  });

  it("reports the real totalSwept and per-table numbers when rows were genuinely swept", () => {
    const beacon = buildStalePendingSweeperTickBeacon(
      ["monte_carlo_runs", "deepar_training_runs"],
      { monte_carlo_runs: 3, deepar_training_runs: 5 },
      8,
    );
    expect(beacon.result.totalSwept).toBe(8);
    expect(beacon.result.perTableSwept).toEqual({ monte_carlo_runs: 3, deepar_training_runs: 5 });
  });

  it("always emits the same audit action + entityType (stable contract for dashboard/alert consumers)", () => {
    const beacon = buildStalePendingSweeperTickBeacon([], {}, 0);
    expect(beacon.action).toBe("stale-pending-sweeper.tick_completed");
    expect(beacon.entityType).toBe("scheduler_job");
    expect(beacon.status).toBe("success");
  });
});
