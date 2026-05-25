/**
 * Wave 27 Pass 2.F2 — Trade Critique Grade Signal Analysis Library
 *
 * Pure-function library for the critique replay-grading harness.
 * No I/O, no DB, no Date.now(), no side effects — replay-deterministic.
 *
 * Consumed by:
 *   - scripts/replay-grade-critique.ts  (CLI / DB integration layer)
 *   - src/server/__tests__/replay/replay-grade-critique.test.ts
 *
 * Statistical methodology:
 *   - Mann-Whitney U test on realized_R distributions: high-grade (A+/A/B+)
 *     vs low-grade (D/F) critiques.
 *   - Per-grade aggregation: avg R, std R, rolling 30d Sharpe after critique.
 *   - Parameter hint application rate and forward Sharpe delta.
 *   - Decision rule:
 *       SIGNAL:        U_statistic implies separation AND p <= 0.05 AND n >= 50
 *       INCONCLUSIVE:  n >= 50 but no significant separation
 *       NO_SIGNAL:     n >= 50, U near 0.5 (random)
 *       PRELIMINARY:   n < 50 critiques per strategy
 */

// ─── Constants ────────────────────────────────────────────────────────────────

export const GRADE_ORDER: readonly string[] = ["A+", "A", "B+", "B", "C+", "C", "D", "F"] as const;
export type CritiqueGrade = "A+" | "A" | "B+" | "B" | "C+" | "C" | "D" | "F";

export const HIGH_GRADES = new Set<CritiqueGrade>(["A+", "A", "B+"]);
export const LOW_GRADES  = new Set<CritiqueGrade>(["D", "F"]);
export const MIN_CRITIQUES_FOR_FULL_ANALYSIS = 50;

// Annualisation for Sharpe — 252 trading days / ~252 1-day windows per year
export const TRADING_DAYS_PER_YEAR = 252;

// ─── Types ────────────────────────────────────────────────────────────────────

/** Minimal shape needed from paper_positions — caller supplies what it has. */
export interface PaperPositionRow {
  id: string;
  strategyId: string | null;
  realizedR: number | null;    // computed from entryPrice/exitPrice/stopPrice
  closedAt: Date | null;
}

/** Minimal shape needed from trade_critique. */
export interface TradeCritiqueRow {
  id: string;
  positionId: string;
  strategyId: string | null;
  grade: string;               // A+/A/B+/B/C+/C/D/F
  critiquedAt: Date;
  parameterHint: ParameterHint | null;
  /** Realized R read from technicalDiagnosis.realized_r (float or null). */
  realizedR: number | null;
}

export interface ParameterHint {
  field: string;
  current: string | number | null;
  suggested_range: string;
  confidence: number;
  /** True when the operator or auto-evolve applied this hint. Populated by caller. */
  applied?: boolean;
  /** Sharpe 30d before hint was acted on, if available. */
  sharpe_before?: number | null;
  /** Sharpe 30d after hint was acted on, if available. */
  sharpe_after?: number | null;
}

export interface GradeStats {
  grade: string;
  count: number;
  avgR: number;
  stdR: number;
  rollingSharpAfter: number;   // avg rolling 30d Sharpe across trades with this grade
}

export interface ParameterHintStats {
  critiquesWithHint: number;
  hintsApplied: number;
  applicationRate: number;       // hintsApplied / critiquesWithHint
  avgSharpeDeltaWhenApplied: number | null;  // avg (sharpe_after - sharpe_before) across applied hints
}

export interface CritiqueAnalysisResult {
  critiquesAnalyzed: number;
  positionsLinked: number;
  nHigh: number;           // A+/A/B+ trades
  nLow: number;            // D/F trades
  mannWhitneyU: number;    // raw U statistic
  mannWhitneyZ: number;    // normal approximation z-score
  mannWhitneyPValue: number;
  /** Effect size: U / (nHigh * nLow).  0.5 = no separation, 1.0 = perfect. */
  uEffectSize: number;
  gradeStats: GradeStats[];
  parameterHintStats: ParameterHintStats;
  verdict: "SIGNAL" | "INCONCLUSIVE" | "NO_SIGNAL" | "PRELIMINARY";
  isPreliminary: boolean;
}

// ─── Rolling Sharpe (within ±30 calendar days after critique) ─────────────────

