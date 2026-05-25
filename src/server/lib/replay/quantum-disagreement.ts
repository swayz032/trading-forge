/**
 * Wave 27 Pass 1 — Quantum Disagreement Signal Analysis Library
 *
 * Pure-function statistical library for the quantum replay-grading harness.
 * All functions here are side-effect-free and do not import from src/engine.
 *
 * Consumed by:
 *   - scripts/replay-grade-quantum.ts  (CLI / DB integration layer)
 *   - src/server/__tests__/replay/replay-grade-quantum.test.ts
 */

// ─── Constants ────────────────────────────────────────────────────────────────

export const THRESHOLD_CANDIDATES = [0.05, 0.10, 0.15, 0.20, 0.25] as const;
export type ThresholdCandidate = typeof THRESHOLD_CANDIDATES[number];

export const SHARPE_DEGRADATION_FLOOR = 0.3;   // OOS underperforms IS by >= this
export const IS_POSITIVE_RATE_SWEET_SPOT_LO = 0.15;
export const IS_POSITIVE_RATE_SWEET_SPOT_HI = 0.40;
export const MIN_FOLDS_FOR_FULL_ANALYSIS = 50;
export const EMBARGO_TRADING_DAYS = 1;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FoldMetrics {
  foldId: string;
  backtestId: string;
  strategyId: string;
  isStart: string;
  isEnd: string;
  oosStart: string;
  oosEnd: string;
  isSharpe: number;
  disagreement: number;
  oosSharpe: number;
  oosProfitFactor: number;
  oosAvgR: number;
  sharpeDegradation: number;  // oosSharpe - isSharpe
}

export interface ThresholdResult {
  threshold: number;
  isFoldsFiring: number;
  oosDegradationRate: number;
  binomialPValue: number;
}

export interface AnalysisResult {
  replayRowsQueried: number;
  validFolds: number;
  spearmanRho: number;
  spearmanPValue: number;
  selectedThreshold: number;
  binomialObservedRate: number;
  binomialPValue: number;
  binomialN: number;
  thresholdResults: ThresholdResult[];
  verdict: "SIGNAL" | "INCONCLUSIVE" | "NO SIGNAL" | "PRELIMINARY";
  isPreliminary: boolean;
  reproducibilityHashRange: { min: string; max: string };
  folds: FoldMetrics[];
}

// ─── Spearman Rank Correlation ────────────────────────────────────────────────

/**
 * Compute Spearman rank correlation between two equal-length arrays.
 * Returns { rho, pValue }.
 *
 * Standard formula: rho = 1 - 6*sum(d^2) / (n*(n^2-1))
 * p-value from two-tailed t-distribution: t = rho * sqrt((n-2)/(1-rho^2)), df=n-2
 *
 * When n < 3, returns { rho: 0, pValue: 1.0 }.
 */
export function computeSpearman(x: number[], y: number[]): { rho: number; pValue: number } {
  const n = x.length;
  if (n !== y.length || n < 3) return { rho: 0, pValue: 1.0 };

  function rankArray(arr: number[]): number[] {
    const sorted = arr
      .map((v, i) => ({ v, i }))
      .sort((a, b) => a.v - b.v);
    const ranks = new Array<number>(n);
    let j = 0;
    while (j < n) {
      let k = j;
      while (k < n - 1 && sorted[k + 1].v === sorted[k].v) k++;
      const avgRank = (j + k) / 2 + 1;
      for (let m = j; m <= k; m++) ranks[sorted[m].i] = avgRank;
      j = k + 1;
    }
    return ranks;
  }

  const rx = rankArray(x);
  const ry = rankArray(y);

  let d2Sum = 0;
  for (let i = 0; i < n; i++) {
    const d = rx[i] - ry[i];
    d2Sum += d * d;
  }

  const rho = 1 - (6 * d2Sum) / (n * (n * n - 1));

  const denom = 1 - rho * rho;
  if (denom <= 0) return { rho, pValue: 0.0 };
  const t = rho * Math.sqrt((n - 2) / denom);
  const df = n - 2;
  const pValue = tDistributionPValue(Math.abs(t), df);

  return { rho, pValue };
}

