/**
 * Wave 27 Pass 4 — B14 Survival Twin Disagreement Analysis Library
 *
 * Pure-function statistical library for the survival twin replay-grading harness.
 * Answers:
 *   1. Does survival_twin breach probability predict OOS Sharpe degradation?
 *      (Spearman ρ, mirrors Pass 1 methodology)
 *   2. Do Survival Twin and Pass A ruin_CI ci_high AGREE?
 *      (Pearson r + mean absolute disagreement + which predicted OOS failure better)
 *   3. Do Topstep-graded strategies fail differently than MFFU-graded ones?
 *      (Mann-Whitney U test per firm)
 *
 * No I/O. No DB. No side effects.
 *
 * Statistical methodology mirrors Pass 1 quantum-disagreement.ts:
 *   - IS-only threshold selection (never picked on OOS data)
 *   - CPCV purge enforcement (oos_start must be strictly after is_end)
 *   - ≥50 strategy-folds required for SIGNAL/INCONCLUSIVE/NO_SIGNAL
 *   - Below n=50 → PRELIMINARY
 *
 * Governance:
 *   - Advisory only.  Does NOT write to quantum_mc_runs or any production table.
 *   - Evidence for critic review; no promotion authority.
 *
 * Consumed by:
 *   - scripts/replay-grade-survival-twin.ts  (CLI / DB integration layer)
 *   - src/server/__tests__/replay/replay-grade-survival-twin.test.ts
 */

// ─── Re-exports from quantum-disagreement.ts (shared statistical primitives) ──

export {
  computeSpearman,
  binomialTestPValue,
  applyDecisionRule,
  checkPurgeViolation,
  applyEmbargo,
  computeSharpeFromTrades,
  computeProfitFactor,
  SHARPE_DEGRADATION_FLOOR,
  MIN_FOLDS_FOR_FULL_ANALYSIS,
  EMBARGO_TRADING_DAYS,
  type FoldMetrics,
  type ThresholdResult,
} from "./quantum-disagreement.js";

// ─── Constants ────────────────────────────────────────────────────────────────

export const SUPPORTED_FIRMS = ["Topstep", "MFFU"] as const;
export type SupportedFirm = typeof SUPPORTED_FIRMS[number];

/** Minimum Pearson |r| for cross-method agreement to be considered meaningful */
export const CROSS_METHOD_AGREEMENT_MIN_R = 0.25;

/** Minimum n for Mann-Whitney U test to be reliable */
export const MW_MIN_N_PER_FIRM = 10;

/** Verdict for the overall Pass 4 analysis */
export type SurvivalVerdict = "SIGNAL" | "INCONCLUSIVE" | "NO_SIGNAL" | "PRELIMINARY";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SurvivalFoldMetrics {
  /** quantum_mc_runs row id */
  replayRowId: string;
  backtest_id: string;
  strategyId: string;
  firm: SupportedFirm | string;

  /** survival_twin breach probability (mc_dd_breach_probability from raw_result) */
  survivalBreachProb: number;
  /** composite survival score 0-100 */
  survivalScore: number;
  /** grade letter A-F */
  grade: string;

  /** Pass A ruin_CI ci_high (may be null for pre-W27.5 backtests) */
  passARuinCiHigh: number | null;
  /** |survivalBreachProb - passARuinCiHigh| */
  crossMethodDisagreement: number | null;

  /** OOS Sharpe from backtest_trades (post-embargo) */
  oosSharpe: number | null;
  /** IS Sharpe from walk_forward_windows.is_metrics or backtests.sharpe_ratio */
  isSharpe: number | null;
  /** oosSharpe - isSharpe */
  sharpeDegradation: number | null;
}

export interface FirmDistribution {
  firm: string;
  survivingScores: number[];
  oosSharpes: number[];
  n: number;
}

export interface MannWhitneyResult {
  firmA: string;
  firmB: string;
  nA: number;
  nB: number;
  uStatistic: number;
  pValue: number;
  interpretation: string;
}

export interface CrossMethodAgreementResult {
  /** Pearson r between survival_twin breach prob and Pass A ruin_CI ci_high */
  pearsonR: number;
  /** Mean absolute disagreement across all folds with both values */
  meanAbsDisagreement: number;
  /** n folds where both values were available */
  n: number;
  /**
   * Conditional: when disagreement > 0.10, which method predicted OOS failure better?
   * "survival_twin" | "pass_a" | "neither" | "insufficient_data"
   */
  betterPredictorOnDisagreement: string;
}

export interface SurvivalTwinAnalysisResult {
  /** Total survival_twin replay rows found in quantum_mc_runs */
  replayRowsQueried: number;
  /** Folds with valid OOS join (backtest × walk_forward_windows) */
  validFolds: number;
  /** Whether analysis is preliminary (< MIN_FOLDS) */
  isPreliminary: boolean;

