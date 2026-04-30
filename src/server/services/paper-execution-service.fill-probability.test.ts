/**
 * Phase 3.1 — Volume-Based Fill Probability Degradation
 *
 * Tests for `computeFillProbabilityByVolume()` (pure function, exported) and
 * the integration of the volume factor into the full `computeFillProbability`
 * path via `openPosition()`.
 *
 * Parity mandate:
 *   The paper engine must NOT be more optimistic than the backtester on
 *   low-volume bars.  `computeFillProbabilityByVolume` is a direct TypeScript
 *   port of `liquidity.py:compute_fill_probability_by_volume()`.  All band
 *   boundaries and linear interpolations must match the Python reference exactly.
 *
 * Volume ratio bands (mirrors Python):
 *   >= 1.0  → 1.00 (no degradation)
 *   >= 0.5  → 0.85–1.00 linearly (moderate degradation)
 *   >= 0.2  → 0.60–0.85 linearly (significant degradation)
 *   <  0.2  → max(0.30, ratio * 3)  (severe penalty)
 *
 * Fallback behaviour:
 *   Missing / zero volume → 1.0 (no degradation).  This preserves prior
 *   behaviour for callers that haven't been updated to supply volume yet.
 */

import { describe, it, expect, vi } from "vitest";

// ─── Module mocks (required before importing the service) ────────────────────
// The service imports db at module load time; mock it to avoid DATABASE_URL requirement.
vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
    insert: vi.fn(),
  },
}));
vi.mock("../routes/sse.js", () => ({ broadcastSSE: vi.fn() }));
vi.mock("../index.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../lib/tracing.js", () => ({
  tracer: { startSpan: vi.fn().mockReturnValue({ setAttribute: vi.fn(), end: vi.fn() }) },
}));
vi.mock("../scheduler.js", () => ({ onPaperTradeClose: vi.fn() }));
vi.mock("./paper-risk-gate.js", () => ({ toEasternDateString: vi.fn().mockReturnValue("2026-01-15") }));
vi.mock("../lib/python-runner.js", () => ({
  runPythonModule: vi.fn().mockResolvedValue({ is_economic_event: false }),
}));

import { computeFillProbabilityByVolume } from "./paper-execution-service.js";

// ─── computeFillProbabilityByVolume — pure function ──────────────────────────

describe("computeFillProbabilityByVolume() — volume ratio band thresholds", () => {

  // ── Band 1: ratio >= 1.0 — no degradation ──────────────────────────────────

  it("returns 1.0 when bar volume equals median volume (ratio = 1.0 exactly)", () => {
    expect(computeFillProbabilityByVolume(1000, 1000)).toBe(1.0);
  });

  it("returns 1.0 when bar volume exceeds median volume (ratio > 1.0)", () => {
    expect(computeFillProbabilityByVolume(1500, 1000)).toBe(1.0);
  });

  // ── Band 2: ratio >= 0.5 and < 1.0 — linear 0.85–1.00 ────────────────────

  it("returns 0.85 at ratio = 0.5 (lower bound of band 2)", () => {
    // ratio = 500/1000 = 0.5 → 0.85 + 0.15 * (0.5 - 0.5) / 0.5 = 0.85
    const result = computeFillProbabilityByVolume(500, 1000);
    expect(result).toBeCloseTo(0.85, 6);
  });

  it("returns 1.0 at ratio approaching 1.0 from below (band 2 upper bound)", () => {
    // ratio = 999/1000 ≈ 0.999 → 0.85 + 0.15 * (0.999 - 0.5) / 0.5 ≈ 0.9997
    const result = computeFillProbabilityByVolume(999, 1000);
    expect(result).toBeCloseTo(0.9997, 3);
  });

  it("interpolates linearly at ratio = 0.75 (midpoint of band 2)", () => {
    // ratio = 0.75 → 0.85 + 0.15 * (0.75 - 0.5) / 0.5 = 0.85 + 0.075 = 0.925
    const result = computeFillProbabilityByVolume(750, 1000);
    expect(result).toBeCloseTo(0.925, 6);
  });

  // ── Band 3: ratio >= 0.2 and < 0.5 — linear 0.60–0.85 ────────────────────

  it("returns 0.60 at ratio = 0.2 (lower bound of band 3)", () => {
    // ratio = 200/1000 = 0.2 → 0.60 + 0.25 * (0.2 - 0.2) / 0.3 = 0.60
    const result = computeFillProbabilityByVolume(200, 1000);
    expect(result).toBeCloseTo(0.60, 6);
  });

  it("returns 0.85 at ratio approaching 0.5 from below (band 3 upper bound)", () => {
    // ratio = 499/1000 ≈ 0.499 → 0.60 + 0.25 * (0.499 - 0.2) / 0.3 ≈ 0.8492
    const result = computeFillProbabilityByVolume(499, 1000);
    expect(result).toBeCloseTo(0.8492, 3);
  });

  it("interpolates linearly at ratio = 0.35 (midpoint of band 3)", () => {
    // ratio = 0.35 → 0.60 + 0.25 * (0.35 - 0.2) / 0.3 = 0.60 + 0.125 = 0.725
    const result = computeFillProbabilityByVolume(350, 1000);
    expect(result).toBeCloseTo(0.725, 6);
  });

  // ── Band 4: ratio < 0.2 — severe penalty ──────────────────────────────────

  it("returns 0.30 at ratio = 0.1 (floor clamp from max(0.30, 0.1*3))", () => {
    // ratio = 100/1000 = 0.1 → max(0.30, 0.1 * 3) = max(0.30, 0.30) = 0.30
    const result = computeFillProbabilityByVolume(100, 1000);
    expect(result).toBeCloseTo(0.30, 6);
  });

  it("clamps at 0.30 when ratio is near zero", () => {
    // ratio = 10/1000 = 0.01 → max(0.30, 0.01 * 3) = max(0.30, 0.03) = 0.30
    const result = computeFillProbabilityByVolume(10, 1000);
    expect(result).toBe(0.30);
  });

  it("applies ratio*3 rule when ratio is between 0.10 and 0.20", () => {
    // ratio = 150/1000 = 0.15 → max(0.30, 0.15 * 3) = max(0.30, 0.45) = 0.45
    const result = computeFillProbabilityByVolume(150, 1000);
    expect(result).toBeCloseTo(0.45, 6);
  });

  // ── Fallback / edge cases ──────────────────────────────────────────────────

  it("returns 1.0 when barVolume is undefined (no volume data)", () => {
    expect(computeFillProbabilityByVolume(undefined, 1000)).toBe(1.0);
  });

  it("returns 1.0 when medianVolume is undefined (no volume data)", () => {
    expect(computeFillProbabilityByVolume(500, undefined)).toBe(1.0);
  });

  it("returns 1.0 when both are undefined", () => {
    expect(computeFillProbabilityByVolume(undefined, undefined)).toBe(1.0);
  });

  it("returns 1.0 when barVolume is zero", () => {
    expect(computeFillProbabilityByVolume(0, 1000)).toBe(1.0);
  });

  it("returns 1.0 when medianVolume is zero (avoids division by zero)", () => {
    expect(computeFillProbabilityByVolume(500, 0)).toBe(1.0);
  });
});