/**
 * Two-tailed p-value from t-distribution.
 */
export function tDistributionPValue(tAbs: number, df: number): number {
  if (df <= 0) return 1.0;
  const x = df / (df + tAbs * tAbs);
  const p = 2 * regularizedIncompleteBeta(x, df / 2, 0.5);
  return Math.min(1.0, Math.max(0.0, p));
}

/**
 * Regularized incomplete beta function I_x(a, b).
 */
export function regularizedIncompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;

  if (x > (a + 1) / (a + b + 2)) {
    return 1 - regularizedIncompleteBeta(1 - x, b, a);
  }

  const lbeta = logGamma(a) + logGamma(b) - logGamma(a + b);
  const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b - lbeta) / a;
  const cf = incompleteBetaCF(x, a, b);
  return front * cf;
}

function incompleteBetaCF(x: number, a: number, b: number): number {
  const MAXIT = 200;
  const EPS = 3e-7;
  const FPMIN = 1e-30;

  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1.0;
  let d = 1 - qab * x / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;

  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/**
 * Log-gamma function (Lanczos approximation).
 */
export function logGamma(x: number): number {
  const g = 7;
  const c = [
    0.99999999999980993,
    676.5203681218851,
    -1259.1392167224028,
    771.32342877765313,
    -176.61502916214059,
    12.507343278686905,
    -0.13857109526572012,
    9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  if (x < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  }
  x -= 1;
  let a = c[0];
  const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

// ─── Binomial Test ────────────────────────────────────────────────────────────

/**
 * One-sided binomial test: P(X >= k | n, p0).
 * Returns p-value under null hypothesis p0.
 *
 * Implementation: P(X >= k) = I_{p0}(k, n - k + 1) using regularized incomplete beta.
 */
export function binomialTestPValue(k: number, n: number, p0: number): number {
  if (n <= 0) return 1.0;
  if (k <= 0) return 1.0;
  return regularizedIncompleteBeta(p0, k, n - k + 1);
}

// ─── Threshold Selection (IS-only) ───────────────────────────────────────────

/**
 * Select IS-only threshold from candidates.
 * Sweet spot: IS-positive-rate in [0.15, 0.40].
 * Among qualifying thresholds, prefer rate closest to 0.20.
 * Fallback (none qualify): threshold with rate closest to midpoint 0.25.
 *
 * CRITICAL: this function must only see IS disagreement values.
 * Caller is responsible for ensuring no OOS data leaks in.
 */
export function selectThresholdFromIS(
  disagreements: number[],
  thresholds: readonly number[],
): number {
  const n = disagreements.length;
  if (n === 0) return thresholds[1] ?? thresholds[0];

  const qualified: Array<{ threshold: number; rate: number; distance: number }> = [];

  for (const t of thresholds) {
    const firing = disagreements.filter(d => d > t).length;
    const rate = firing / n;
    if (rate >= IS_POSITIVE_RATE_SWEET_SPOT_LO && rate <= IS_POSITIVE_RATE_SWEET_SPOT_HI) {
      qualified.push({ threshold: t, rate, distance: Math.abs(rate - 0.20) });
    }
  }

  if (qualified.length > 0) {
    qualified.sort((a, b) => a.distance - b.distance);
    return qualified[0].threshold;
  }

  // Fallback: rate closest to 0.25
  let best = thresholds[0];
  let bestDist = Infinity;
  for (const t of thresholds) {
    const rate = disagreements.filter(d => d > t).length / n;
    const dist = Math.abs(rate - 0.25);
    if (dist < bestDist) {
      bestDist = dist;
      best = t;
    }
  }
  return best;
}

// ─── Purge Violation Check ────────────────────────────────────────────────────

/**
 * Enforce CPCV purge contract: oos_start must be strictly after is_end.
 * Text columns compared lexicographically (ISO date strings).
 * Returns violation description string if violated, null if clean.
 */
export function checkPurgeViolation(
  foldId: string,
  isEnd: string,
  oosStart: string,
): string | null {
  if (oosStart <= isEnd) {
    return `Purge violation: fold ${foldId} has oos_start=${oosStart} <= is_end=${isEnd}`;
  }
  return null;
}

// ─── Embargo ──────────────────────────────────────────────────────────────────

/**
 * Drop the first N trading days of OOS trades (Mon–Fri, holiday-agnostic).
 * Prevents spillover of IS information into the first OOS trade.
 */
export function applyEmbargo(
  trades: Array<{ entryTime: Date; pnl: number }>,
  oosStart: string,
  embargoTradingDays: number,
): Array<{ entryTime: Date; pnl: number }> {
  if (embargoTradingDays <= 0 || trades.length === 0) return trades;

  const oosDate = new Date(oosStart);
  let count = 0;
  let cursor = new Date(oosDate);
  while (count < embargoTradingDays) {
    cursor.setDate(cursor.getDate() + 1);
    const dow = cursor.getDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  const embargoUntil = cursor;

  return trades.filter(t => t.entryTime >= embargoUntil);
}

// ─── Trade Metrics ────────────────────────────────────────────────────────────

/**
 * Compute annualized Sharpe ratio from trade PnL list.
 * Assumes 252-day year. Returns 0 for < 2 trades or zero std.
 */
export function computeSharpeFromTrades(pnls: number[]): number {
  if (pnls.length < 2) return 0;
  const mean = pnls.reduce((a, b) => a + b, 0) / pnls.length;
  const variance = pnls.reduce((a, v) => a + (v - mean) ** 2, 0) / (pnls.length - 1);
  const std = Math.sqrt(variance);
  if (std === 0) return 0;
  return (mean / std) * Math.sqrt(252);
}

/**
 * Compute profit factor from trade PnL list.
 */
export function computeProfitFactor(pnls: number[]): number {
  const gross = pnls.filter(p => p > 0).reduce((a, b) => a + b, 0);
  const loss = Math.abs(pnls.filter(p => p < 0).reduce((a, b) => a + b, 0));
  if (loss === 0) return gross > 0 ? 999 : 1;
  return gross / loss;
}

// ─── Decision Rule ────────────────────────────────────────────────────────────

/**
 * Apply Wave 27 Pass 1 decision rule.
 *
 * SIGNAL:        |rho| >= 0.25 AND p <= 0.05 AND n >= 50
 *             OR binomial_rate >= 0.60 AND binomial_p <= 0.05 AND n >= 50
 * INCONCLUSIVE:  0.10 <= |rho| < 0.25 AND n >= 50
 * NO SIGNAL:     |rho| < 0.10 AND n >= 50
 * PRELIMINARY:   n < 50 (always — regardless of effect size)
 */
export function applyDecisionRule(
  rho: number,
  spearmanP: number,
  n: number,
  binomialObservedRate: number,
  binomialP: number,
): "SIGNAL" | "INCONCLUSIVE" | "NO SIGNAL" | "PRELIMINARY" {
  if (n < MIN_FOLDS_FOR_FULL_ANALYSIS) return "PRELIMINARY";

  const absRho = Math.abs(rho);

  if (
    (absRho >= 0.25 && spearmanP <= 0.05) ||
    (binomialObservedRate >= 0.60 && binomialP <= 0.05)
  ) {
    return "SIGNAL";
  }

  if (absRho >= 0.10) return "INCONCLUSIVE";

  return "NO SIGNAL";
}

// ─── Markdown Report Builder ──────────────────────────────────────────────────

/**
 * Build the Wave 27 Pass 1 quantum disagreement signal markdown report.
 * Pure function — no I/O. Caller decides whether to write to disk.
 */
export function buildMarkdownReport(analysis: AnalysisResult, isoDate: string): string {
  const {
    replayRowsQueried,
    validFolds,
    spearmanRho,
    spearmanPValue,
    selectedThreshold,
    binomialObservedRate,
    binomialPValue,
    binomialN,
    thresholdResults,
    verdict,
    isPreliminary,
    reproducibilityHashRange,
  } = analysis;

  const lines: string[] = [];

  lines.push(`# Wave 27 Pass 1 — Quantum Disagreement Signal Test`);
  lines.push(``);

  if (isPreliminary) {
    lines.push(`**PRELIMINARY — INSUFFICIENT SAMPLES (n=${validFolds} < ${MIN_FOLDS_FOR_FULL_ANALYSIS})**`);
    lines.push(`**Statistical conclusions below should not drive gate-wiring decisions. Defer Pass 2 quantum-gate wiring.**`);
    lines.push(``);
  }

  lines.push(`**Date:** ${isoDate}`);
  lines.push(`**Replay rows analyzed:** ${replayRowsQueried}`);
  lines.push(`**Strategy-folds with valid OOS join:** ${validFolds}`);
  lines.push(`**Verdict:** ${verdict}`);
  lines.push(``);

  lines.push(`## Spearman Test`);
  lines.push(``);
  lines.push(`- ρ = ${spearmanRho.toFixed(4)}`);
  lines.push(`- p-value = ${spearmanPValue.toFixed(4)}`);
  lines.push(`- n = ${validFolds}`);
  lines.push(``);

  lines.push(`## Binomial Test (IS-selected threshold = ${selectedThreshold.toFixed(2)})`);
  lines.push(``);
  lines.push(`- Observed OOS-degradation rate: ${(binomialObservedRate * 100).toFixed(1)}%`);
  lines.push(`- Null p = 0.5`);
  lines.push(`- p-value = ${binomialPValue.toFixed(4)}`);
  lines.push(`- n = ${binomialN} (folds where IS disagreement > ${selectedThreshold.toFixed(2)})`);
  lines.push(``);

  lines.push(`## Threshold Robustness`);
  lines.push(``);
  lines.push(`| Threshold | IS folds firing | OOS degradation rate | p-value |`);
  lines.push(`|---|---|---|---|`);
  for (const tr of thresholdResults) {
    lines.push(
      `| ${tr.threshold.toFixed(2)} | ${tr.isFoldsFiring} | ${(tr.oosDegradationRate * 100).toFixed(1)}% | ${tr.binomialPValue.toFixed(4)} |`
    );
  }
  lines.push(``);

  lines.push(`## Decision Rule Applied`);
  lines.push(``);

  switch (verdict) {
    case "SIGNAL":
      lines.push(
        `**SIGNAL detected.** |ρ| ≥ 0.25 with p ≤ 0.05 and/or OOS-degradation rate ≥ 60% at p ≤ 0.05. ` +
        `Schedule Pass 2 harness extension. Wire quantum_mc as soft advisory at PAPER → DEPLOY_READY.`
      );
      break;
    case "INCONCLUSIVE":
      lines.push(
        `**INCONCLUSIVE.** 0.10 ≤ |ρ| < 0.25. Proceed to Pass 2 for OTHER tools but DO NOT wire quantum gate. ` +
        `Re-run Pass 1 after 90 days of new backtest data.`
      );
      break;
    case "NO SIGNAL":
      lines.push(
        `**NO SIGNAL.** |ρ| < 0.10. Quantum disagreement metric is noise on current data. ` +
        `Park at challenger-only governance (existing design). Retire cloud QMC gate proposal. Document negative result.`
      );
      break;
    case "PRELIMINARY":
      lines.push(
        `**PRELIMINARY.** n=${validFolds} < ${MIN_FOLDS_FOR_FULL_ANALYSIS} strategy-folds required for statistical power. ` +
        `Do not draw conclusions. Defer Pass 2 quantum-gate wiring. Re-run after additional backtests with walk-forward windows.`
      );
      break;
  }
  lines.push(``);

  lines.push(`## Reproducibility`);
  lines.push(``);
  lines.push(`- Source commits: A1=5b42697, A2=e94fc3d`);
  lines.push(`- Reproducibility hash range: ${reproducibilityHashRange.min}...${reproducibilityHashRange.max}`);
  lines.push(`- Replay rows queried: quantum_mc_runs WHERE governance_labels->>'replay_mode' = 'true'`);
  lines.push(``);

  return lines.join("\n");
}