  /** Spearman ρ: survival_breach_prob → OOS Sharpe degradation */
  spearmanRho: number;
  spearmanPValue: number;

  /** Cross-method agreement: survival_twin vs Pass A ruin_CI */
  crossMethodAgreement: CrossMethodAgreementResult;

  /** Per-firm Mann-Whitney U (Topstep vs MFFU distributions) */
  mannWhitney: MannWhitneyResult | null;

  /** Per-firm distributions for reporting */
  firmDistributions: FirmDistribution[];

  /** Final verdict */
  verdict: SurvivalVerdict;

  /** Scorer git SHA range from replay rows */
  scorerGitShaRange: { min: string; max: string };

  /** Individual fold data */
  folds: SurvivalFoldMetrics[];
}

// ─── Pearson Correlation ──────────────────────────────────────────────────────

/**
 * Compute Pearson r correlation coefficient between two equal-length arrays.
 *
 * Returns 0 when n < 3 or variance is zero.
 */
export function computePearson(x: number[], y: number[]): number {
  const n = x.length;
  if (n !== y.length || n < 3) return 0;

  const meanX = x.reduce((a, b) => a + b, 0) / n;
  const meanY = y.reduce((a, b) => a + b, 0) / n;

  let num = 0;
  let denX = 0;
  let denY = 0;

  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }

  if (denX === 0 || denY === 0) return 0;
  return num / Math.sqrt(denX * denY);
}

// ─── Mann-Whitney U Test ──────────────────────────────────────────────────────

/**
 * Mann-Whitney U statistic for two independent samples.
 *
 * U = number of times a value from groupA precedes (is less than) a value from groupB.
 * Two-sided approximate p-value via normal approximation (valid for n > 8 each group).
 *
 * Returns uStatistic and pValue. pValue is approximate; exact only for small n.
 */
export function mannWhitneyU(
  groupA: number[],
  groupB: number[],
): { uStatistic: number; pValue: number } {
  const nA = groupA.length;
  const nB = groupB.length;

  if (nA === 0 || nB === 0) {
    return { uStatistic: 0, pValue: 1.0 };
  }

  // Compute U: count pairs where a < b
  let u = 0;
  for (const a of groupA) {
    for (const b of groupB) {
      if (a < b) u += 1;
      else if (a === b) u += 0.5;
    }
  }

  if (nA < 2 || nB < 2) {
    return { uStatistic: u, pValue: 1.0 };
  }

  // Normal approximation (valid for n > 8 each group)
  const meanU = (nA * nB) / 2;
  const stdU = Math.sqrt((nA * nB * (nA + nB + 1)) / 12);

  if (stdU === 0) {
    return { uStatistic: u, pValue: 1.0 };
  }

  const z = Math.abs((u - meanU) / stdU);
  // Two-tailed p-value via standard normal CDF
  const pValue = 2 * (1 - stdNormalCdf(z));

  return { uStatistic: u, pValue: Math.min(1.0, Math.max(0.0, pValue)) };
}

/**
 * Standard normal CDF approximation (Abramowitz & Stegun 26.2.17).
 */
export function stdNormalCdf(z: number): number {
  if (z < 0) return 1 - stdNormalCdf(-z);
  const t = 1 / (1 + 0.2316419 * z);
  const poly =
    t * (0.319381530 +
    t * (-0.356563782 +
    t * (1.781477937 +
    t * (-1.821255978 +
    t * 1.330274429))));
  return 1 - (1 / Math.sqrt(2 * Math.PI)) * Math.exp(-0.5 * z * z) * poly;
}

// ─── Cross-Method Agreement ───────────────────────────────────────────────────

/**
 * Compute cross-method agreement between survival_twin breach probabilities
 * and Pass A ruin_CI ci_high values.
 *
 * Also determines which method is a better predictor of OOS failure on the
 * subset of folds where the two methods disagree (cross_method_disagreement > 0.10).
 */
