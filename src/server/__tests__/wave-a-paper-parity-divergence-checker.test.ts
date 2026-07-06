import { describe, it, expect } from "vitest";
import { compareShadowToBacktest, SIZE_TOLERANCE_PCT, MIN_SAMPLE_SIZE } from "../lib/shadow-signal-divergence-checker.js";
import type { ShadowSignal, ExpectedSignal } from "../lib/shadow-signal-divergence-checker.js";

// Fix 9: shadow-signal-divergence-checker.ts size check wrapped in `if (!diverged)`

// ShadowSignal uses signal_ts: number (Unix epoch seconds), direction, intended_size
function makeSignal(
  tsEpochSec: number,
  direction: "long" | "short",
  intendedSize: number,
): ShadowSignal {
  return {
    signal_ts: tsEpochSec,
    direction,
    intended_size: intendedSize,
    entry_price: 4000,
    killzone: "ny_am",
    regime: "TRENDING",
    confluence_score: 0.8,
  };
}

function makeExpected(
  tsEpochSec: number,
  direction: "long" | "short",
  intendedSize: number,
): ExpectedSignal {
  return {
    signal_ts: tsEpochSec,
    direction,
    intended_size: intendedSize,
    entry_price: 4000,
  };
}

// Create enough signals to meet MIN_SAMPLE_SIZE (20)
function makePairsN(
  n: number,
  shadowDir: "long" | "short" = "long",
  btDir: "long" | "short" = "long",
  shadowSize = 2,
  btSize = 2,
): { shadowSignals: ShadowSignal[]; backtestExpected: ExpectedSignal[] } {
  // Base time: 2026-01-02T10:00:00Z in epoch seconds
  const baseTs = Math.floor(new Date("2026-01-02T10:00:00Z").getTime() / 1000);
  const shadowSignals: ShadowSignal[] = [];
  const backtestExpected: ExpectedSignal[] = [];
  for (let i = 0; i < n; i++) {
    const ts = baseTs + i * 5 * 60; // 5 min apart in seconds
    shadowSignals.push(makeSignal(ts, shadowDir, shadowSize));
    backtestExpected.push(makeExpected(ts, btDir, btSize));
  }
  return { shadowSignals, backtestExpected };
}

describe("Fix 9: shadow-signal-divergence-checker compound fault detection", () => {
  it("clean signal: no violations at all", () => {
    const { shadowSignals, backtestExpected } = makePairsN(MIN_SAMPLE_SIZE, "long", "long", 2, 2);
    const result = compareShadowToBacktest(shadowSignals, backtestExpected);
    expect(result.ok).toBe(true);
    expect(result.per_signal_violations).toHaveLength(0);
    expect(result.divergence_pct).toBe(0);
  });

  it("direction divergence alone counted (no size violation)", () => {
    // Shadow goes long, backtest expected short → direction violation only
    // Same size → no size violation
    const { shadowSignals, backtestExpected } = makePairsN(MIN_SAMPLE_SIZE, "long", "short", 2, 2);
    const result = compareShadowToBacktest(shadowSignals, backtestExpected);
    // All signals have direction mismatch
    const directionViolations = result.per_signal_violations.filter(
      (v) => v.divergence_type === "direction",
    );
    const sizeViolations = result.per_signal_violations.filter(
      (v) => v.divergence_type === "size",
    );
    expect(directionViolations.length).toBeGreaterThan(0);
    expect(sizeViolations.length).toBe(0);
  });

  it("size divergence alone counted (no direction violation)", () => {
    // Same direction, but size differs by >10%
    // shadow size 2, backtest size 3 → diff 33% > SIZE_TOLERANCE_PCT (10%)
    const { shadowSignals, backtestExpected } = makePairsN(MIN_SAMPLE_SIZE, "long", "long", 2, 3);
    const result = compareShadowToBacktest(shadowSignals, backtestExpected);
    const directionViolations = result.per_signal_violations.filter(
      (v) => v.divergence_type === "direction",
    );
    const sizeViolations = result.per_signal_violations.filter(
      (v) => v.divergence_type === "size",
    );
    expect(directionViolations.length).toBe(0);
    expect(sizeViolations.length).toBeGreaterThan(0);
    // |2-3|/3 = 0.333...
    expect(sizeViolations[0]!.magnitude).toBeCloseTo(0.333, 2);
  });

  it("compound fault: direction AND size divergence BOTH counted (FIX 9 core test)", () => {
    // Shadow: long, size 2; Backtest: short, size 3
    // With OLD code (!diverged guard): direction fires first, size is SKIPPED
    // With FIX 9: BOTH direction and size fire independently
    const { shadowSignals, backtestExpected } = makePairsN(MIN_SAMPLE_SIZE, "long", "short", 2, 3);
    const result = compareShadowToBacktest(shadowSignals, backtestExpected);

    const directionViolations = result.per_signal_violations.filter(
      (v) => v.divergence_type === "direction",
    );
    const sizeViolations = result.per_signal_violations.filter(
      (v) => v.divergence_type === "size",
    );

    // FIX 9: both violation types should be present
    expect(directionViolations.length).toBeGreaterThan(0);
    expect(sizeViolations.length).toBeGreaterThan(0);

    // Total violations should be direction + size (2 per signal)
    expect(result.per_signal_violations.length).toBe(MIN_SAMPLE_SIZE * 2);
  });

  it("deep-scan Paper F-1: divergence_pct stays within [0,1] even when every signal has 2 violations", () => {
    // Every signal diverges on BOTH direction and size → 2×sample violations. The documented
    // contract is "fraction of SIGNALS that diverge" (0..1), so this must be 1.0, not 2.0.
    const { shadowSignals, backtestExpected } = makePairsN(MIN_SAMPLE_SIZE, "long", "short", 2, 3);
    const result = compareShadowToBacktest(shadowSignals, backtestExpected);
    expect(result.per_signal_violations.length).toBe(MIN_SAMPLE_SIZE * 2); // 2 violations/signal
    expect(result.divergence_pct).toBeLessThanOrEqual(1.0);
    expect(result.divergence_pct).toBe(1.0); // all N signals diverged → 100%, not 200%
  });

  it("size within 10% tolerance is not a violation", () => {
    // size 2 vs 2.1 → diff 5% < 10% → no violation
    const { shadowSignals, backtestExpected } = makePairsN(MIN_SAMPLE_SIZE, "long", "long", 2, 2.1);
    const result = compareShadowToBacktest(shadowSignals, backtestExpected);
    const sizeViolations = result.per_signal_violations.filter(
      (v) => v.divergence_type === "size",
    );
    expect(sizeViolations.length).toBe(0);
  });
});
