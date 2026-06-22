/**
 * b14-ruin-ci.integration.test.ts — Wave hardening 2026-06-22, pglite real-DB test layer
 *
 * Integration test: the B14 ci_high key path round-trips through a REAL in-memory
 * PostgreSQL (PGlite) DB, not a mock.
 *
 * TARGET BUG — B14 ci_high key-path disconnect (2026-06-22):
 *   Before 2026-06-22, TWO silent failures prevented B14 from ever using BCa ci_high:
 *   1. BCa OOM (MC_BCA_MAX_SAMPLE env var missing → scipy consumed all RAM and
 *      returned NaN, which the gate silently treated as PASS).
 *   2. Wrong dict key: Python wrote `bca_confidence_intervals.probability_of_ruin_ci`
 *      but TS read `risk_metrics.probability_of_ruin_ci` — the JSONB paths differed.
 *
 *   Both are now fixed (F1: MC_BCA_MAX_SAMPLE=5000; F2: firm-breach ruin definition).
 *   This test proves the FULL key path: INSERT risk_metrics JSONB with the correct
 *   structure → SELECT and parse → evaluateB14CiGate receives the ci_high value →
 *   gate result is driven by ci_high, NOT the legacy scalar fallback.
 *
 * WHAT IS TESTED:
 *   1. Insert a monte_carlo_runs row with risk_metrics JSONB containing
 *      probability_of_ruin_ci.ci_high = 0.55 (above threshold 0.40).
 *   2. SELECT the row via Drizzle and extract risk_metrics.probability_of_ruin_ci.
 *   3. Call evaluateB14CiGate(ruinCi, scalar) and assert:
 *      - passed = false (blocked because 0.55 > 0.40)
 *      - legacyFallback = false (ci_high was available, scalar NOT used)
 *      - auditPayload.ci_high = 0.55 (key path round-tripped correctly)
 *   4. Repeat with ci_high = 0.35 (below threshold) and assert passed = true.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "../helpers/pglite-db.js";
import type { TestDb } from "../helpers/pglite-db.js";
import { evaluateB14CiGate } from "../../lib/b14-ci-gate.js";
import { monteCarloRuns, backtests, strategies } from "../../db/schema.js";

// ─── Test fixtures ─────────────────────────────────────────────────────────────

const STRATEGY_UUID  = "22222222-2222-2222-2222-222222222222";
const BACKTEST_UUID  = "33333333-3333-3333-3333-333333333333";
const MC_RUN_HIGH    = "44444444-4444-4444-4444-444444444444"; // ci_high > threshold → BLOCK
const MC_RUN_LOW     = "55555555-5555-5555-5555-555555555555"; // ci_high < threshold → PASS

// The risk_metrics JSONB structure that Python now emits after F2 fix.
// Key: probability_of_ruin_ci (at the TOP LEVEL of risk_metrics,
// NOT nested under bca_confidence_intervals — that was the pre-fix wrong path).
const riskMetricsHigh = {
  probability_of_ruin: 0.52,
  probability_of_ruin_ci: {
    point_estimate: 0.52,
    ci_low: 0.45,
    ci_high: 0.55,           // above threshold 0.40 → gate should BLOCK
    ci_method: "bca",
    n_resamples: 5000,
    standard_error: 0.03,
  },
  max_drawdown_p95: 0.18,
};

const riskMetricsLow = {
  probability_of_ruin: 0.28,
  probability_of_ruin_ci: {
    point_estimate: 0.28,
    ci_low: 0.22,
    ci_high: 0.35,           // below threshold 0.40 → gate should PASS
    ci_method: "bca",
    n_resamples: 5000,
    standard_error: 0.02,
  },
  max_drawdown_p95: 0.12,
};

// ─── Test suite ───────────────────────────────────────────────────────────────

describe("b14-ruin-ci.integration — ci_high key-path round-trip", () => {
  let ctx: TestDb;

  beforeAll(async () => {
    ctx = await createTestDb();

    // Seed: strategy → backtest → two MC run rows
    await ctx.db.insert(strategies).values({
      id: STRATEGY_UUID,
      name: "b14-test-strategy",
      symbol: "MES",
      timeframe: "5m",
      config: {},
    });

    await ctx.db.insert(backtests).values({
      id: BACKTEST_UUID,
      strategyId: STRATEGY_UUID,
      symbol: "MES",
      timeframe: "5m",
      startDate: new Date("2025-01-01"),
      endDate: new Date("2025-06-01"),
      status: "completed",
    });

    // MC run with ci_high ABOVE threshold (should block)
    await ctx.db.insert(monteCarloRuns).values({
      id: MC_RUN_HIGH,
      backtestId: BACKTEST_UUID,
      status: "completed",
      numSimulations: 5000,
      probabilityOfRuin: "0.52",
      riskMetrics: riskMetricsHigh,
    });

    // MC run with ci_high BELOW threshold (should pass)
    await ctx.db.insert(monteCarloRuns).values({
      id: MC_RUN_LOW,
      backtestId: BACKTEST_UUID,
      status: "completed",
      numSimulations: 5000,
      probabilityOfRuin: "0.28",
      riskMetrics: riskMetricsLow,
    });
  });

  afterAll(async () => {
    await ctx.close();
  });

  it("round-trips risk_metrics JSONB through PGlite without data loss", async () => {
    const [row] = await ctx.db
      .select({ riskMetrics: monteCarloRuns.riskMetrics })
      .from(monteCarloRuns)
      .where(eq(monteCarloRuns.id, MC_RUN_HIGH));

    // The JSONB round-trip must preserve the full nested structure
    expect(row).toBeDefined();
    expect(row.riskMetrics).toBeDefined();

    const rm = row.riskMetrics as typeof riskMetricsHigh;
    expect(rm.probability_of_ruin_ci).toBeDefined();
    expect(rm.probability_of_ruin_ci.ci_high).toBe(0.55);
    expect(rm.probability_of_ruin_ci.ci_method).toBe("bca");
    expect(rm.probability_of_ruin_ci.n_resamples).toBe(5000);
  });

  it("B14 gate blocks when ci_high > 0.40 (ci_high = 0.55)", async () => {
    // Read the row and extract the ruinCi dict — this is the key path under test
    const [row] = await ctx.db
      .select({ riskMetrics: monteCarloRuns.riskMetrics })
      .from(monteCarloRuns)
      .where(eq(monteCarloRuns.id, MC_RUN_HIGH));

    const rm = row.riskMetrics as typeof riskMetricsHigh;
    const ruinCi = rm.probability_of_ruin_ci;

    const result = evaluateB14CiGate(ruinCi, rm.probability_of_ruin);

    // Should be BLOCKED — ci_high = 0.55 > threshold 0.40
    expect(result.passed).toBe(false);

    // Critically: the BCa ci_high was used — NOT the scalar fallback.
    // If legacyFallback were true, it means ci_high was missing from the JSONB
    // and the old pre-fix key-path disconnect bug is present.
    expect(result.legacyFallback).toBe(false);

    // The audit payload must show the actual ci_high, not null
    expect(result.auditPayload.ci_high).toBeCloseTo(0.55, 4);
    expect(result.auditPayload.blocked).toBe(true);
    expect(result.auditPayload.legacy_ruin_scalar_fallback).toBe(false);
  });

  it("B14 gate passes when ci_high <= 0.40 (ci_high = 0.35)", async () => {
    const [row] = await ctx.db
      .select({ riskMetrics: monteCarloRuns.riskMetrics })
      .from(monteCarloRuns)
      .where(eq(monteCarloRuns.id, MC_RUN_LOW));

    const rm = row.riskMetrics as typeof riskMetricsLow;
    const ruinCi = rm.probability_of_ruin_ci;

    const result = evaluateB14CiGate(ruinCi, rm.probability_of_ruin);

    // Should PASS — ci_high = 0.35 ≤ threshold 0.40
    expect(result.passed).toBe(true);
    expect(result.legacyFallback).toBe(false);
    expect(result.auditPayload.ci_high).toBeCloseTo(0.35, 4);
    expect(result.auditPayload.blocked).toBe(false);
  });

  it("B14 gate falls back to scalar when probability_of_ruin_ci is absent from risk_metrics", async () => {
    // Simulate a pre-fix MC run where risk_metrics lacked probability_of_ruin_ci
    // (the wrong-key-path bug: Python wrote it under bca_confidence_intervals, not here)
    const result = evaluateB14CiGate(
      null,   // no ruinCi dict — the pre-fix state
      0.51,   // scalar point estimate above threshold
      0.40,   // explicit threshold
    );

    // Scalar > threshold → blocked, but via legacy fallback
    expect(result.passed).toBe(false);
    expect(result.legacyFallback).toBe(true);
    expect(result.auditPayload.legacy_ruin_scalar_fallback).toBe(true);
  });
});