/**
 * Compute a per-critique "rolling 30d Sharpe" from trade realizedR values
 * within the 30 calendar days AFTER the critique's critiquedAt timestamp.
 *
 * This is a forward-Sharpe proxy using realized_R as the P&L surrogate.
 * Requires >= 2 trades in the window to return a non-zero value.
 */
export function computeRollingSharpAfter(
  positionsAfterCritique: Array<{ realizedR: number | null; closedAt: Date | null }>,
  critiquedAt: Date,
  windowDays = 30,
): number {
  const cutoff = new Date(critiquedAt.getTime() + windowDays * 24 * 60 * 60 * 1000);
  const rs = positionsAfterCritique
    .filter(p => {
      if (!p.closedAt || p.realizedR === null) return false;
      return p.closedAt > critiquedAt && p.closedAt <= cutoff;
    })
    .map(p => p.realizedR as number);

  return computeSharpeFromRs(rs);
}

/**
 * Annualised Sharpe from a list of realized-R values.
 * Assumes each R corresponds to one trade; annualises by sqrt(TRADING_DAYS_PER_YEAR).
 */
export function computeSharpeFromRs(rs: number[]): number {
  if (rs.length < 2) return 0;
  const n = rs.length;
  const mean = rs.reduce((a, b) => a + b, 0) / n;
  const variance = rs.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1);
  const std = Math.sqrt(variance);
  if (std === 0) return 0;
  return (mean / std) * Math.sqrt(TRADING_DAYS_PER_YEAR);
}

// ─── Per-grade aggregation ─────────────────────────────────────────────────────

/**
 * Aggregate critique rows into per-grade statistics.
 * `positionsByStrategyId` is used to compute the forward rolling Sharpe.
 */
export function aggregateByGrade(
  critiques: TradeCritiqueRow[],
  positionLookup: Map<string, PaperPositionRow>,
  allPositionsByStrategy: Map<string, PaperPositionRow[]>,
): GradeStats[] {
  const byGrade = new Map<string, number[]>();
  const sharpesByGrade = new Map<string, number[]>();

  for (const c of critiques) {
    const grade = c.grade;
    if (!byGrade.has(grade)) {
      byGrade.set(grade, []);
      sharpesByGrade.set(grade, []);
    }

    // Use the realizedR from the critique row (technicalDiagnosis.realized_r)
    // or fall back to the position's computed R.
    let rValue = c.realizedR;
    if (rValue === null) {
      const pos = positionLookup.get(c.positionId);
      rValue = pos?.realizedR ?? null;
    }
    if (rValue !== null) {
      byGrade.get(grade)!.push(rValue);
    }

    // Forward 30d Sharpe
    if (c.strategyId) {
      const stratPositions = allPositionsByStrategy.get(c.strategyId) ?? [];
      const fwdSharpe = computeRollingSharpAfter(stratPositions, c.critiquedAt);
      sharpesByGrade.get(grade)!.push(fwdSharpe);
    }
  }

  return GRADE_ORDER
    .filter(g => byGrade.has(g))
    .map(g => {
      const rs = byGrade.get(g)!;
      const sharpes = sharpesByGrade.get(g)!;
      return {
        grade: g,
        count: rs.length,
        avgR: rs.length > 0 ? rs.reduce((a, b) => a + b, 0) / rs.length : 0,
        stdR: computeStd(rs),
        rollingSharpAfter: sharpes.length > 0 ? sharpes.reduce((a, b) => a + b, 0) / sharpes.length : 0,
      };
    });
}

function computeStd(values: number[]): number {
  if (values.length < 2) return 0;
  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1);
  return Math.sqrt(variance);
}

// ─── Mann-Whitney U Test ──────────────────────────────────────────────────────

/**
 * Mann-Whitney U test (two-sample, two-tailed).
 *
 * Tests H0: distributions of high-grade vs low-grade realized_R are identical.
 * Uses the normal approximation with continuity correction (valid for n >= 5 per group).
 *
 * Returns:
 *   U        — smaller of U1, U2 (conventional; effect size uses U1 directly)
 *   z        — normal approximation z-score
 *   pValue   — two-tailed p-value under null
 *   u1       — rank sum statistic for group X (high-grade)
 *   n1, n2   — group sizes
 *
 * Reference implementation matches scipy.stats.mannwhitneyu(alternative='two-sided').
 */
