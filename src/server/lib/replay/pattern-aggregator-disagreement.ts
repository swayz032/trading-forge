/**
 * Wave 27 Pass 3.G1 — Pattern Aggregator Appendix Signal Analysis Library
 *
 * Pure-function library for the pattern-aggregator replay-grading harness.
 * Answers: did appendix versions produced by pattern-aggregator ACTUALLY improve
 * subsequent strategy generation as measured by rolling Sharpe?
 *
 * Statistical methodology:
 *   - Per-version aggregation: avg Sharpe + std + n_strategies
 *   - Mann-Whitney U between consecutive appendix versions (was N+1 better than N?)
 *   - Spearman ρ on version_index vs avg_Sharpe (does newer always beat older?)
 *   - Sample size ≥10 versions with ≥5 strategies each → full analysis; otherwise PRELIMINARY
 *
 * No I/O. No DB. No side effects.
 *
 * Consumed by:
 *   - scripts/replay-grade-pattern-aggregator.ts  (CLI / DB integration layer)
 *   - src/server/__tests__/replay/replay-grade-pattern-aggregator.test.ts
 */

// ─── Re-exports from quantum-disagreement.ts (shared statistical primitives) ──

export {
  computeSpearman,
  tDistributionPValue,
  regularizedIncompleteBeta,
  logGamma,
  type AnalysisResult,
} from "./quantum-disagreement.js";

import { computeSpearman } from "./quantum-disagreement.js";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Minimum appendix versions required for full statistical analysis */
export const MIN_VERSIONS_FOR_FULL_ANALYSIS = 10;

/** Minimum strategies per version for that version to be included in trend test */
export const MIN_STRATEGIES_PER_VERSION = 5;

/** Spearman |ρ| ≥ this → SIGNAL */
export const SPEARMAN_SIGNAL_RHO = 0.25;

/** Spearman p-value ≤ this → SIGNAL */
export const SPEARMAN_SIGNAL_P = 0.05;

/** Fraction of consecutive version pairs where newer > older required for SIGNAL */
export const MW_IMPROVEMENT_RATE_SIGNAL = 0.60;

export type PatternAggregatorVerdict = "SIGNAL" | "INCONCLUSIVE" | "NO_SIGNAL" | "PRELIMINARY";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * One appendix version produced by the pattern-aggregator.
 * Sourced from prompt_versions WHERE promptType='strategy_proposer'.
 */
export interface AppendixVersion {
  /** prompt_versions.id */
  versionId: string;
  /** prompt_versions.version (monotone integer) */
  versionIndex: number;
  /** prompt_versions.created_at */
  activatedAt: Date;
}

/**
 * A strategy that was generated AFTER a given appendix version became active.
 * Attributed to the appendix version that was active when lifecycle_transitions
 * recorded decision_authority='agent' and from_state='CANDIDATE'.
 */
export interface GeneratedStrategy {
  strategyId: string;
  /** The appendix version that was active when this strategy was generated */
  appendixVersionId: string;
  appendixVersionIndex: number;
  /** When the strategy was first generated (lifecycle_transitions.created_at) */
  generatedAt: Date;
}

/**
 * Rolling 30d Sharpe data point for a strategy from paper_positions.
 */
export interface StrategySharpePnl {
  strategyId: string;
  /** Individual closed PnL values within the 30d window */
  pnls: number[];
  /** Computed rolling 30d Sharpe (0 when < 2 trades) */
  sharpe30d: number;
}

/**
 * Aggregated per-version statistics after joining strategies + Sharpe.
 */
export interface VersionStats {
  versionId: string;
  versionIndex: number;
  activatedAt: Date;
  /** Number of strategies attributed to this version */
  nStrategies: number;
  /** Average rolling 30d Sharpe across attributed strategies */
  avgSharpe: number;
  /** Std dev of Sharpe across attributed strategies (0 if n < 2) */
  stdSharpe: number;
  /** All strategy IDs attributed to this version */
  strategyIds: string[];
  /** Individual Sharpes for Mann-Whitney input */
  sharpeValues: number[];
}

/**
 * Result of Mann-Whitney U test between two consecutive version Sharpe distributions.
 */
