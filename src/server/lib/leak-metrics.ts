/**
 * leak-metrics.ts — Layer 15 Leak Detection: pure metric helpers (Wave 4 Track 4B)
 *
 * ALL functions are pure (no I/O, no Date.now(), no side effects).
 * The service layer fetches DB rows and passes them here for computation.
 * This separation makes every metric formula unit-testable without DB mocks.
 *
 * Metrics implemented:
 *   computeZScore            — rolling window vs baseline z-score (common primitive)
 *   computeSharpeFromPnls    — daily P&L array → annualised Sharpe ratio
 *   computeWinRate           — binary win rate from trade P&L list
 *   classifyZScoreSeverity   — z-score magnitude → 'info' | 'warning' | 'high'
 *   computeRegimeSurvivalFailureRate — % trades that lost in a target regime
 *   computeB14CiHighDrift    — delta between prior and current ci_high
 *   splitWindows             — partition time-ordered values into 20d / 60d slices
 */

export type LeakSeverity = "info" | "warning" | "high";

// ─── Core statistical primitive ───────────────────────────────────────────────

/**
 * Rolling z-score: how many standard deviations has the `window` mean
 * shifted from the `baseline` mean?
 *
 *   z = (mean(window) − mean(baseline)) / stddev(baseline)
 *
 * Returns null when:
 *   - baseline has fewer than 2 elements (variance undefined)
 *   - baseline std dev is near zero (degenerate distribution)
 */
export function computeZScore(
  window: readonly number[],
  baseline: readonly number[],
): number | null {
  if (baseline.length < 2) return null;

  const baselineMean = baseline.reduce((a, b) => a + b, 0) / baseline.length;
  const variance =
    baseline.reduce((sum, v) => sum + (v - baselineMean) ** 2, 0) /
    (baseline.length - 1);
  const stddev = Math.sqrt(variance);

  if (stddev < 1e-9) return null; // degenerate: baseline has no variance

  const windowMean =
    window.length > 0
      ? window.reduce((a, b) => a + b, 0) / window.length
      : baselineMean; // treat empty window as "same as baseline" → z ≈ 0

  return (windowMean - baselineMean) / stddev;
}

// ─── Sharpe ratio ────────────────────────────────────────────────────────────

/**
 * Annualised Sharpe ratio from a sequence of daily P&L values.
 * Uses sqrt(252) scaling (trading-day convention for futures).
 * Returns null when fewer than 2 observations.
 */
export function computeSharpeFromPnls(dailyPnls: readonly number[]): number | null {
  if (dailyPnls.length < 2) return null;

  const mean = dailyPnls.reduce((a, b) => a + b, 0) / dailyPnls.length;
  const variance =
    dailyPnls.reduce((sum, v) => sum + (v - mean) ** 2, 0) /
    (dailyPnls.length - 1);
  const stddev = Math.sqrt(variance);

  if (stddev < 1e-9) return null; // zero-variance returns → no valid Sharpe

  return (mean / stddev) * Math.sqrt(252);
}

// ─── Win rate ────────────────────────────────────────────────────────────────

/**
 * Binary win rate: proportion of trades with P&L > 0.
 * Returns null when the trade list is empty.
 */
export function computeWinRate(tradePnls: readonly number[]): number | null {
  if (tradePnls.length === 0) return null;
  const wins = tradePnls.filter((p) => p > 0).length;
  return wins / tradePnls.length;
}

// ─── Severity classification ──────────────────────────────────────────────────

/**
 * Classify a z-score magnitude into a leak severity tier.
 *
 * Uses absolute value so both positive and negative deviations register.
 * Thresholds are caller-configurable so env-var overrides flow through naturally.
 *
 * @param zScore        The computed z-score (positive or negative)
 * @param highThreshold Absolute z-score at or above which severity = 'high'   (default 2.0)
 * @param warnThreshold Absolute z-score at or above which severity = 'warning' (default 1.0)
 */
export function classifyZScoreSeverity(
  zScore: number,
  highThreshold = 2.0,
  warnThreshold = 1.0,
): LeakSeverity {
  const abs = Math.abs(zScore);
  if (abs >= highThreshold) return "high";
  if (abs >= warnThreshold) return "warning";
  return "info";
}

// ─── Regime survival ─────────────────────────────────────────────────────────

/**
 * Regime survival failure rate: proportion of trades in the specified regime
 * that had non-positive P&L.
 *
 * Returns null when no trades match the target regime.
 *
 * @param trades        Array of trade rows with macroRegime and pnl fields
 * @param targetRegime  The institutional regime string to filter by
 *                      (e.g. "TRENDING", "RANGE_BOUND", "HIGH_VOL_MACRO")
 */
export function computeRegimeSurvivalFailureRate(
  trades: ReadonlyArray<{ macroRegime: string | null; pnl: string | number | null }>,
  targetRegime: string,
): number | null {
  const regimeTrades = trades.filter((t) => t.macroRegime === targetRegime);
  if (regimeTrades.length === 0) return null;

  const losses = regimeTrades.filter((t) => {
    const p =
      typeof t.pnl === "number"
        ? t.pnl
        : parseFloat(String(t.pnl ?? "0"));
    return p <= 0;
  }).length;

  return losses / regimeTrades.length;
}

// ─── B14 ci_high drift ────────────────────────────────────────────────────────

/**
 * B14 ci_high drift delta: how much has the probability-of-ruin upper bound
 * worsened (positive = worse; negative = improved) since the prior measurement.
 *
 * A drift above 0.05 on ci_high means the ruin CI is widening toward the 0.40
 * block threshold — an early warning before the hard gate fires at PAPER → DEPLOY_READY.
 */
export function computeB14CiHighDrift(
  priorCiHigh: number,
  currentCiHigh: number,
): number {
  return currentCiHigh - priorCiHigh;
}

// ─── Window partitioning ──────────────────────────────────────────────────────

/**
 * Split a time-ordered (oldest-first) array of daily values into:
 *   - window20d: the most recent 20 entries
 *   - baseline60d: the first 60 entries (the "long-run" reference)
 *
 * The two windows may overlap when the array is between 20 and 80 elements.
 * When the array has fewer than 20 entries the window is the full array.
 * When the array has fewer than 60 entries the baseline is the full array.
 */
export function splitWindows(
  sortedValues: readonly number[],
): { window20d: number[]; baseline60d: number[] } {
  return {
    window20d: sortedValues.slice(-20) as number[],
    baseline60d: sortedValues.slice(0, 60) as number[],
  };
}

// ─── Percentage severity classifier ──────────────────────────────────────────

/**
 * Classify a fraction (0–1) as a severity tier using high/warn cut-offs.
 * Used for attribution opacity (% minimal critiques) and regime mismatch rates.
 */
export function classifyFractionSeverity(
  fraction: number,
  highThreshold: number,
  warnThreshold: number,
): LeakSeverity {
  if (fraction >= highThreshold) return "high";
  if (fraction >= warnThreshold) return "warning";
  return "info";
}
