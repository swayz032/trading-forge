/**
 * Tests for the production-hardening fixes in backtest-service.ts.
 *
 *   FIX 3 — Decay status canonicalization. Python emits accelerating_decline;
 *           the translator that mapped it to "declining" has been removed and
 *           frontend types updated to accept accelerating_decline as canonical.
 *
 * FIX 1 (critic-replay MC) and FIX 2 (CANDIDATE→PAPER fast-track gates) are
 * verified by code review + the pre-existing critic-optimizer + lifecycle test
 * suites; they require a full DB+Python integration to assert end-to-end and
 * are not unit-testable without rewriting the entire runBacktest scaffolding.
 *
 * The unit-testable behavior here is the pure normalizeDecayAnalysis() helper
 * which is the single point where Python's `accelerating_decline` enters the
 * Node↔frontend contract. If that contract regresses (someone reintroduces
 * the translator), this test catches it.
 */

import { describe, it, expect, vi } from "vitest";

// ─── Mocks: keep the import surface tiny so the test can load
// backtest-service.ts without dragging in the full Express app. The transitive
// import chain (broadcastSSE → routes/sse → ../index) wires up the server, so
// we mock everything except the helper under test.
vi.mock("../db/index.js", () => ({ db: { transaction: vi.fn() } }));
vi.mock("../db/schema.js", () => ({
  backtests: {},
  backtestTrades: {},
  stressTestRuns: {},
  strategies: {},
  paperSessions: {},
  auditLog: {},
  walkForwardWindows: {},
  strategyNames: {},
  sqaOptimizationRuns: {},
  quboTimingRuns: {},
  tensorPredictions: {},
  rlTrainingRuns: {},
}));
vi.mock("../routes/sse.js", () => ({ broadcastSSE: vi.fn() }));
vi.mock("./paper-trading-stream.js", () => ({ startStream: vi.fn() }));
vi.mock("./monte-carlo-service.js", () => ({ runMonteCarlo: vi.fn() }));
vi.mock("./quantum-mc-service.js", () => ({ runQuantumMC: vi.fn() }));
vi.mock("../../data/loaders/duckdb-service.js", () => ({ queryInfo: vi.fn() }));
vi.mock("../../shared/firm-config.js", () => ({ getFirmLimit: vi.fn() }));
vi.mock("../../shared/walk-forward-schema.js", () => ({ WFWindowMetricsSchema: { parse: vi.fn() } }));
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../lib/python-runner.js", () => ({ runPythonModule: vi.fn() }));
vi.mock("../lib/circuit-breaker.js", () => ({
  CircuitBreakerRegistry: { get: vi.fn() },
}));
vi.mock("../lib/dlq-service.js", () => ({ captureToDLQ: vi.fn() }));
vi.mock("../lib/tracing.js", () => ({
  tracer: { startSpan: vi.fn(() => ({ setAttribute: vi.fn(), end: vi.fn() })) },
}));
vi.mock("./pipeline-control-service.js", () => ({
  isActive: vi.fn().mockResolvedValue(true),
}));

import { normalizeDecayAnalysis } from "./backtest-service.js";

describe("FIX 3 — normalizeDecayAnalysis canonicalizes on accelerating_decline", () => {
  it("passes accelerating_decline through unchanged (no translator)", () => {
    const result = normalizeDecayAnalysis({
      half_life_days: 30,
      decay_detected: true,
      trend: "accelerating_decline",
      composite_score: 75,
      decaying: true,
      signals: { rolling_sharpe: 1.0 },
    });

    expect(result).not.toBeNull();
    // Critical: the canonical form is accelerating_decline, NOT "declining".
    // If this returns "declining", the translator was reintroduced and the
    // frontend (which expects accelerating_decline after FIX 3) will silently
    // fail to render the warning state.
    expect(result!.trend).toBe("accelerating_decline");
    expect(result!.halfLifeDays).toBe(30);
    expect(result!.decayDetected).toBe(true);
    expect(result!.compositeScore).toBe(75);
    expect(result!.decaying).toBe(true);
  });

  it("passes through 'improving' unchanged", () => {
    const result = normalizeDecayAnalysis({ trend: "improving" });
    expect(result).not.toBeNull();
    expect(result!.trend).toBe("improving");
  });

  it("passes through 'stable' unchanged", () => {
    const result = normalizeDecayAnalysis({ trend: "stable" });
    expect(result).not.toBeNull();
    expect(result!.trend).toBe("stable");
  });

  it("defaults missing trend to 'stable'", () => {
    const result = normalizeDecayAnalysis({});
    expect(result).not.toBeNull();
    expect(result!.trend).toBe("stable");
  });

  it("returns null for undefined input", () => {
    expect(normalizeDecayAnalysis(undefined)).toBeNull();
  });

  it("returns null for null input (cast through unknown)", () => {
    expect(normalizeDecayAnalysis(null as unknown as undefined)).toBeNull();
  });

  it("preserves the snake_case → camelCase mapping for all fields", () => {
    const result = normalizeDecayAnalysis({
      half_life_days: 14,
      decay_detected: false,
      trend: "improving",
      composite_score: 25,
      decaying: false,
      signals: { foo: "bar" },
    });
    expect(result).toEqual({
      halfLifeDays: 14,
      decayDetected: false,
      trend: "improving",
      compositeScore: 25,
      decaying: false,
      signals: { foo: "bar" },
    });
  });
});