export interface ConsecutivePairResult {
  versionIndexA: number;
  versionIndexB: number;
  nA: number;
  nB: number;
  avgSharpeA: number;
  avgSharpeB: number;
  /** True when avgSharpeB > avgSharpeA */
  improvedRaw: boolean;
  /** Mann-Whitney U statistic (higher = B dominates A) */
  uStatistic: number;
  /** Two-sided p-value */
  pValue: number;
  /** True when B's distribution is statistically higher (p ≤ 0.05) */
  improvedSignificant: boolean;
}

export interface PatternAggregatorAnalysisResult {
  /** Total prompt_version rows queried (promptType=strategy_proposer) */
  totalVersionsQueried: number;
  /** Versions with ≥ MIN_STRATEGIES_PER_VERSION attributed strategies */
  qualifyingVersions: number;
  /** Total strategies attributed across all qualifying versions */
  totalStrategiesAttributed: number;
  /** Strategies with Sharpe data from paper_positions */
  strategiesWithSharpe: number;

  /** Spearman ρ: version_index vs avg_sharpe (trend direction) */
  spearmanRho: number;
  spearmanPValue: number;

  /** Per-version aggregated stats (qualifying versions only) */
  versionStats: VersionStats[];

  /** Consecutive version pair comparisons (Mann-Whitney U) */
  consecutivePairs: ConsecutivePairResult[];

  /** Fraction of consecutive pairs where newer version improved */
  improvementRate: number;

  /** Final verdict */
  verdict: PatternAggregatorVerdict;
  isPreliminary: boolean;

  /** Audit entries accumulated during analysis */
  auditEntries: Array<{ level: "info" | "warn"; message: string; data?: unknown }>;
}

// ─── Statistical helpers ──────────────────────────────────────────────────────

/**
 * Compute Sharpe ratio from PnL array.
 * Annualizes by √252. Returns 0 for < 2 trades.
 * When std = 0 (constant PnL series), returns Infinity for positive mean,
 * -Infinity for negative mean, and 0 for zero mean.
 * A constant-positive return series has infinite Sharpe — returning 0 was wrong
 * and caused the pattern-aggregator to misclassify zero-risk-positive-return
 * strategies as non-performing. (Wave hardening 2026-06-22, CI-trust)
 */
export function computeSharpe(pnls: number[]): number {
  if (pnls.length < 2) return 0;
  const mean = pnls.reduce((a, b) => a + b, 0) / pnls.length;
  const variance =
    pnls.reduce((a, v) => a + (v - mean) ** 2, 0) / (pnls.length - 1);
  const std = Math.sqrt(variance);
  if (std === 0) {
    // Zero-risk series: Sharpe is undefined; use signed Infinity to preserve
    // ordering correctness in downstream Spearman rank correlation.
    if (mean > 0) return Infinity;
    if (mean < 0) return -Infinity;
    return 0;
  }
  return (mean / std) * Math.sqrt(252);
}

/**
 * Compute standard deviation from an array of numbers.
 * Returns 0 for n < 2.
 */