export function computeCrossMethodAgreement(
  folds: SurvivalFoldMetrics[],
  sharpeFailureFloor: number,
): CrossMethodAgreementResult {
  const paired = folds.filter(
    f => f.passARuinCiHigh !== null && f.survivalBreachProb !== null,
  );

  if (paired.length === 0) {
    return {
      pearsonR: 0,
      meanAbsDisagreement: 0,
      n: 0,
      betterPredictorOnDisagreement: "insufficient_data",
    };
  }

  const x = paired.map(f => f.survivalBreachProb);
  const y = paired.map(f => f.passARuinCiHigh as number);

  // Pearson r needs n ≥ 3 for meaningful result; meanAbsDisagreement is valid for any n ≥ 1
  const pearsonR = paired.length >= 3 ? computePearson(x, y) : 0;

  const absDisagreements = paired.map(f =>
    Math.abs(f.survivalBreachProb - (f.passARuinCiHigh as number)),
  );
  const meanAbsDisagreement =
    absDisagreements.reduce((a, b) => a + b, 0) / absDisagreements.length;

  if (paired.length < 3) {
    return {
      pearsonR,
      meanAbsDisagreement,
      n: paired.length,
      betterPredictorOnDisagreement: "insufficient_data",
    };
  }

  // On high-disagreement folds, which method predicted OOS failure better?
  const DISAGREEMENT_THRESHOLD = 0.10;
  const disagreeFolds = paired.filter(
    (f, i) => absDisagreements[i] > DISAGREEMENT_THRESHOLD
      && f.sharpeDegradation !== null,
  );

  let betterPredictorOnDisagreement = "insufficient_data";
  if (disagreeFolds.length >= 3) {
    // For each fold, check if OOS Sharpe degraded below floor (failure).
    // GATE_THRESHOLD mirrors B14_RUIN_CI_HIGH_THRESHOLD (default 0.20, tightened 2026-06-22
    // from 0.40) so this retrospective analysis reflects the SAME firing point as the
    // production gate in b14-ci-gate.ts::getB14CiHighThreshold().
    // NOTE: DISAGREEMENT_THRESHOLD (0.10, above) is a SEPARATE concept — it is the
    //       minimum inter-method spread required to count a fold as "disagreeing".
    //       Do NOT confuse the two.
    const GATE_THRESHOLD = parseFloat(
      (typeof process !== "undefined" ? process.env["B14_RUIN_CI_HIGH_THRESHOLD"] : undefined) ?? "0.20",
    );
    let survivalCorrect = 0;
    let passACorrect = 0;

    for (const f of disagreeFolds) {
      const didFail = (f.sharpeDegradation as number) <= -sharpeFailureFloor;
      const survivalFired = f.survivalBreachProb > GATE_THRESHOLD;
      const passAFired = (f.passARuinCiHigh as number) > GATE_THRESHOLD;

      if (survivalFired === didFail) survivalCorrect++;
      if (passAFired === didFail) passACorrect++;
    }

    if (survivalCorrect > passACorrect) betterPredictorOnDisagreement = "survival_twin";
    else if (passACorrect > survivalCorrect) betterPredictorOnDisagreement = "pass_a";
    else betterPredictorOnDisagreement = "neither";
  }

  return {
    pearsonR,
    meanAbsDisagreement,
    n: paired.length,
    betterPredictorOnDisagreement,
  };
}

// ─── Per-Firm Mann-Whitney ────────────────────────────────────────────────────

/**
 * Compute Mann-Whitney U test comparing OOS Sharpe distributions between
 * Topstep-graded and MFFU-graded strategies.
 *
 * Returns null if either firm has fewer than MW_MIN_N_PER_FIRM valid folds.
 */
export function computePerFirmMannWhitney(
  folds: SurvivalFoldMetrics[],
): MannWhitneyResult | null {
  const topstepSharpes = folds
    .filter(f => f.firm === "Topstep" && f.oosSharpe !== null)
    .map(f => f.oosSharpe as number);

  const mffuSharpes = folds
    .filter(f => f.firm === "MFFU" && f.oosSharpe !== null)
    .map(f => f.oosSharpe as number);

  if (topstepSharpes.length < MW_MIN_N_PER_FIRM
    || mffuSharpes.length < MW_MIN_N_PER_FIRM) {
    return null;
  }

  const { uStatistic, pValue } = mannWhitneyU(topstepSharpes, mffuSharpes);

  const interpretation = pValue <= 0.05
    ? "Topstep and MFFU graded strategies show significantly different OOS Sharpe distributions"
    : "No significant difference detected between Topstep and MFFU OOS Sharpe distributions";

  return {
    firmA: "Topstep",
    firmB: "MFFU",
    nA: topstepSharpes.length,
    nB: mffuSharpes.length,
    uStatistic,
    pValue,
    interpretation,
  };
}

// ─── Decision Rule ────────────────────────────────────────────────────────────

/**
 * Apply Pass 4 decision rule, mirroring Pass 1 methodology.
 *
 * SIGNAL:       |ρ| ≥ 0.25 AND p ≤ 0.05 AND n ≥ 50
 * INCONCLUSIVE: 0.10 ≤ |ρ| < 0.25 (any n ≥ 50)
 * NO_SIGNAL:    |ρ| < 0.10 AND n ≥ 50
 * PRELIMINARY:  n < 50
 */
