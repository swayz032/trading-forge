/**
 * Wave 27 Pass 3.G1 — Consistency Gate Payout-Denial Prediction Library
 *
 * Pure-function library for the consistency-tracker replay-grading harness.
 * Answers: would the 40% warn + 50% block thresholds have ACTUALLY prevented
 * payout denials on historical Topstep accounts?
 *
 * Statistical methodology:
 *   - Confusion matrix: blocked/warned vs payout-denied in subsequent 14-day window
 *   - Precision/Recall/F1 of the consistency gate as a payout-denial predictor
 *   - Threshold sensitivity sweep: vary warn (35-45%) + block (45-55%) thresholds ±5%
 *     in 2.5% increments → 5×5 = 25 grid points
 *
 * No I/O. No DB. No side effects.
 *
 * Consumed by:
 *   - scripts/replay-grade-consistency.ts  (CLI / DB integration layer)
 *   - src/server/__tests__/replay/replay-grade-consistency.test.ts
 */

// ─── Constants ────────────────────────────────────────────────────────────────

/** Default warn threshold for consistency gate (%) */
export const DEFAULT_WARN_THRESHOLD_PCT = 40;

/** Default block threshold for consistency gate (%) */
export const DEFAULT_BLOCK_THRESHOLD_PCT = 50;

/**
 * Forward-look window in days. Topstep payout cycle is ~14 days.
 * A gate event is "correct" if a payout denial occurs within this window.
 */
export const FORWARD_LOOK_DAYS = 14;

/** Minimum observations required for full analysis */
export const MIN_OBSERVATIONS_FOR_FULL_ANALYSIS = 50;

/**
 * Threshold grid step size (percentage points).
 * Sweep: warn in [35, 37.5, 40, 42.5, 45], block in [45, 47.5, 50, 52.5, 55].
 */
export const THRESHOLD_STEP_PCT = 2.5;

export const WARN_SWEEP_VALUES = [35, 37.5, 40, 42.5, 45] as const;
export const BLOCK_SWEEP_VALUES = [45, 47.5, 50, 52.5, 55] as const;

export type ConsistencyVerdict =
  | "SIGNAL"
  | "INCONCLUSIVE"
  | "NO_SIGNAL"
  | "PRELIMINARY";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Represents the gate verdict for one day-account observation.
 * Sourced by replaying getConsistencyState(accountId, asOf=date, dryRun=true).
 */
export interface DayAccountState {
  accountId: string;
  /** The date of this observation (ISO string "YYYY-MM-DD") */
  observationDate: string;
  /** Concentration % computed at this point in time */
  concentrationPct: number;
  /** Gate state at observation time */
  gateState: "ok" | "warn_40" | "block_50";
  /** Whether false_positive guard was suspected at this observation */
  falsePositiveSuspected: boolean;
  /**
   * Whether a payout denial event was recorded in the 14-day forward window.
   * Populated by the replay harness after querying for payout outcomes.
   * null = unknown / data not available
   */
  payoutDenied: boolean | null;
}

/**
 * Confusion matrix for gate as payout-denial predictor.
 * Positive = gate fired (block_50 or warn_40, depending on threshold variant).
 * Negative = gate was ok.
 */
export interface ConsistencyConfusionMatrix {
  /** Gate fired AND payout was denied (correct block) */
  tp: number;
  /** Gate fired AND payout was fine (false alarm) */
  fp: number;
  /** Gate did not fire AND payout was fine (correct pass) */
  tn: number;
  /** Gate did not fire AND payout was denied (missed denial) */
  fn: number;
}

/**
 * Result for one threshold variant in the sensitivity sweep.
 */
export interface ThresholdSweepResult {
  warnThresholdPct: number;
  blockThresholdPct: number;
  /** Count of observations where gate fired at these thresholds */
  gatedCount: number;
  /** Count of observations where gate did not fire */
  passedCount: number;
  confusion: ConsistencyConfusionMatrix;
  precision: number;
  recall: number;
  f1: number;
}