export function computeStd(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((a, v) => a + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/**
 * Standard normal CDF approximation (Abramowitz & Stegun 26.2.17).
 */
export function stdNormalCdf(z: number): number {
  if (z < 0) return 1 - stdNormalCdf(-z);
  const t = 1 / (1 + 0.2316419 * z);
  const poly =
    t *
    (0.31938153 +
      t *
        (-0.356563782 +
          t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return 1 - (1 / Math.sqrt(2 * Math.PI)) * Math.exp(-0.5 * z * z) * poly;
}

/**
 * Mann-Whitney U test for two independent samples.
 * Returns uStatistic (count where A < B, higher U means B dominates)
 * and two-tailed p-value via normal approximation.
 */
export function mannWhitneyU(
  groupA: number[],
  groupB: number[],
): { uStatistic: number; pValue: number } {
  const nA = groupA.length;
  const nB = groupB.length;

  if (nA === 0 || nB === 0) return { uStatistic: 0, pValue: 1.0 };

  // U counts how often a value from B is greater than a value from A
  let u = 0;
  for (const a of groupA) {
    for (const b of groupB) {
      if (b > a) u += 1;
      else if (b === a) u += 0.5;
    }
  }

  if (nA < 2 || nB < 2) return { uStatistic: u, pValue: 1.0 };

  const meanU = (nA * nB) / 2;
  const stdU = Math.sqrt((nA * nB * (nA + nB + 1)) / 12);
  if (stdU === 0) return { uStatistic: u, pValue: 1.0 };

  const z = Math.abs((u - meanU) / stdU);
  const pValue = 2 * (1 - stdNormalCdf(z));
  return { uStatistic: u, pValue: Math.min(1.0, Math.max(0.0, pValue)) };
}

// ─── Aggregation helpers ──────────────────────────────────────────────────────

/**
 * Attribute each generated strategy to its appendix version.
 * Strategy goes to the appendix version that was active when the strategy
 * was generated (i.e. the most recent version with activatedAt <= generatedAt).
 */
export function attributeStrategiesToVersions(
  versions: AppendixVersion[],
  strategies: GeneratedStrategy[],
): Map<string, string[]> {
  // Sort versions ascending by activatedAt
  const sorted = [...versions].sort(
    (a, b) => a.activatedAt.getTime() - b.activatedAt.getTime(),
  );

  const attribution = new Map<string, string[]>();
  for (const v of sorted) {
    attribution.set(v.versionId, []);
  }

  for (const s of strategies) {
    // Find the most recent version activated before this strategy was generated
    let best: AppendixVersion | null = null;
    for (const v of sorted) {
      if (v.activatedAt <= s.generatedAt) {
        best = v;
      }
    }
    if (best !== null) {
      attribution.get(best.versionId)!.push(s.strategyId);
    }
  }

  return attribution;
}

/**
 * Build per-version aggregated statistics from attribution map and Sharpe data.
 */
export function buildVersionStats(
  versions: AppendixVersion[],
  attribution: Map<string, string[]>,
  sharpeByStrategy: Map<string, number>,
): VersionStats[] {
  const stats: VersionStats[] = [];

  for (const v of versions) {
    const strategyIds = attribution.get(v.versionId) ?? [];
    const sharpeValues = strategyIds
      .map((id) => sharpeByStrategy.get(id))
      .filter((s): s is number => s !== undefined);

    const nStrategies = strategyIds.length;
    const avgSharpe =
      sharpeValues.length > 0
        ? sharpeValues.reduce((a, b) => a + b, 0) / sharpeValues.length
        : 0;
    const stdSharpe = computeStd(sharpeValues);

    stats.push({
      versionId: v.versionId,
      versionIndex: v.versionIndex,
      activatedAt: v.activatedAt,
      nStrategies,
      avgSharpe,
      stdSharpe,
      strategyIds,
      sharpeValues,
    });
  }

  // Sort by versionIndex ascending
  stats.sort((a, b) => a.versionIndex - b.versionIndex);
  return stats;
}

/**
 * Compute consecutive version pair comparisons using Mann-Whitney U.
 * Each pair tests whether version N+1 has a stochastically larger Sharpe
 * distribution than version N.
 */
export function computeConsecutivePairs(
  stats: VersionStats[],
): ConsecutivePairResult[] {
  const qualifying = stats.filter(
    (s) => s.sharpeValues.length >= MIN_STRATEGIES_PER_VERSION,
  );

  const pairs: ConsecutivePairResult[] = [];
  for (let i = 0; i < qualifying.length - 1; i++) {
    const a = qualifying[i];
    const b = qualifying[i + 1];
    const { uStatistic, pValue } = mannWhitneyU(a.sharpeValues, b.sharpeValues);

    pairs.push({
      versionIndexA: a.versionIndex,
      versionIndexB: b.versionIndex,
      nA: a.sharpeValues.length,
      nB: b.sharpeValues.length,
      avgSharpeA: a.avgSharpe,
      avgSharpeB: b.avgSharpe,
      improvedRaw: b.avgSharpe > a.avgSharpe,
      uStatistic,
      pValue,
      improvedSignificant: pValue <= 0.05 && b.avgSharpe > a.avgSharpe,
    });
  }

  return pairs;
}

// ─── Decision rule ────────────────────────────────────────────────────────────

/**
 * Apply Wave 27 Pass 3 pattern-aggregator decision rule.
 *
 * SIGNAL:        |ρ| ≥ 0.25 AND p ≤ 0.05 AND n_qualifying_versions ≥ 10
 *             OR improvementRate ≥ 0.60 AND n_consecutive_pairs ≥ 5
 * INCONCLUSIVE:  0.10 ≤ |ρ| < 0.25 AND n ≥ 10
 * NO_SIGNAL:     |ρ| < 0.10 AND n ≥ 10
 * PRELIMINARY:   n_qualifying_versions < 10 (always)
 */
export function applyPatternDecisionRule(
  spearmanRho: number,
  spearmanPValue: number,
  nQualifyingVersions: number,
  improvementRate: number,
  nConsecutivePairs: number,
): PatternAggregatorVerdict {
  if (nQualifyingVersions < MIN_VERSIONS_FOR_FULL_ANALYSIS) return "PRELIMINARY";

  const absRho = Math.abs(spearmanRho);

  if (
    (absRho >= SPEARMAN_SIGNAL_RHO && spearmanPValue <= SPEARMAN_SIGNAL_P) ||
    (improvementRate >= MW_IMPROVEMENT_RATE_SIGNAL && nConsecutivePairs >= 5)
  ) {
    return "SIGNAL";
  }

  if (absRho >= 0.10) return "INCONCLUSIVE";
  return "NO_SIGNAL";
}

// ─── Main evaluator ───────────────────────────────────────────────────────────

/**
 * Evaluate whether pattern-aggregator appendix versions improve strategy Sharpe.
 *
 * Pure function. Returns full analysis including Spearman trend test,
 * per-version stats, consecutive pair comparisons, and verdict.
 */
export function evaluatePatternAggregatorSignal(
  versions: AppendixVersion[],
  strategies: GeneratedStrategy[],
  sharpeByStrategy: Map<string, number>,
): PatternAggregatorAnalysisResult {
  const auditEntries: PatternAggregatorAnalysisResult["auditEntries"] = [];

  if (versions.length === 0) {
    auditEntries.push({
      level: "warn",
      message: "No prompt_versions found — analysis not possible",
    });
    return emptyAnalysis(0, auditEntries);
  }

  // Build attribution and version stats
  const attribution = attributeStrategiesToVersions(versions, strategies);
  const allStats = buildVersionStats(versions, attribution, sharpeByStrategy);

  const qualifyingStats = allStats.filter(
    (s) => s.nStrategies >= MIN_STRATEGIES_PER_VERSION,
  );

  const totalStrategiesAttributed = allStats.reduce(
    (sum, s) => sum + s.nStrategies,
    0,
  );
  const strategiesWithSharpe = allStats.reduce(
    (sum, s) => sum + s.sharpeValues.length,
    0,
  );

  auditEntries.push({
    level: "info",
    message: `Pattern aggregator analysis: ${versions.length} versions, ${qualifyingStats.length} qualifying (≥${MIN_STRATEGIES_PER_VERSION} strategies), ${totalStrategiesAttributed} strategies attributed`,
    data: {
      totalVersions: versions.length,
      qualifyingVersions: qualifyingStats.length,
      totalStrategies: totalStrategiesAttributed,
      strategiesWithSharpe,
    },
  });

  if (qualifyingStats.length === 0) {
    auditEntries.push({
      level: "warn",
      message: `No qualifying versions (all have < ${MIN_STRATEGIES_PER_VERSION} strategies with Sharpe)`,
    });
    return emptyAnalysis(versions.length, auditEntries);
  }

  // Spearman ρ: version_index vs avg_sharpe (trend test)
  const versionIndices = qualifyingStats.map((s) => s.versionIndex);
  const avgSharpes = qualifyingStats.map((s) => s.avgSharpe);
  const { rho: spearmanRho, pValue: spearmanPValue } = computeSpearman(
    versionIndices,
    avgSharpes,
  );

  // Consecutive pair comparison (Mann-Whitney U)
  const consecutivePairs = computeConsecutivePairs(qualifyingStats);
  const improvementRate =
    consecutivePairs.length > 0
      ? consecutivePairs.filter((p) => p.improvedRaw).length /
        consecutivePairs.length
      : 0;

  const verdict = applyPatternDecisionRule(
    spearmanRho,
    spearmanPValue,
    qualifyingStats.length,
    improvementRate,
    consecutivePairs.length,
  );

  const isPreliminary =
    qualifyingStats.length < MIN_VERSIONS_FOR_FULL_ANALYSIS;

  if (isPreliminary) {
    auditEntries.push({
      level: "warn",
      message: `PRELIMINARY: only ${qualifyingStats.length} qualifying versions (need ${MIN_VERSIONS_FOR_FULL_ANALYSIS})`,
    });
  }

  return {
    totalVersionsQueried: versions.length,
    qualifyingVersions: qualifyingStats.length,
    totalStrategiesAttributed,
    strategiesWithSharpe,
    spearmanRho,
    spearmanPValue,
    versionStats: allStats,
    consecutivePairs,
    improvementRate,
    verdict,
    isPreliminary,
    auditEntries,
  };
}

// ─── Markdown report builder ──────────────────────────────────────────────────

/**
 * Build Wave 27 Pass 3 pattern-aggregator signal test markdown report.
 * Pure function — no I/O. Caller decides whether to write to disk.
 */
export function buildPatternAggregatorMarkdownReport(
  result: PatternAggregatorAnalysisResult,
  isoDate: string,
): string {
  const lines: string[] = [];

  lines.push(
    `# Wave 27 Pass 3 — Pattern Aggregator Appendix Improvement Signal Test`,
  );
  lines.push(``);

  if (result.isPreliminary) {
    lines.push(
      `**PRELIMINARY — INSUFFICIENT SAMPLES (${result.qualifyingVersions} qualifying versions < ${MIN_VERSIONS_FOR_FULL_ANALYSIS})**`,
    );
    lines.push(
      `**Statistical conclusions below should not drive auto-patch decisions. Accumulate more appendix versions.**`,
    );
    lines.push(``);
  }

  lines.push(`**Date:** ${isoDate}`);
  lines.push(`**Prompt versions queried:** ${result.totalVersionsQueried}`);
  lines.push(`**Qualifying versions (≥${MIN_STRATEGIES_PER_VERSION} strategies):** ${result.qualifyingVersions}`);
  lines.push(`**Total strategies attributed:** ${result.totalStrategiesAttributed}`);
  lines.push(`**Strategies with Sharpe data:** ${result.strategiesWithSharpe}`);
  lines.push(`**Verdict:** ${result.verdict}`);
  lines.push(``);

  // Spearman trend test
  lines.push(`## Spearman Trend Test (version_index → avg_Sharpe30d)`);
  lines.push(``);
  lines.push(`- ρ = ${result.spearmanRho.toFixed(4)}`);
  lines.push(`- p-value = ${result.spearmanPValue.toFixed(4)}`);
  lines.push(`- n = ${result.qualifyingVersions} qualifying versions`);
  lines.push(``);

  // Per-version stats table
  lines.push(`## Per-Version Sharpe Statistics`);
  lines.push(``);
  lines.push(
    `| Version | Activated | Strategies | Avg Sharpe30d | Std | Strategies with data |`,
  );
  lines.push(`|---|---|---|---|---|---|`);

  const qualifying = result.versionStats.filter(
    (s) => s.nStrategies >= MIN_STRATEGIES_PER_VERSION,
  );

  for (const s of qualifying) {
    lines.push(
      `| ${s.versionIndex} | ${s.activatedAt.toISOString().slice(0, 10)} | ${s.nStrategies}` +
        ` | ${s.avgSharpe.toFixed(3)} | ${s.stdSharpe.toFixed(3)} | ${s.sharpeValues.length} |`,
    );
  }
  lines.push(``);

  // Consecutive pair comparison
  lines.push(
    `## Consecutive Version Pair Comparison (Mann-Whitney U)`,
  );
  lines.push(``);
  lines.push(
    `**Improvement rate:** ${(result.improvementRate * 100).toFixed(1)}% of consecutive pairs where newer version improved (raw avg Sharpe)`,
  );
  lines.push(``);
  lines.push(
    `| Version A | Version B | n_A | n_B | Avg Sharpe A | Avg Sharpe B | Improved? | U-stat | p |`,
  );
  lines.push(`|---|---|---|---|---|---|---|---|---|`);

  for (const p of result.consecutivePairs) {
    lines.push(
      `| ${p.versionIndexA} | ${p.versionIndexB} | ${p.nA} | ${p.nB}` +
        ` | ${p.avgSharpeA.toFixed(3)} | ${p.avgSharpeB.toFixed(3)}` +
        ` | ${p.improvedRaw ? "YES" : "no"}${p.improvedSignificant ? " (p≤0.05)" : ""}` +
        ` | ${p.uStatistic.toFixed(1)} | ${p.pValue.toFixed(4)} |`,
    );
  }
  lines.push(``);

  // Decision rule
  lines.push(`## Decision Rule Applied`);
  lines.push(``);

  switch (result.verdict) {
    case "SIGNAL":
      lines.push(
        `**SIGNAL detected.** Pattern-aggregator appendix versions show a statistically significant ` +
          `positive trend in rolling Sharpe (Spearman |ρ| ≥ ${SPEARMAN_SIGNAL_RHO} at p ≤ ${SPEARMAN_SIGNAL_P}) ` +
          `OR consecutive improvement rate ≥ ${(MW_IMPROVEMENT_RATE_SIGNAL * 100).toFixed(0)}%. ` +
          `The auto-patch loop is producing measurable improvement. ` +
          `Schedule operator review to increase appendix application frequency.`,
      );
      break;
    case "INCONCLUSIVE":
      lines.push(
        `**INCONCLUSIVE.** Weak positive trend (0.10 ≤ |ρ| < ${SPEARMAN_SIGNAL_RHO}). ` +
          `Continue accumulating data. Re-run after ${MIN_VERSIONS_FOR_FULL_ANALYSIS}+ more qualifying appendix versions. ` +
          `Do not accelerate appendix application frequency based on this result.`,
      );
      break;
    case "NO_SIGNAL":
      lines.push(
        `**NO SIGNAL.** |ρ| < 0.10. Pattern-aggregator appendix versions do not demonstrate ` +
          `measurable improvement in rolling Sharpe on current data. ` +
          `Review trade_critique rubric calibration. Document negative result. ` +
          `Do not escalate auto-patch frequency — current evidence does not support it.`,
      );
      break;
    case "PRELIMINARY":
      lines.push(
        `**PRELIMINARY.** ${result.qualifyingVersions} qualifying versions < ${MIN_VERSIONS_FOR_FULL_ANALYSIS} required. ` +
          `Cannot draw conclusions. Re-run after more appendix versions accumulate ` +
          `(each version needs ≥ ${MIN_STRATEGIES_PER_VERSION} attributed strategies with paper P&L data).`,
      );
      break;
  }
  lines.push(``);

  // Reproducibility
  lines.push(`## Reproducibility`);
  lines.push(``);
  lines.push(
    `- Source: prompt_versions WHERE prompt_type='strategy_proposer'`,
  );
  lines.push(
    `- Strategy attribution: lifecycle_transitions WHERE decision_authority='agent' AND from_state='CANDIDATE'`,
  );
  lines.push(
    `- Sharpe data: paper_trades WHERE exit_time WITHIN 30d of analysis date (per session)`,
  );
  lines.push(`- Analysis date: ${isoDate}`);
  lines.push(
    `- Signal thresholds: Spearman |ρ| ≥ ${SPEARMAN_SIGNAL_RHO} at p ≤ ${SPEARMAN_SIGNAL_P}; improvement rate ≥ ${MW_IMPROVEMENT_RATE_SIGNAL}`,
  );
  lines.push(`- Min qualifying versions: ${MIN_VERSIONS_FOR_FULL_ANALYSIS}`);
  lines.push(`- Min strategies per version: ${MIN_STRATEGIES_PER_VERSION}`);
  lines.push(``);

  return lines.join("\n");
}

// ─── Empty analysis fallback ──────────────────────────────────────────────────

function emptyAnalysis(
  totalVersionsQueried: number,
  auditEntries: PatternAggregatorAnalysisResult["auditEntries"],
): PatternAggregatorAnalysisResult {
  return {
    totalVersionsQueried,
    qualifyingVersions: 0,
    totalStrategiesAttributed: 0,
    strategiesWithSharpe: 0,
    spearmanRho: 0,
    spearmanPValue: 1.0,
    versionStats: [],
    consecutivePairs: [],
    improvementRate: 0,
    verdict: "PRELIMINARY",
    isPreliminary: true,
    auditEntries,
  };
}