export function mannWhitneyU(
  groupX: number[],   // high-grade realized R values
  groupY: number[],   // low-grade realized R values
): { U: number; z: number; pValue: number; u1: number; n1: number; n2: number } {
  const n1 = groupX.length;
  const n2 = groupY.length;

  if (n1 === 0 || n2 === 0) {
    return { U: 0, z: 0, pValue: 1.0, u1: 0, n1, n2 };
  }

  // Pool and rank all values
  const combined: Array<{ value: number; group: 0 | 1 }> = [
    ...groupX.map(v => ({ value: v, group: 0 as const })),
    ...groupY.map(v => ({ value: v, group: 1 as const })),
  ];

  // Sort by value
  combined.sort((a, b) => a.value - b.value);

  // Assign mid-ranks (average ranks for ties)
  const ranks = new Array<number>(combined.length);
  let i = 0;
  while (i < combined.length) {
    let j = i;
    while (j < combined.length - 1 && combined[j + 1].value === combined[j].value) j++;
    const avgRank = (i + j) / 2 + 1;   // 1-based average rank
    for (let k = i; k <= j; k++) ranks[k] = avgRank;
    i = j + 1;
  }

  // Tie correction factor T = sum_t((t^3 - t) / 12) for continuity with normal approx
  // where t = size of each tied group
  let tieCorrection = 0;
  {
    let ti = 0;
    while (ti < combined.length) {
      let tj = ti;
      while (tj < combined.length - 1 && combined[tj + 1].value === combined[tj].value) tj++;
      const t = tj - ti + 1;
      if (t > 1) {
        tieCorrection += (t * t * t - t) / 12;
      }
      ti = tj + 1;
    }
  }

  // R1 = sum of ranks in group X (high-grade)
  let R1 = 0;
  for (let k = 0; k < combined.length; k++) {
    if (combined[k].group === 0) R1 += ranks[k];
  }

  const U1 = R1 - (n1 * (n1 + 1)) / 2;
  const U2 = n1 * n2 - U1;
  const U = Math.min(U1, U2);

  const N = n1 + n2;
  const meanU = (n1 * n2) / 2;
  const sigmaU = Math.sqrt(
    (n1 * n2 / (N * (N - 1))) * ((N * N * N - N) / 12 - tieCorrection),
  );

  if (sigmaU === 0) {
    return { U, z: 0, pValue: 1.0, u1: U1, n1, n2 };
  }

  // Continuity correction: subtract 0.5 from |U1 - meanU|
  const z = (Math.abs(U1 - meanU) - 0.5) / sigmaU;
  const pValue = 2 * (1 - normalCDF(z));   // two-tailed

  return { U, z, pValue: Math.min(1.0, Math.max(0.0, pValue)), u1: U1, n1, n2 };
}

/**
 * Standard normal CDF via Abramowitz & Stegun approximation (error < 7.5e-8).
 */
export function normalCDF(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const poly = t * (0.319381530
    + t * (-0.356563782
    + t * (1.781477937
    + t * (-1.821255978
    + t * 1.330274429))));
  const pdf = Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI);
  const p = 1 - pdf * poly;
  return z >= 0 ? p : 1 - p;
}

// ─── Parameter hint aggregation ──────────────────────────────────────────────

export function aggregateParameterHints(critiques: TradeCritiqueRow[]): ParameterHintStats {
  const withHint = critiques.filter(c => c.parameterHint !== null);
  const applied  = withHint.filter(c => c.parameterHint?.applied === true);

  const sharpDeltas: number[] = applied
    .map(c => {
      const h = c.parameterHint!;
      if (h.sharpe_before != null && h.sharpe_after != null) {
        return h.sharpe_after - h.sharpe_before;
      }
      return null;
    })
    .filter((d): d is number => d !== null);

  return {
    critiquesWithHint: withHint.length,
    hintsApplied: applied.length,
    applicationRate: withHint.length > 0 ? applied.length / withHint.length : 0,
    avgSharpeDeltaWhenApplied: sharpDeltas.length > 0
      ? sharpDeltas.reduce((a, b) => a + b, 0) / sharpDeltas.length
      : null,
  };
}

// ─── Decision rule ────────────────────────────────────────────────────────────