export interface ConsistencyAnalysisResult {
  /** Total day-account observations replayed */
  totalObservations: number;
  /** Observations with known payout outcome (payoutDenied !== null) */
  observationsWithOutcome: number;
  /** How many payout denials were observed in the dataset */
  totalPayoutDenials: number;
  /** Baseline payout denial rate (denials / total with outcome) */
  baselinePayoutRate: number;

  /** Confusion matrix at default thresholds (warn=40%, block=50%) */
  confusion: ConsistencyConfusionMatrix;
  precision: number;
  recall: number;
  f1: number;

  /** Full 5×5 threshold sensitivity grid (25 rows) */
  thresholdSweep: ThresholdSweepResult[];

  /** Optimal threshold found by maximizing F1 */
  optimalWarnPct: number;
  optimalBlockPct: number;
  optimalF1: number;

  /** Verdict */
  verdict: ConsistencyVerdict;
  isPreliminary: boolean;

  /** Audit entries */
  auditEntries: Array<{ level: "info" | "warn"; message: string; data?: unknown }>;
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Determine if an observation's gate "fired" at given thresholds.
 * Gate fires when concentrationPct >= blockThresholdPct (block)
 *     OR concentrationPct >= warnThresholdPct (warn).
 * We treat both warn and block as "gate fired" for the binary predictor model.
 *
 * When falsePositiveSuspected is true, the gate was downgraded to WARN;
 * we still count it as fired (conservative — the gate DID signal something).
 */
export function gateFiresAtThreshold(
  obs: DayAccountState,
  warnPct: number,
  blockPct: number,
): boolean {
  return obs.concentrationPct >= warnPct;
}

/**
 * Build confusion matrix from observations at given thresholds.
 * Observations with payoutDenied === null are skipped.
 */
export function buildConsistencyMatrix(
  observations: DayAccountState[],
  warnPct: number = DEFAULT_WARN_THRESHOLD_PCT,
  blockPct: number = DEFAULT_BLOCK_THRESHOLD_PCT,
): ConsistencyConfusionMatrix & { skipped: number } {
  let tp = 0, fp = 0, tn = 0, fn = 0, skipped = 0;

  for (const obs of observations) {
    if (obs.payoutDenied === null) {
      skipped++;
      continue;
    }

    const fired = gateFiresAtThreshold(obs, warnPct, blockPct);
    const denied = obs.payoutDenied;

    if (fired && denied) tp++;
    else if (fired && !denied) fp++;
    else if (!fired && !denied) tn++;
    else fn++;
  }

  return { tp, fp, tn, fn, skipped };
}

/**
 * Compute precision = TP / (TP + FP).
 */
export function computePrecision(cm: ConsistencyConfusionMatrix): number {
  const denom = cm.tp + cm.fp;
  if (denom === 0) return 0;
  return cm.tp / denom;
}

/**
 * Compute recall = TP / (TP + FN).
 */
export function computeRecall(cm: ConsistencyConfusionMatrix): number {
  const denom = cm.tp + cm.fn;
  if (denom === 0) return 0;
  return cm.tp / denom;
}

/**
 * Compute F1 = 2 * P * R / (P + R).
 */
export function computeF1(precision: number, recall: number): number {
  const denom = precision + recall;
  if (denom === 0) return 0;
  return (2 * precision * recall) / denom;
}

// ─── Threshold sensitivity sweep ─────────────────────────────────────────────

/**
 * Run the full 5×5 threshold sensitivity grid.
 * warn_pct in [35, 37.5, 40, 42.5, 45] × block_pct in [45, 47.5, 50, 52.5, 55].
 * Total = 25 grid points.
 *
 * CRITICAL: only valid threshold pairs (warn < block) are included.
 */
export function computeThresholdSensitivity(
  observations: DayAccountState[],
): ThresholdSweepResult[] {
  const results: ThresholdSweepResult[] = [];

  for (const warnPct of WARN_SWEEP_VALUES) {
    for (const blockPct of BLOCK_SWEEP_VALUES) {
      if (warnPct >= blockPct) continue; // invalid pair

      const { tp, fp, tn, fn } = buildConsistencyMatrix(
        observations,
        warnPct,
        blockPct,
      );

      const gatedCount = tp + fp;
      const passedCount = tn + fn;
      const precision = computePrecision({ tp, fp, tn, fn });
      const recall = computeRecall({ tp, fp, tn, fn });
      const f1 = computeF1(precision, recall);

      results.push({
        warnThresholdPct: warnPct,
        blockThresholdPct: blockPct,
        gatedCount,
        passedCount,
        confusion: { tp, fp, tn, fn },
        precision,
        recall,
        f1,
      });
    }
  }

  return results;
}

/**
 * Select optimal thresholds from sensitivity sweep by maximizing F1.
 * Tie-breaks toward defaults.
 */
export function selectOptimalThresholds(
  sweep: ThresholdSweepResult[],
): { warnPct: number; blockPct: number; f1: number } {
  if (sweep.length === 0) {
    return {
      warnPct: DEFAULT_WARN_THRESHOLD_PCT,
      blockPct: DEFAULT_BLOCK_THRESHOLD_PCT,
      f1: 0,
    };
  }

  const sorted = [...sweep].sort((a, b) => {
    if (Math.abs(b.f1 - a.f1) > 1e-6) return b.f1 - a.f1;
    // Tie-break: prefer defaults
    const distA =
      Math.abs(a.warnThresholdPct - DEFAULT_WARN_THRESHOLD_PCT) +
      Math.abs(a.blockThresholdPct - DEFAULT_BLOCK_THRESHOLD_PCT);
    const distB =
      Math.abs(b.warnThresholdPct - DEFAULT_WARN_THRESHOLD_PCT) +
      Math.abs(b.blockThresholdPct - DEFAULT_BLOCK_THRESHOLD_PCT);
    return distA - distB;
  });

  return {
    warnPct: sorted[0].warnThresholdPct,
    blockPct: sorted[0].blockThresholdPct,
    f1: sorted[0].f1,
  };
}

// ─── Decision rule ────────────────────────────────────────────────────────────

/**
 * Apply Wave 27 Pass 3 consistency gate decision rule.
 *
 * SIGNAL:        precision >= 0.65 AND recall >= 0.50 AND n >= 50
 *             OR F1 >= 0.55 AND n >= 50
 * INCONCLUSIVE:  0.35 <= precision < 0.65 OR 0.30 <= recall < 0.50
 * NO_SIGNAL:     precision < 0.35 AND recall < 0.30 AND n >= 50
 * PRELIMINARY:   n < 50
 */
export function applyConsistencyDecisionRule(
  precision: number,
  recall: number,
  f1: number,
  n: number,
): ConsistencyVerdict {
  if (n < MIN_OBSERVATIONS_FOR_FULL_ANALYSIS) return "PRELIMINARY";

  if ((precision >= 0.65 && recall >= 0.50) || f1 >= 0.55) return "SIGNAL";
  if (precision >= 0.35 || recall >= 0.30) return "INCONCLUSIVE";
  return "NO_SIGNAL";
}

// ─── Main evaluator ───────────────────────────────────────────────────────────

/**
 * Evaluate the consistency gate as a payout-denial predictor.
 *
 * Pure function. Returns full analysis including confusion matrix, F1,
 * threshold sensitivity sweep, optimal thresholds, and verdict.
 */
export function evaluateConsistencyGateSignal(
  observations: DayAccountState[],
  /** Optional: pre-built payout denial records for join — if null, uses payoutDenied field */
  denials?: Map<string, boolean>,
): ConsistencyAnalysisResult {
  const auditEntries: ConsistencyAnalysisResult["auditEntries"] = [];

  // Apply denials map if provided (overrides field)
  const enriched: DayAccountState[] =
    denials !== undefined
      ? observations.map((obs) => {
          const key = `${obs.accountId}::${obs.observationDate}`;
          const denied = denials.get(key);
          return { ...obs, payoutDenied: denied ?? null };
        })
      : observations;

  if (enriched.length === 0) {
    auditEntries.push({
      level: "warn",
      message: "No observations provided — analysis not possible",
    });
    return emptyAnalysis(0, auditEntries);
  }

  const withOutcome = enriched.filter((o) => o.payoutDenied !== null);
  const totalPayoutDenials = withOutcome.filter(
    (o) => o.payoutDenied === true,
  ).length;
  const baselinePayoutRate =
    withOutcome.length > 0 ? totalPayoutDenials / withOutcome.length : 0;

  auditEntries.push({
    level: "info",
    message: `Consistency gate analysis: ${enriched.length} observations, ${withOutcome.length} with known outcome, ${totalPayoutDenials} payout denials`,
    data: {
      totalObservations: enriched.length,
      observationsWithOutcome: withOutcome.length,
      totalPayoutDenials,
      baselinePayoutRate: baselinePayoutRate.toFixed(4),
    },
  });

  if (withOutcome.length === 0) {
    auditEntries.push({
      level: "warn",
      message: "No observations with known payout outcome — cannot evaluate gate",
    });
    return emptyAnalysis(enriched.length, auditEntries);
  }

  // Default threshold matrix
  const defaultMatrix = buildConsistencyMatrix(
    enriched,
    DEFAULT_WARN_THRESHOLD_PCT,
    DEFAULT_BLOCK_THRESHOLD_PCT,
  );
  const precision = computePrecision(defaultMatrix);
  const recall = computeRecall(defaultMatrix);
  const f1 = computeF1(precision, recall);

  const n = withOutcome.length;

  // Threshold sweep
  const sweep = computeThresholdSensitivity(enriched);
  const { warnPct: optimalWarnPct, blockPct: optimalBlockPct, f1: optimalF1 } =
    selectOptimalThresholds(sweep);

  const verdict = applyConsistencyDecisionRule(precision, recall, f1, n);
  const isPreliminary = n < MIN_OBSERVATIONS_FOR_FULL_ANALYSIS;

  if (isPreliminary) {
    auditEntries.push({
      level: "warn",
      message: `PRELIMINARY: only ${n} observations with outcome (need ${MIN_OBSERVATIONS_FOR_FULL_ANALYSIS})`,
    });
  }

  return {
    totalObservations: enriched.length,
    observationsWithOutcome: withOutcome.length,
    totalPayoutDenials,
    baselinePayoutRate,
    confusion: {
      tp: defaultMatrix.tp,
      fp: defaultMatrix.fp,
      tn: defaultMatrix.tn,
      fn: defaultMatrix.fn,
    },
    precision,
    recall,
    f1,
    thresholdSweep: sweep,
    optimalWarnPct,
    optimalBlockPct,
    optimalF1,
    verdict,
    isPreliminary,
    auditEntries,
  };
}

// ─── Markdown report builder ──────────────────────────────────────────────────

/**
 * Build Wave 27 Pass 3 consistency gate payout-denial prediction markdown report.
 * Pure function — no I/O. Caller decides whether to write to disk.
 */
export function buildConsistencyMarkdownReport(
  result: ConsistencyAnalysisResult,
  isoDate: string,
  daysReplayed: number = 90,
): string {
  const lines: string[] = [];

  lines.push(
    `# Wave 27 Pass 3 — Consistency Gate Payout-Denial Prediction Signal Test`,
  );
  lines.push(``);

  if (result.isPreliminary) {
    lines.push(
      `**PRELIMINARY — INSUFFICIENT SAMPLES (n=${result.observationsWithOutcome} < ${MIN_OBSERVATIONS_FOR_FULL_ANALYSIS})**`,
    );
    lines.push(
      `**Statistical conclusions below should not drive threshold-wiring decisions.**`,
    );
    lines.push(``);
  }

  lines.push(`**Date:** ${isoDate}`);
  lines.push(`**Days replayed:** ${daysReplayed}`);
  lines.push(`**Total day-account observations:** ${result.totalObservations}`);
  lines.push(`**Observations with known payout outcome:** ${result.observationsWithOutcome}`);
  lines.push(`**Total payout denials observed:** ${result.totalPayoutDenials}`);
  lines.push(
    `**Baseline payout denial rate:** ${(result.baselinePayoutRate * 100).toFixed(1)}%`,
  );
  lines.push(`**Verdict:** ${result.verdict}`);
  lines.push(``);

  // Confusion matrix
  lines.push(
    `## Consistency Gate As Payout-Denial Predictor — Confusion Matrix (defaults: warn=${DEFAULT_WARN_THRESHOLD_PCT}%, block=${DEFAULT_BLOCK_THRESHOLD_PCT}%)`,
  );
  lines.push(``);
  lines.push(
    `| | Payout Denied (within ${FORWARD_LOOK_DAYS}d) | Payout Fine |`,
  );
  lines.push(`|---|---|---|`);
  lines.push(
    `| Gate fired (≥${DEFAULT_WARN_THRESHOLD_PCT}%) | ${result.confusion.tp} (TP) | ${result.confusion.fp} (FP) |`,
  );
  lines.push(
    `| Gate ok (<${DEFAULT_WARN_THRESHOLD_PCT}%) | ${result.confusion.fn} (FN) | ${result.confusion.tn} (TN) |`,
  );
  lines.push(``);
  lines.push(`- Precision = TP / (TP + FP) = ${result.precision.toFixed(4)}`);
  lines.push(`- Recall = TP / (TP + FN) = ${result.recall.toFixed(4)}`);
  lines.push(`- F1 = 2·P·R / (P+R) = ${result.f1.toFixed(4)}`);
  lines.push(``);

  // Threshold sensitivity
  lines.push(`## Threshold Sensitivity Sweep (5×5 grid)`);
  lines.push(``);
  lines.push(
    `| Warn% | Block% | Gated | Passed | Precision | Recall | F1 |`,
  );
  lines.push(`|---|---|---|---|---|---|---|`);

  // Show a representative subset: vary one threshold at a time at defaults
  const representative = result.thresholdSweep.filter((r) => {
    const warnDefault = Math.abs(r.warnThresholdPct - DEFAULT_WARN_THRESHOLD_PCT) < 0.01;
    const blockDefault =
      Math.abs(r.blockThresholdPct - DEFAULT_BLOCK_THRESHOLD_PCT) < 0.01;
    const diffCount = (warnDefault ? 0 : 1) + (blockDefault ? 0 : 1);
    return diffCount <= 1;
  });

  for (const r of representative) {
    const isDefault =
      Math.abs(r.warnThresholdPct - DEFAULT_WARN_THRESHOLD_PCT) < 0.01 &&
      Math.abs(r.blockThresholdPct - DEFAULT_BLOCK_THRESHOLD_PCT) < 0.01;
    lines.push(
      `| ${r.warnThresholdPct.toFixed(1)}% | ${r.blockThresholdPct.toFixed(1)}%` +
        ` | ${r.gatedCount} | ${r.passedCount}` +
        ` | ${r.precision.toFixed(4)} | ${r.recall.toFixed(4)} | ${r.f1.toFixed(4)}` +
        `${isDefault ? " ← default" : ""} |`,
    );
  }
  lines.push(``);

  // Optimal threshold
  lines.push(`## Threshold Optimization`);
  lines.push(``);
  lines.push(
    `- Current defaults: warn ≥ ${DEFAULT_WARN_THRESHOLD_PCT}%, block ≥ ${DEFAULT_BLOCK_THRESHOLD_PCT}%`,
  );
  lines.push(
    `- Optimal observed: warn ≥ ${result.optimalWarnPct.toFixed(1)}%, block ≥ ${result.optimalBlockPct.toFixed(1)}% (F1 = ${result.optimalF1.toFixed(4)})`,
  );

  const defaultSweepRow = result.thresholdSweep.find(
    (r) =>
      Math.abs(r.warnThresholdPct - DEFAULT_WARN_THRESHOLD_PCT) < 0.01 &&
      Math.abs(r.blockThresholdPct - DEFAULT_BLOCK_THRESHOLD_PCT) < 0.01,
  );
  const defaultF1 = defaultSweepRow?.f1 ?? result.f1;
  const improvement = result.optimalF1 - defaultF1;

  if (Math.abs(improvement) < 0.05) {
    lines.push(
      `- Recommendation: retain defaults — optimal within 5% F1 of current spec`,
    );
  } else if (result.optimalWarnPct < DEFAULT_WARN_THRESHOLD_PCT) {
    lines.push(
      `- Recommendation: lower warn threshold — earlier signaling improves recall by >5% F1`,
    );
  } else {
    lines.push(
      `- Recommendation: raise warn threshold — fewer false alarms improves precision by >5% F1`,
    );
  }
  lines.push(``);

  // Decision rule
  lines.push(`## Decision Rule Applied`);
  lines.push(``);

  switch (result.verdict) {
    case "SIGNAL":
      lines.push(
        `**SIGNAL detected.** Precision ≥ 0.65 and Recall ≥ 0.50 (or F1 ≥ 0.55) on n=${result.observationsWithOutcome} observations. ` +
          `The consistency gate demonstrates predictive value as a forward payout-denial predictor. ` +
          `Wire shouldBlockNewEntry() into paper-signal-service entry gate at the coordination pass.`,
      );
      break;
    case "INCONCLUSIVE":
      lines.push(
        `**INCONCLUSIVE.** Partial predictive signal but precision/recall do not meet SIGNAL thresholds. ` +
          `Retain gate as advisory. Collect more historical payout outcome data before wiring as a hard block.`,
      );
      break;
    case "NO_SIGNAL":
      lines.push(
        `**NO SIGNAL.** Gate does not demonstrate predictive value on current data. ` +
          `Review threshold calibration against Topstep cycle documentation. Document negative result.`,
      );
      break;
    case "PRELIMINARY":
      lines.push(
        `**PRELIMINARY.** n=${result.observationsWithOutcome} < ${MIN_OBSERVATIONS_FOR_FULL_ANALYSIS} observations with known outcome. ` +
          `Cannot draw conclusions. Re-run after more payout cycle data is available.`,
      );
      break;
  }
  lines.push(``);

  // Reproducibility
  lines.push(`## Reproducibility`);
  lines.push(``);
  lines.push(
    `- Source: paper_positions (closed) grouped by account+day, replayed via getConsistencyState(asOf=date, dryRun=true)`,
  );
  lines.push(
    `- Forward-look window: ${FORWARD_LOOK_DAYS} days (Topstep payout cycle)`,
  );
  lines.push(`- Replay horizon: ${daysReplayed} days`);
  lines.push(`- Analysis date: ${isoDate}`);
  lines.push(
    `- Default thresholds: warn ≥ ${DEFAULT_WARN_THRESHOLD_PCT}%, block ≥ ${DEFAULT_BLOCK_THRESHOLD_PCT}%`,
  );
  lines.push(
    `- Sweep grid: warn ${WARN_SWEEP_VALUES.join("/")}%, block ${BLOCK_SWEEP_VALUES.join("/")}%`,
  );
  lines.push(``);

  return lines.join("\n");
}

// ─── Empty analysis fallback ──────────────────────────────────────────────────

function emptyAnalysis(
  totalObservations: number,
  auditEntries: ConsistencyAnalysisResult["auditEntries"],
): ConsistencyAnalysisResult {
  return {
    totalObservations,
    observationsWithOutcome: 0,
    totalPayoutDenials: 0,
    baselinePayoutRate: 0,
    confusion: { tp: 0, fp: 0, tn: 0, fn: 0 },
    precision: 0,
    recall: 0,
    f1: 0,
    thresholdSweep: [],
    optimalWarnPct: DEFAULT_WARN_THRESHOLD_PCT,
    optimalBlockPct: DEFAULT_BLOCK_THRESHOLD_PCT,
    optimalF1: 0,
    verdict: "PRELIMINARY",
    isPreliminary: true,
    auditEntries,
  };
}
