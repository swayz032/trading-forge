/**
 * paper-backtest-deviation.test.ts — fixwave2-scheduler-health-monitoring
 * (2026-07-17), finding MED-3.
 *
 * RED-PROOF: pre-fix, `comparePaperToBacktest` gated each metric's deviation
 * computation behind `if (btX !== 0)`, coercing the raw DB field with
 * `Number(backtest.sharpeRatio ?? 0)` first. That made a genuinely-missing
 * baseline (field never computed, NULL in DB) indistinguishable from a
 * genuinely-computed zero, and either way the metric was SKIPPED from
 * comparison entirely — a paper session could diverge arbitrarily from
 * backtest on that metric with zero detection power. This suite proves
 * computeMetricDeviation() always produces a comparison, and distinguishes
 * a missing baseline (flagged, excluded from the aggregate) from a
 * genuinely-computed zero (compared, using the existing floor).
 */
import { describe, it, expect } from "vitest";
import {
  computeMetricDeviation,
  maxAvailableDeviation,
} from "../lib/paper-backtest-deviation.js";

describe("computeMetricDeviation — RED-PROOF: zero baseline is compared, not skipped", () => {
  it("a genuinely-computed backtest value of 0 IS compared (uses the floor denominator)", () => {
    // Old code: `if (btSharpe !== 0)` — this case (backtest Sharpe genuinely
    // 0.0) was SKIPPED entirely, no matter how divergent paperSharpe was.
    const d = computeMetricDeviation("Sharpe", 3.0, 0, 0.5, 0.1);
    expect(d.baselineUnavailable).toBe(false);
    expect(d.backtest).toBe(0);
    // denom = max(|0|*0.5, 0.1) = 0.1; sigmas = |3.0 - 0| / 0.1 = 30
    expect(d.sigmas).toBeCloseTo(30, 5);
  });

  it("large paper divergence from a zero backtest baseline now drives maxAvailableDeviation above the alert threshold", () => {
    const deviations = [
      computeMetricDeviation("Sharpe", 3.0, 0, 0.5, 0.1),
      computeMetricDeviation("WinRate", 0.9, 0, 0.15, 0.05),
      computeMetricDeviation("AvgDailyPnL", 500, 0, 0.5, 1),
    ];
    const max = maxAvailableDeviation(deviations);
    expect(max).toBeGreaterThan(2.0); // would have alerted; pre-fix this metric never entered the array at all
  });

  it("a paper value that matches a zero backtest baseline (both flat) shows zero deviation, no false alarm", () => {
    const d = computeMetricDeviation("Sharpe", 0, 0, 0.5, 0.1);
    expect(d.baselineUnavailable).toBe(false);
    expect(d.sigmas).toBe(0);
  });
});

describe("computeMetricDeviation — missing (null/undefined) baseline is flagged, not fabricated", () => {
  it("null raw backtest value -> baselineUnavailable=true, sigmas=0, backtest=null", () => {
    const d = computeMetricDeviation("Sharpe", 3.0, null, 0.5, 0.1);
    expect(d.baselineUnavailable).toBe(true);
    expect(d.backtest).toBeNull();
    expect(d.sigmas).toBe(0);
  });

  it("undefined raw backtest value -> baselineUnavailable=true", () => {
    const d = computeMetricDeviation("WinRate", 0.55, undefined, 0.15, 0.05);
    expect(d.baselineUnavailable).toBe(true);
  });

  it("non-finite coerced value (e.g. malformed numeric string) -> baselineUnavailable=true, not NaN sigmas", () => {
    const d = computeMetricDeviation("AvgDailyPnL", 100, "not-a-number", 0.5, 1);
    expect(d.baselineUnavailable).toBe(true);
    expect(Number.isNaN(d.sigmas)).toBe(false);
  });

  it("a numeric-string DB value (typical for drizzle `numeric` columns) is parsed and compared normally", () => {
    const d = computeMetricDeviation("Sharpe", 1.0, "1.5", 0.5, 0.1);
    expect(d.baselineUnavailable).toBe(false);
    expect(d.backtest).toBe(1.5);
  });
});

describe("maxAvailableDeviation — excludes unavailable-baseline metrics from the aggregate", () => {
  it("a missing baseline never inflates or is silently read as clean in the max", () => {
    const deviations = [
      computeMetricDeviation("Sharpe", 5.0, null, 0.5, 0.1), // unavailable — excluded
      computeMetricDeviation("WinRate", 0.5, 0.5, 0.15, 0.05), // matches — 0 sigma
    ];
    expect(maxAvailableDeviation(deviations)).toBe(0);
  });

  it("mixing an unavailable metric with a genuinely divergent one still surfaces the real divergence", () => {
    const deviations = [
      computeMetricDeviation("Sharpe", 5.0, null, 0.5, 0.1), // unavailable
      computeMetricDeviation("AvgDailyPnL", 1000, 100, 0.5, 1), // real divergence
    ];
    // denom = max(100*0.5, 1) = 50; sigmas = |1000-100|/50 = 18
    expect(maxAvailableDeviation(deviations)).toBeCloseTo(18, 5);
  });

  it("all metrics unavailable -> max is 0 (caller must treat this as 'not compared', not 'clean')", () => {
    const deviations = [
      computeMetricDeviation("Sharpe", 5.0, null, 0.5, 0.1),
      computeMetricDeviation("WinRate", 0.9, undefined, 0.15, 0.05),
      computeMetricDeviation("AvgDailyPnL", 1000, null, 0.5, 1),
    ];
    expect(maxAvailableDeviation(deviations)).toBe(0);
    expect(deviations.every((d) => d.baselineUnavailable)).toBe(true);
  });

  it("empty deviations array -> 0 (no crash)", () => {
    expect(maxAvailableDeviation([])).toBe(0);
  });
});