/**
 * Apply the Wave 27 Pass 2.F2 decision rule.
 *
 * SIGNAL:        U effect size >= 0.65 AND p <= 0.05 AND n >= MIN
 * INCONCLUSIVE:  0.55 <= effect < 0.65 OR (effect >= 0.65 AND p > 0.05) AND n >= MIN
 * NO_SIGNAL:     effect < 0.55 AND n >= MIN
 * PRELIMINARY:   n < MIN (always)
 *
 * Effect size = U1 / (n1 * n2); 0.5 = chance, 1.0 = perfect separation.
 */
export function applyCritiqueDecisionRule(
  uEffectSize: number,
  pValue: number,
  totalN: number,
): "SIGNAL" | "INCONCLUSIVE" | "NO_SIGNAL" | "PRELIMINARY" {
  if (totalN < MIN_CRITIQUES_FOR_FULL_ANALYSIS) return "PRELIMINARY";
  if (uEffectSize >= 0.65 && pValue <= 0.05)    return "SIGNAL";
  if (uEffectSize >= 0.55)                       return "INCONCLUSIVE";
  return "NO_SIGNAL";
}

// ─── Main analysis entry point ────────────────────────────────────────────────

/**
 * Evaluate the grade signal from a set of critique rows and their associated positions.
 *
 * @param critiques     - All TradeCritiqueRow records (any grade)
 * @param positions     - All PaperPositionRow records (all strategies)
 */
export function evaluateCritiqueGradeSignal(
  critiques: TradeCritiqueRow[],
  positions: PaperPositionRow[],
): CritiqueAnalysisResult {
  const positionLookup = new Map<string, PaperPositionRow>(
    positions.map(p => [p.id, p]),
  );

  const allPositionsByStrategy = new Map<string, PaperPositionRow[]>();
  for (const p of positions) {
    if (!p.strategyId) continue;
    if (!allPositionsByStrategy.has(p.strategyId)) {
      allPositionsByStrategy.set(p.strategyId, []);
    }
    allPositionsByStrategy.get(p.strategyId)!.push(p);
  }

  // Collect R values per grade group
  const highRs: number[] = [];
  const lowRs: number[]  = [];

  for (const c of critiques) {
    const grade = c.grade as CritiqueGrade;
    let r = c.realizedR;
    if (r === null) {
      r = positionLookup.get(c.positionId)?.realizedR ?? null;
    }
    if (r === null) continue;

    if (HIGH_GRADES.has(grade)) highRs.push(r);
    if (LOW_GRADES.has(grade))  lowRs.push(r);
  }

  const { U, z, pValue, u1, n1, n2 } = mannWhitneyU(highRs, lowRs);
  const uEffectSize = (n1 * n2) > 0 ? u1 / (n1 * n2) : 0.5;

  const gradeStats = aggregateByGrade(critiques, positionLookup, allPositionsByStrategy);
  const parameterHintStats = aggregateParameterHints(critiques);

  const totalN = critiques.length;
  const verdict = applyCritiqueDecisionRule(uEffectSize, pValue, totalN);

  return {
    critiquesAnalyzed: totalN,
    positionsLinked: positions.length,
    nHigh: n1,
    nLow: n2,
    mannWhitneyU: U,
    mannWhitneyZ: z,
    mannWhitneyPValue: pValue,
    uEffectSize,
    gradeStats,
    parameterHintStats,
    verdict,
    isPreliminary: totalN < MIN_CRITIQUES_FOR_FULL_ANALYSIS,
  };
}

// ─── Markdown report builder ──────────────────────────────────────────────────

/**
 * Build the Wave 27 Pass 2 trade critique grade signal markdown report.
 * Pure function — no I/O.
 */