export function applySurvivalDecisionRule(
  spearmanRho: number,
  spearmanPValue: number,
  n: number,
): SurvivalVerdict {
  if (n < 50) return "PRELIMINARY";
  const absRho = Math.abs(spearmanRho);
  if (absRho >= 0.25 && spearmanPValue <= 0.05) return "SIGNAL";
  if (absRho >= 0.10) return "INCONCLUSIVE";
  return "NO_SIGNAL";
}

// ─── Markdown Report Builder ──────────────────────────────────────────────────

/**
 * Build the Pass 4 markdown report conforming to the spec shape.
 */
export function buildSurvivalTwinReport(
  result: SurvivalTwinAnalysisResult,
  isoDate: string,
  migrationNotes: string = "0146 + 0147 + 0148",
): string {
  const lines: string[] = [];

  lines.push(`# Wave 27 Pass 4 — B14 Survival Twin Disagreement Signal Test`);
  lines.push(`**Date:** ${isoDate}`);
  lines.push(`**Replay rows analyzed:** ${result.replayRowsQueried}`);
  lines.push(`**Strategy-folds with valid OOS join:** ${result.validFolds}`);
  lines.push(`**Verdict:** ${result.verdict}`);
  lines.push(``);

  lines.push(`## Spearman Test (Survival breach prob → OOS Sharpe degradation)`);
  lines.push(
    `- ρ = ${result.spearmanRho.toFixed(3)} | ` +
    `p = ${result.spearmanPValue.toFixed(3)} | ` +
    `n = ${result.validFolds}`,
  );
  lines.push(``);

  lines.push(`## Cross-Method Agreement (Survival Twin vs Pass A ruin_CI ci_high)`);
  const cma = result.crossMethodAgreement;
  lines.push(
    `- Pearson r = ${cma.pearsonR.toFixed(2)} (correlation of two independent risk estimates)`,
  );
  lines.push(
    `- Mean absolute disagreement = ${cma.meanAbsDisagreement.toFixed(2)}`,
  );
  lines.push(
    `- When they disagree (>0.10): which predicted OOS failure better? **${cma.betterPredictorOnDisagreement}**`,
  );
  lines.push(`- n (pairs with both estimates) = ${cma.n}`);
  lines.push(``);

  lines.push(`## Per-Firm Mann-Whitney`);
  if (result.mannWhitney) {
    const mw = result.mannWhitney;
    lines.push(
      `| Firm | n | OOS Sharpe n | U-stat | p |`,
    );
    lines.push(`|---|---|---|---|---|`);
    lines.push(
      `| ${mw.firmA} | ${mw.nA} | ${mw.nA} | ${mw.uStatistic.toFixed(1)} | ${mw.pValue.toFixed(4)} |`,
    );
    lines.push(
      `| ${mw.firmB} | ${mw.nB} | ${mw.nB} | — | — |`,
    );
    lines.push(``);
    lines.push(`**Interpretation:** ${mw.interpretation}`);
  } else {
    lines.push(
      `_(insufficient per-firm data — need ≥ ${MW_MIN_N_PER_FIRM} folds per firm)_`,
    );
  }
  lines.push(``);

  lines.push(`## Decision Rule Applied`);
  switch (result.verdict) {
    case "SIGNAL":
      lines.push(`**SIGNAL** — |ρ| ≥ 0.25 AND p ≤ 0.05 AND n ≥ 50.`);
      lines.push(`Spearman correlation is reliable. Schedule Pass 5 evidence review.`);
      lines.push(`Advisory only — B14 hard gate evidence-gated on accumulated data.`);
      break;
    case "INCONCLUSIVE":
      lines.push(`**INCONCLUSIVE** — 0.10 ≤ |ρ| < 0.25.`);
      lines.push(`Weak correlation detected. Continue data accumulation. Re-run after 90 days.`);
      break;
    case "NO_SIGNAL":
      lines.push(`**NO_SIGNAL** — |ρ| < 0.10 AND n ≥ 50.`);
      lines.push(`No correlation detected. Park at challenger-only governance. Document negative result.`);
      break;
    case "PRELIMINARY":
      lines.push(`**PRELIMINARY** — n < 50 strategy-folds. Insufficient data for full analysis.`);
      lines.push(`Continue auto-fire accumulation. Re-run when n ≥ 50.`);
      break;
  }
  lines.push(``);

  lines.push(`## Reproducibility`);
  lines.push(
    `- survival_scorer.py git SHA range: ${result.scorerGitShaRange.min}...${result.scorerGitShaRange.max}`,
  );
  lines.push(`- Pass A migrations ${migrationNotes} applied`);
  lines.push(`- Governance: experimental=true, authoritative=false, decision_role=challenger_only`);
  lines.push(`- survival_twin=true distinguishes from quantum replay rows`);

  return lines.join("\n");
}