// ─── Parity: TS port matches Python reference values ─────────────────────────

describe("computeFillProbabilityByVolume() — Python parity spot-checks", () => {
  /**
   * These values are computed directly from the Python reference in liquidity.py.
   * Any deviation indicates the TS port has diverged from the backtester.
   */

  const CASES: Array<{ bar: number; median: number; expected: number; label: string }> = [
    { bar: 2000, median: 1000, expected: 1.0,    label: "2x median → full prob" },
    { bar: 1000, median: 1000, expected: 1.0,    label: "equal to median → full prob" },
    { bar: 700,  median: 1000, expected: 0.91,   label: "0.7x median → band 2 midpoint" },
    { bar: 500,  median: 1000, expected: 0.85,   label: "0.5x median → band 2 lower bound" },
    { bar: 300,  median: 1000, expected: 0.6833, label: "0.3x median → band 3 interpolated" },
    { bar: 200,  median: 1000, expected: 0.60,   label: "0.2x median → band 3 lower bound" },
    { bar: 150,  median: 1000, expected: 0.45,   label: "0.15x median → severe, ratio*3 > 0.30" },
    { bar: 50,   median: 1000, expected: 0.30,   label: "0.05x median → floor at 0.30" },
  ];

  for (const { bar, median, expected, label } of CASES) {
    it(`${label}`, () => {
      expect(computeFillProbabilityByVolume(bar, median)).toBeCloseTo(expected, 3);
    });
  }
});

// ─── Integration: volume factor applied to market orders ─────────────────────

describe("computeFillProbabilityByVolume() — market order parity integration", () => {
  /**
   * Market orders in the paper engine now get volume-degraded fill probability,
   * matching the backtester.  When volume is at 50% of median the final probability
   * for a market order is 1.0 * 0.85 = 0.85 (not 1.0 as it was before Phase 3.1).
   *
   * This test documents the expected behaviour without mocking the full openPosition
   * path — it verifies the math via the exported pure function.
   */

  it("market order at 50% median volume: degradation factor is 0.85", () => {
    const factor = computeFillProbabilityByVolume(500, 1000);
    const marketBaseProb = 1.0;
    const effective = marketBaseProb * factor;
    expect(effective).toBeCloseTo(0.85, 6);
  });

  it("market order at 30% median volume: degradation factor is ~0.683", () => {
    // ratio = 0.3 → band 3: 0.60 + 0.25 * (0.3 - 0.2) / 0.3 = 0.6833
    const factor = computeFillProbabilityByVolume(300, 1000);
    const effective = 1.0 * factor;
    expect(effective).toBeCloseTo(0.6833, 3);
  });

  it("market order at normal volume (>= 100%): no degradation", () => {
    const factor = computeFillProbabilityByVolume(1000, 1000);
    expect(factor).toBe(1.0);
    expect(1.0 * factor).toBe(1.0);
  });

  it("market order with no volume data: no degradation (fallback preserves prior behaviour)", () => {
    const factor = computeFillProbabilityByVolume(undefined, undefined);
    expect(factor).toBe(1.0);
  });
});