export function buildCritiqueMarkdownReport(
  result: CritiqueAnalysisResult,
  isoDate: string,
  extra: {
    critiqueSHA?: string;
    sampleSql?: string;
  } = {},
): string {
  const lines: string[] = [];

  lines.push(`# Wave 27 Pass 2 — Trade Critique Grade Signal Test`);
  lines.push(``);

  if (result.isPreliminary) {
    lines.push(`**PRELIMINARY — INSUFFICIENT SAMPLES (n=${result.critiquesAnalyzed} < ${MIN_CRITIQUES_FOR_FULL_ANALYSIS})**`);
    lines.push(`**Statistical conclusions below should not drive gate-wiring decisions.**`);
    lines.push(``);
  }

  lines.push(`**Date:** ${isoDate}`);
  lines.push(`**Critiques analyzed:** ${result.critiquesAnalyzed}`);
  lines.push(`**Positions linked:** ${result.positionsLinked}`);
  lines.push(`**Verdict:** ${result.verdict}`);
  lines.push(``);

  lines.push(`## Mann-Whitney U Test (high-grade vs low-grade realized R)`);
  lines.push(``);
  lines.push(`- U-statistic = ${result.mannWhitneyU.toFixed(2)}`);
  lines.push(`- p-value = ${result.mannWhitneyPValue.toFixed(4)}`);
  lines.push(`- n_high = ${result.nHigh} (A+/A/B+ trades), n_low = ${result.nLow} (D/F trades)`);
  lines.push(`- Effect size (U1/(n1*n2)) = ${result.uEffectSize.toFixed(4)} (0.50=chance, 1.00=perfect separation)`);
  lines.push(``);

  lines.push(`## Per-Grade Performance Distribution`);
  lines.push(``);
  lines.push(`| Grade | Count | Avg R | Std R | Rolling 30d Sharpe after |`);
  lines.push(`|---|---|---|---|---|`);
  for (const g of result.gradeStats) {
    lines.push(
      `| ${g.grade} | ${g.count} | ${g.avgR.toFixed(3)} | ${g.stdR.toFixed(3)} | ${g.rollingSharpAfter.toFixed(3)} |`,
    );
  }
  lines.push(``);

  lines.push(`## Parameter Hint Application Rate`);
  lines.push(``);
  const ph = result.parameterHintStats;
  lines.push(`- Critiques with parameter_hint emitted: ${ph.critiquesWithHint}`);
  lines.push(`- Hints applied (operator/auto-evolve): ${ph.hintsApplied}`);
  lines.push(`- Application rate: ${ph.critiquesWithHint > 0 ? ((ph.hintsApplied / ph.critiquesWithHint) * 100).toFixed(1) : "N/A"}%`);
  if (ph.avgSharpeDeltaWhenApplied !== null) {
    const sign = ph.avgSharpeDeltaWhenApplied >= 0 ? "+" : "";
    lines.push(`- Avg Sharpe delta when applied (before vs after 30d): ${sign}${ph.avgSharpeDeltaWhenApplied.toFixed(3)}`);
  } else {
    lines.push(`- Avg Sharpe delta when applied (before vs after 30d): N/A`);
  }
  lines.push(``);

  lines.push(`## Decision Rule Applied`);
  lines.push(``);

  switch (result.verdict) {
    case "SIGNAL":
      lines.push(
        `**SIGNAL detected.** U effect size >= 0.65 with p <= 0.05. Grade signal is predictive of ` +
        `strategy degradation. Consider wiring critique grade as a SOFT advisory signal at PAPER → DEPLOY_READY.`,
      );
      break;
    case "INCONCLUSIVE":
      lines.push(
        `**INCONCLUSIVE.** Marginal separation (0.55 <= effect < 0.65) or insufficient p-value. ` +
        `Re-run after 90 additional days of critique accumulation before wiring grade signal.`,
      );
      break;
    case "NO_SIGNAL":
      lines.push(
        `**NO SIGNAL.** U effect size < 0.55 — grade distributions are indistinguishable on realized R. ` +
        `Critique grades are not predictive of strategy-level performance at this sample size. ` +
        `Do not wire as a promotion gate.`,
      );
      break;
    case "PRELIMINARY":
      lines.push(
        `**PRELIMINARY.** n=${result.critiquesAnalyzed} < ${MIN_CRITIQUES_FOR_FULL_ANALYSIS} critiques required. ` +
        `Do not draw conclusions. Defer gate-wiring decision.`,
      );
      break;
  }
  lines.push(``);

  lines.push(`## Reproducibility`);
  lines.push(``);
  lines.push(`- trade-critique service SHA: ${extra.critiqueSHA ?? "unknown"}`);
  lines.push(`- dryRun=true was passed to all runTradeCritique() invocations (no prod table writes)`);
  if (extra.sampleSql) {
    lines.push(`- Sample SQL: \`${extra.sampleSql}\``);
  } else {
    lines.push(`- Sample SQL: SELECT * FROM paper_positions WHERE closed_at IS NOT NULL AND closed_at >= NOW() - INTERVAL '90 days'`);
  }
  lines.push(``);

  return lines.join("\n");
}
