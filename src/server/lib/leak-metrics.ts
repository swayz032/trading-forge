/**
 * leak-metrics.ts — Layer 15 Leak Detection: pure metric helpers (Wave 4 Track 4B)
 *
 * ALL functions are pure (no I/O, no Date.now(), no side effects).
 * The service layer fetches DB rows and passes them here for computation.
 * This separation makes every metric formula unit-testable without DB mocks.
 *
 * Metrics implemented:
 *   computeZScore                 — rolling window vs baseline z-score (common primitive)
 *   computeSharpeFromPnls         — daily P&L array → annualised Sharpe ratio
 *   computeWinRate                — binary win rate from trade P&L list
 *   classifyZScoreSeverity        — z-score magnitude → 'info' | 'warning' | 'high'
 *   computeRegimeSurvivalFailureRate — % trades that lost in a target regime
 *   computeB14CiHighDrift         — delta between prior and current ci_high
 *   splitWindows                  — partition time-ordered values into 20d / 60d slices
 *   computeMaxDrawdownFromPnls    — running-equity max-drawdown fraction (Category 6)
 *   computeMcDistributionBreach   — realized vs promotion-time MC distribution check (Category 6)
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

// ─── Category 6: MC distribution breach helpers ───────────────────────────────

/**
 * Compute max drawdown as a fraction of running equity peak from an ordered
 * sequence of realized P&L values (oldest → newest).
 *
 * Returns null when the input is empty.
 * Caps the result at 1.0 (100%) to maintain comparability with MC simulation
 * drawdown fractions, which are bounded by the simulation's ruin condition.
 *
 * Example: [+200, +200, -150, -150, -150]
 *   equity curve: 200 → 400 → 250 → 100 → -50
 *   peak = 400, trough = -50, DD = min(1.0, (400 - (-50)) / 400) = 1.0
 */
export function computeMaxDrawdownFromPnls(pnls: readonly number[]): number | null {
  if (pnls.length === 0) return null;

  let equity = 0;
  let peak = 0;
  let maxDD = 0;

  for (const pnl of pnls) {
    equity += pnl;
    if (equity > peak) peak = equity;
    if (peak > 0) {
      const dd = Math.min(1.0, (peak - equity) / peak);
      if (dd > maxDD) maxDD = dd;
    }
  }

  return maxDD;
}

/** Input shape for the MC distribution breach check (Category 6). */
export interface McDistributionBreachInput {
  /**
   * Realized Sharpe ratio over the observation window (null = not computable,
   * e.g. fewer than 2 distinct trading days in the lookback).
   */
  realizedSharpe: number | null;
  /**
   * Realized max drawdown as a fraction of peak equity (null = not computable).
   * Capped at 1.0. Must be from the same lookback window as tradeCount.
   */
  realizedMaxDrawdown: number | null;
  /**
   * 5th-percentile Sharpe from the promotion-time Monte Carlo distribution.
   * A realized Sharpe below this means live performance is worse than 95% of
   * simulated paths. Null → skip the Sharpe dimension.
   */
  sharpeP5: number | null;
  /**
   * 95th-percentile max-drawdown from the promotion-time MC distribution.
   * A realized drawdown above this means live risk is worse than 95% of
   * simulated paths. Null → skip the drawdown dimension.
   */
  maxDrawdownP95: number | null;
  /** Number of closed live trades in the observation window. */
  tradeCount: number;
  /** Minimum closed trades required before comparing (LEAK_MC_MIN_TRADES). */
  minTrades: number;
  /** Realized DD multiplier above which severity escalates to 'high' (LEAK_MC_DD_SEVERE_MULT). */
  severeDdMult: number;
}

/** Which MC distribution dimensions were breached. */
export type McBreachDimension = "dd" | "sharpe" | "dd_and_sharpe";

