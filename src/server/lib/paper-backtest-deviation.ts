/**
 * paper-backtest-deviation.ts — pure leaf for the paper-vs-backtest deviation
 * comparison in scheduler.ts `comparePaperToBacktest`.
 *
 * Extracted (mirrors the scheduler-drift.ts pattern) so the "zero backtest
 * baseline silently skips the comparison" class of bug is directly
 * unit-testable without booting the multi-thousand-line scheduler.ts module.
 *
 * WHY THIS EXISTS (fixwave2-scheduler-health-monitoring, 2026-07-17):
 *   Each metric's deviation was scaled as
 *   |paper - backtest| / max(|backtest| * scaleFactor, floor), which already
 *   guards against literal division by zero via the floor — but the CALLER
 *   additionally gated the whole computation behind `if (backtestValue !== 0)`,
 *   so whenever the backtest baseline coerced to exactly 0 — either because
 *   the field was genuinely computed as 0.0 (a flat backtest) OR because the
 *   field was NULL/undefined (never computed) and got `?? 0`-coerced — the
 *   metric was skipped entirely and contributed nothing to `maxDeviation`.
 *   A paper session could diverge arbitrarily from backtest on that metric
 *   with zero detection. This module always computes a comparison and
 *   explicitly distinguishes a MISSING (null/undefined) baseline — flagged
 *   `baselineUnavailable` and excluded from the aggregate — from a
 *   genuinely-computed 0, which IS compared (using the existing floor to
 *   avoid a literal divide-by-zero).
 */

export interface MetricDeviation {
  metric: string;
  paper: number;
  /** null only when the backtest never computed this field (raw DB value was null/undefined) */
  backtest: number | null;
  sigmas: number;
  /** true when there was no backtest baseline to compare against at all (raw value null/undefined/non-finite) */
  baselineUnavailable: boolean;
}

/**
 * Computes a scaled deviation between a paper metric and its backtest
 * baseline.
 *
 * `rawBacktestValue` MUST be the un-coerced DB field (may be null/undefined)
 * — do NOT pre-coerce with `?? 0` before calling this, or a missing baseline
 * becomes indistinguishable from a genuinely-computed zero and this
 * function's whole purpose is defeated.
 */
export function computeMetricDeviation(
  metric: string,
  paperValue: number,
  rawBacktestValue: number | string | null | undefined,
  scaleFactor: number,
  floor: number,
): MetricDeviation {
  if (rawBacktestValue === null || rawBacktestValue === undefined) {
    return { metric, paper: paperValue, backtest: null, sigmas: 0, baselineUnavailable: true };
  }
  const backtestValue = Number(rawBacktestValue);
  if (!Number.isFinite(backtestValue)) {
    return { metric, paper: paperValue, backtest: null, sigmas: 0, baselineUnavailable: true };
  }
  const denom = Math.max(Math.abs(backtestValue) * scaleFactor, floor);
  const sigmas = Math.abs(paperValue - backtestValue) / denom;
  return { metric, paper: paperValue, backtest: backtestValue, sigmas, baselineUnavailable: false };
}

/** Aggregate max deviation across metrics, excluding any with no baseline to compare against. */
export function maxAvailableDeviation(deviations: MetricDeviation[]): number {
  return deviations.reduce((max, d) => (d.baselineUnavailable ? max : Math.max(max, d.sigmas)), 0);
}