/** Result envelope from computeMcDistributionBreach. */
export interface McDistributionBreachResult {
  /**
   * - 'clean'               — all realized metrics are within MC bounds
   * - 'breach'              — at least one dimension exceeds its MC bound
   * - 'insufficient_sample' — tradeCount < minTrades; no comparison performed
   * - 'no_mc_data'          — both sharpeP5 and maxDrawdownP95 are null
   */
  outcome: "clean" | "breach" | "insufficient_sample" | "no_mc_data";
  /** Present only when outcome === 'breach'. */
  severity?: LeakSeverity;
  /** Which metrics breached their MC bound. Present only when outcome === 'breach'. */
  dimension?: McBreachDimension;
  /** Drawdown breach detail (present when drawdown dimension breached). */
  ddBreach?: {
    realized: number;
    p95Bound: number;
    /** (realized − p95Bound) / p95Bound  — how far past the bound */
    pctOverBound: number;
    /** true when realized > severeDdMult × p95Bound */
    severe: boolean;
  };
  /** Sharpe breach detail (present when Sharpe dimension breached). */
  sharpeBreach?: {
    realized: number;
    p5Bound: number;
    /** true when realized ≤ 0 while p5Bound > 0 */
    severe: boolean;
  };
}

/**
 * Compare live paper metrics against the strategy's frozen promotion-time
 * Monte Carlo distribution.  Pure function — no I/O.
 *
 * Breach logic (both dimensions are independent checks):
 *   DD breach:     realized_max_drawdown > maxDrawdownP95
 *   Sharpe breach: realized_sharpe       < sharpeP5
 *
 * Severity tiers (env-tunable via the caller):
 *   warning — mild breach (just past the P95 / P5 bound)
 *   high    — severe: realized DD > severeDdMult × P95, OR realized Sharpe ≤ 0 while P5 > 0
 *
 * Guardrails:
 *   - tradeCount < minTrades → 'insufficient_sample' (no false alarm on noise)
 *   - both percentiles null  → 'no_mc_data' (skip, never throw)
 *   - one percentile null    → only the non-null dimension is evaluated
 *   - realized metric null for a dimension → that dimension is skipped
 */
export function computeMcDistributionBreach(
  input: McDistributionBreachInput,
): McDistributionBreachResult {
  // Guard 1: insufficient sample — prevents noise-driven false alarms
  if (input.tradeCount < input.minTrades) {
    return { outcome: "insufficient_sample" };
  }

  // Guard 2: no MC percentiles at all — nothing to compare against
  if (input.sharpeP5 === null && input.maxDrawdownP95 === null) {
    return { outcome: "no_mc_data" };
  }

  let ddBreach: McDistributionBreachResult["ddBreach"];
  let sharpeBreach: McDistributionBreachResult["sharpeBreach"];

  // ── Drawdown dimension ────────────────────────────────────────────────────
  if (
    input.realizedMaxDrawdown !== null &&
    input.maxDrawdownP95 !== null &&
    input.maxDrawdownP95 > 0 &&
    input.realizedMaxDrawdown > input.maxDrawdownP95
  ) {
    const pctOverBound =
      (input.realizedMaxDrawdown - input.maxDrawdownP95) / input.maxDrawdownP95;
    const severe = input.realizedMaxDrawdown > input.severeDdMult * input.maxDrawdownP95;
    ddBreach = {
      realized: input.realizedMaxDrawdown,
      p95Bound: input.maxDrawdownP95,
      pctOverBound,
      severe,
    };
  }

  // ── Sharpe dimension ─────────────────────────────────────────────────────
  if (
    input.realizedSharpe !== null &&
    input.sharpeP5 !== null &&
    input.realizedSharpe < input.sharpeP5
  ) {
    const severe = input.realizedSharpe <= 0 && input.sharpeP5 > 0;
    sharpeBreach = {
      realized: input.realizedSharpe,
      p5Bound: input.sharpeP5,
      severe,
    };
  }

  // ── No breach ─────────────────────────────────────────────────────────────
  if (!ddBreach && !sharpeBreach) {
    return { outcome: "clean" };
  }

  // ── Breach: determine dimension + severity ────────────────────────────────
  const dimension: McBreachDimension =
    ddBreach && sharpeBreach ? "dd_and_sharpe" : ddBreach ? "dd" : "sharpe";

  const isSevere = (ddBreach?.severe ?? false) || (sharpeBreach?.severe ?? false);
  const severity: LeakSeverity = isSevere ? "high" : "warning";

  return {
    outcome: "breach",
    severity,
    dimension,
    ddBreach,
    sharpeBreach,
  };
}
