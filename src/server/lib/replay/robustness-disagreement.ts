/**
 * Wave 27 Pass 2.F3 — B15 Parameter Robustness Battery Signal Analysis Library
 *
 * Pure-function library for robustness replay-grading harness.
 * Answers: do B15 SDR/PSI/RWS threshold gates ACTUALLY predict forward failure?
 *
 * No I/O. No DB. No side effects.
 *
 * Consumed by:
 *   - scripts/replay-grade-robustness.ts  (CLI / DB integration layer)
 *   - src/server/__tests__/replay/replay-grade-robustness.test.ts
 */

// ─── Constants ────────────────────────────────────────────────────────────────

/** B15 institutional thresholds (QuantForgeAnalytics 2026-05-16 spec) */
export const B15_SDR_THRESHOLD = 0.85;   // Sensitivity-to-Default Ratio — block if BELOW
export const B15_PSI_THRESHOLD = 0.05;   // Population Stability Index — block if ABOVE
export const B15_RWS_THRESHOLD = 0.20;   // Regime Walk-forward Score — block if ABOVE

/**
 * ±10% sensitivity sweep multipliers around each default threshold.
 * For each threshold T we evaluate T×0.90, T, T×1.10.
 */
export const SENSITIVITY_MULTIPLIERS = [0.90, 1.00, 1.10] as const;

/** Minimum strategies with B15 + lifecycle outcome required for full analysis */
export const MIN_STRATEGIES_FOR_FULL_ANALYSIS = 50;

/**
 * Lifecycle states considered "failure" outcomes.
 * A strategy that reached DECLINING, RETIRED, or GRAVEYARD after promotion failed.
 */
export const FAILURE_STATES = new Set(["DECLINING", "RETIRED", "GRAVEYARD"]);

/**
 * Lifecycle states considered "success" outcomes.
 * A strategy that reached DEPLOYED and stayed stable succeeded.
 */
export const SUCCESS_STATES = new Set(["DEPLOYED", "PILOT"]);

/**
 * Time window after PAPER promotion: if demoted within this many days → failure.
 */
export const DEMOTION_WINDOW_DAYS = 30;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BacktestRow {
  backtestId: string;
  strategyId: string;
  /** Full B15 battery JSONB result: {sdr, psi, rws, passed, ...} */
  b15Battery: {
    sdr: number;
    psi: number;
    rws: number;
    passed: boolean;
    failures?: string[];
    thresholds?: Record<string, number>;
    sdr_detail?: Record<string, unknown>;
    psi_detail?: Record<string, unknown>;
    rws_detail?: Record<string, unknown>;
  };
  createdAt: Date;
}

export interface LifecycleOutcomeRow {
  strategyId: string;
  /** State strategy reached (PAPER|DEPLOY_READY|PILOT|DEPLOYED|DECLINING|RETIRED|GRAVEYARD) */
  finalState: string;
  /** When the strategy left PAPER or reached a terminal state */
  transitionedAt: Date;
  /** Whether this outcome is a demotion within DEMOTION_WINDOW_DAYS of promotion */
  earlyDemotion?: boolean;
}

export interface ConfusionMatrix {
  /** B15 blocked AND strategy failed (correct block) */
  tp: number;
  /** B15 blocked AND strategy would have succeeded (over-conservative block) */
  fp: number;
  /** B15 passed AND strategy succeeded (correct pass) */
  tn: number;
  /** B15 passed AND strategy failed (missed failure) */
  fn: number;
}

export interface PerThresholdResult {
  /** SDR threshold variant */
  sdrThreshold: number;
  /** PSI threshold variant */
  psiThreshold: number;
  /** RWS threshold variant */
  rwsThreshold: number;
  /** Number of strategies blocked at these thresholds */
  blockedCount: number;
  /** Number of strategies passed at these thresholds */
  passedCount: number;
  confusion: ConfusionMatrix;
  precision: number;
  recall: number;
  f1: number;
}

export interface RobustnessAnalysisResult {
  /** Total BacktestRows with b15_battery populated */
  totalB15Rows: number;
  /** Rows where lifecycle outcome was matched */
  outcomeLinkedCount: number;
  /** Confusion matrix at default institutional thresholds */
  confusion: ConfusionMatrix;
  /** Precision = TP / (TP + FP) */
  precision: number;
  /** Recall = TP / (TP + FN) */
  recall: number;
  /** F1 = 2*P*R / (P+R) */
  f1: number;
  /** Per-threshold sensitivity sweep: ±10% on each of SDR, PSI, RWS */
  perThresholdResults: PerThresholdResult[];
  /** Optimal thresholds observed from sensitivity sweep */
  optimalSdr: number;
  optimalPsi: number;
  optimalRws: number;
  /** Final recommendation */
  recommendation: "RETAIN_DEFAULTS" | "TIGHTEN_GATES" | "RELAX_GATES" | "INSUFFICIENT_DATA";
  /** Analysis verdict */
  verdict: "SIGNAL" | "INCONCLUSIVE" | "NO_SIGNAL" | "PRELIMINARY";
  isPreliminary: boolean;
  /** Unlinked strategy IDs (B15 run but no lifecycle outcome found) */
  unlinkedStrategyIds: string[];
  /** Audit log entries accumulated during analysis */
  auditEntries: Array<{ level: "info" | "warn"; message: string; data?: unknown }>;
}

// ─── Core classification helpers ─────────────────────────────────────────────

/**
 * Classify a strategy outcome as "failed" or "succeeded" given the final
 * lifecycle state and, if known, whether it was demoted within DEMOTION_WINDOW_DAYS.
 *
 * Returns:
 *   "failed"    — reached DECLINING/RETIRED/GRAVEYARD, or early demotion
 *   "succeeded" — reached DEPLOYED/PILOT without early demotion
 *   "unknown"   — insufficient lifecycle data to classify
 */
export function classifyOutcome(
  outcome: LifecycleOutcomeRow,
): "failed" | "succeeded" | "unknown" {
  if (FAILURE_STATES.has(outcome.finalState)) return "failed";
  if (outcome.earlyDemotion === true) return "failed";
  if (SUCCESS_STATES.has(outcome.finalState)) return "succeeded";
  return "unknown";
}

/**
 * Decide if a strategy is "blocked" by B15 at the given threshold values.
 * Blocked = SDR < sdrMin OR PSI > psiMax OR RWS > rwsMax.
 */
export function isBlockedByB15(
  b15: BacktestRow["b15Battery"],
  sdrMin: number = B15_SDR_THRESHOLD,
  psiMax: number = B15_PSI_THRESHOLD,
  rwsMax: number = B15_RWS_THRESHOLD,
): boolean {
  return b15.sdr < sdrMin || b15.psi > psiMax || b15.rws > rwsMax;
}

// ─── Confusion matrix ─────────────────────────────────────────────────────────

/**
 * Build confusion matrix from arrays of per-strategy results.
 *
 * Canonical definition for B15 as a failure predictor:
 *   TP: B15 blocked (positive prediction) + strategy actually failed
 *   FP: B15 blocked (positive prediction) + strategy succeeded
 *   TN: B15 passed  (negative prediction) + strategy succeeded
 *   FN: B15 passed  (negative prediction) + strategy actually failed
 */
export function buildConfusionMatrix(
  b15Rows: BacktestRow[],
  outcomes: LifecycleOutcomeRow[],
  sdrMin: number = B15_SDR_THRESHOLD,
  psiMax: number = B15_PSI_THRESHOLD,
  rwsMax: number = B15_RWS_THRESHOLD,
): ConfusionMatrix & { unlinked: string[] } {
  const outcomeByStrategy = new Map<string, LifecycleOutcomeRow>();
  for (const o of outcomes) {
    // Keep the most recent outcome per strategy
    const existing = outcomeByStrategy.get(o.strategyId);
    if (!existing || o.transitionedAt > existing.transitionedAt) {
      outcomeByStrategy.set(o.strategyId, o);
    }
  }

  let tp = 0, fp = 0, tn = 0, fn = 0;
  const unlinked: string[] = [];

  for (const bt of b15Rows) {
    const outcome = outcomeByStrategy.get(bt.strategyId);
    if (!outcome) {
      unlinked.push(bt.strategyId);
      continue;
    }

    const resolved = classifyOutcome(outcome);
    if (resolved === "unknown") {
      // Not enough lifecycle data — skip (equivalent to unlinked for matrix)
      unlinked.push(bt.strategyId);
      continue;
    }

    const blocked = isBlockedByB15(bt.b15Battery, sdrMin, psiMax, rwsMax);

    if (blocked && resolved === "failed")   tp++;
    if (blocked && resolved === "succeeded") fp++;
    if (!blocked && resolved === "succeeded") tn++;
    if (!blocked && resolved === "failed")   fn++;
  }

  return { tp, fp, tn, fn, unlinked };
}

// ─── Derived metrics ─────────────────────────────────────────────────────────

export function computePrecision(cm: ConfusionMatrix): number {
  const denom = cm.tp + cm.fp;
  if (denom === 0) return 0;
  return cm.tp / denom;
}

export function computeRecall(cm: ConfusionMatrix): number {
  const denom = cm.tp + cm.fn;
  if (denom === 0) return 0;
  return cm.tp / denom;
}

export function computeF1(precision: number, recall: number): number {
  const denom = precision + recall;
  if (denom === 0) return 0;
  return (2 * precision * recall) / denom;
}

// ─── Threshold sensitivity sweep ─────────────────────────────────────────────

/**
 * Compute per-threshold precision/recall/F1 across ±10% multipliers for each
 * of SDR, PSI, and RWS.
 *
 * Total variants = 3 SDR × 3 PSI × 3 RWS = 27 rows.
 * Caller filters or selects from the full grid.
 */
export function computeThresholdSensitivity(
  b15Rows: BacktestRow[],
  outcomes: LifecycleOutcomeRow[],
): PerThresholdResult[] {
  const results: PerThresholdResult[] = [];

  for (const sdrMult of SENSITIVITY_MULTIPLIERS) {
    for (const psiMult of SENSITIVITY_MULTIPLIERS) {
      for (const rwsMult of SENSITIVITY_MULTIPLIERS) {
        const sdrT = B15_SDR_THRESHOLD * sdrMult;
        const psiT = B15_PSI_THRESHOLD * psiMult;
        const rwsT = B15_RWS_THRESHOLD * rwsMult;

        const { tp, fp, tn, fn } = buildConfusionMatrix(
          b15Rows, outcomes, sdrT, psiT, rwsT,
        );

        const blockedCount = tp + fp;
        const passedCount = tn + fn;
        const precision = computePrecision({ tp, fp, tn, fn });
        const recall = computeRecall({ tp, fp, tn, fn });
        const f1 = computeF1(precision, recall);

        results.push({
          sdrThreshold: sdrT,
          psiThreshold: psiT,
          rwsThreshold: rwsT,
          blockedCount,
          passedCount,
          confusion: { tp, fp, tn, fn },
          precision,
          recall,
          f1,
        });
      }
    }
  }

  return results;
}

/**
 * Select optimal thresholds from sensitivity sweep: maximizes F1.
 * Returns the thresholds from the row with the highest F1 score.
 * When tied, prefers the row closest to institutional defaults.
 */
export function selectOptimalThresholds(
  perThresholdResults: PerThresholdResult[],
): { sdr: number; psi: number; rws: number } {
  if (perThresholdResults.length === 0) {
    return { sdr: B15_SDR_THRESHOLD, psi: B15_PSI_THRESHOLD, rws: B15_RWS_THRESHOLD };
  }

  const sorted = [...perThresholdResults].sort((a, b) => {
    if (Math.abs(b.f1 - a.f1) > 1e-6) return b.f1 - a.f1;
    // Tie-break: prefer defaults
    const distA = Math.abs(a.sdrThreshold - B15_SDR_THRESHOLD)
      + Math.abs(a.psiThreshold - B15_PSI_THRESHOLD)
      + Math.abs(a.rwsThreshold - B15_RWS_THRESHOLD);
    const distB = Math.abs(b.sdrThreshold - B15_SDR_THRESHOLD)
      + Math.abs(b.psiThreshold - B15_PSI_THRESHOLD)
      + Math.abs(b.rwsThreshold - B15_RWS_THRESHOLD);
    return distA - distB;
  });

  return {
    sdr: sorted[0].sdrThreshold,
    psi: sorted[0].psiThreshold,
    rws: sorted[0].rwsThreshold,
  };
}

// ─── Decision rule ────────────────────────────────────────────────────────────

/**
 * Apply B15 signal decision rule.
 *
 * SIGNAL:        precision >= 0.70 AND recall >= 0.50 AND n >= 50
 *             OR F1 >= 0.60 AND n >= 50
 * INCONCLUSIVE:  0.40 <= precision < 0.70 OR 0.30 <= recall < 0.50
 * NO_SIGNAL:     precision < 0.40 AND recall < 0.30 AND n >= 50
 * PRELIMINARY:   n < 50
 */
export function applyB15DecisionRule(
  precision: number,
  recall: number,
  f1: number,
  n: number,
): "SIGNAL" | "INCONCLUSIVE" | "NO_SIGNAL" | "PRELIMINARY" {
  if (n < MIN_STRATEGIES_FOR_FULL_ANALYSIS) return "PRELIMINARY";

  if ((precision >= 0.70 && recall >= 0.50) || f1 >= 0.60) return "SIGNAL";
  if (precision >= 0.40 || recall >= 0.30) return "INCONCLUSIVE";
  return "NO_SIGNAL";
}

/**
 * Derive threshold recommendation from optimal vs default comparison.
 * If optimal F1 is substantially better than default F1, recommend change.
 */
export function deriveRecommendation(
  defaultF1: number,
  optimalF1: number,
  optimalSdr: number,
  optimalPsi: number,
  optimalRws: number,
  n: number,
): RobustnessAnalysisResult["recommendation"] {
  if (n < MIN_STRATEGIES_FOR_FULL_ANALYSIS) return "INSUFFICIENT_DATA";

  const improvement = optimalF1 - defaultF1;
  if (Math.abs(improvement) < 0.05) return "RETAIN_DEFAULTS";

  // Tightening = higher SDR floor, lower PSI/RWS caps (harder to pass)
  const isTighter =
    optimalSdr > B15_SDR_THRESHOLD ||
    optimalPsi < B15_PSI_THRESHOLD ||
    optimalRws < B15_RWS_THRESHOLD;

  return isTighter ? "TIGHTEN_GATES" : "RELAX_GATES";
}

// ─── Main evaluator ───────────────────────────────────────────────────────────

/**
 * Evaluate the B15 battery as a failure predictor.
 *
 * Pure function. Returns full analysis including confusion matrix, F1,
 * sensitivity sweep, optimal thresholds, and recommendation.
 */
export function evaluateRobustnessGateSignal(
  b15Results: BacktestRow[],
  outcomes: LifecycleOutcomeRow[],
): RobustnessAnalysisResult {
  const auditEntries: RobustnessAnalysisResult["auditEntries"] = [];

  if (b15Results.length === 0) {
    auditEntries.push({ level: "warn", message: "No B15 rows provided — analysis not possible" });
    return emptyAnalysis(0, 0, auditEntries);
  }

  // Build confusion matrix at institutional defaults
  const { tp, fp, tn, fn, unlinked } = buildConfusionMatrix(
    b15Results, outcomes,
    B15_SDR_THRESHOLD, B15_PSI_THRESHOLD, B15_RWS_THRESHOLD,
  );

  const linkedCount = b15Results.length - unlinked.length;

  if (unlinked.length > 0) {
    auditEntries.push({
      level: "info",
      message: `${unlinked.length} strategies have B15 results but no lifecycle outcome match — skipped in matrix`,
      data: { unlinked: unlinked.slice(0, 10) }, // first 10 only
    });
  }

  const precision = computePrecision({ tp, fp, tn, fn });
  const recall = computeRecall({ tp, fp, tn, fn });
  const f1 = computeF1(precision, recall);

  const n = linkedCount;

  const perThresholdResults = computeThresholdSensitivity(b15Results, outcomes);
  const { sdr: optimalSdr, psi: optimalPsi, rws: optimalRws } = selectOptimalThresholds(perThresholdResults);

  // Compute F1 at optimal thresholds
  const optimalRow = perThresholdResults.find(
    r =>
      Math.abs(r.sdrThreshold - optimalSdr) < 1e-9 &&
      Math.abs(r.psiThreshold - optimalPsi) < 1e-9 &&
      Math.abs(r.rwsThreshold - optimalRws) < 1e-9,
  );
  const optimalF1 = optimalRow?.f1 ?? f1;

  const verdict = applyB15DecisionRule(precision, recall, f1, n);
  const isPreliminary = n < MIN_STRATEGIES_FOR_FULL_ANALYSIS;

  const recommendation = deriveRecommendation(
    f1, optimalF1, optimalSdr, optimalPsi, optimalRws, n,
  );

  if (isPreliminary) {
    auditEntries.push({
      level: "warn",
      message: `PRELIMINARY: only ${n} strategies with matched outcomes (need ${MIN_STRATEGIES_FOR_FULL_ANALYSIS})`,
    });
  }

  return {
    totalB15Rows: b15Results.length,
    outcomeLinkedCount: linkedCount,
    confusion: { tp, fp, tn, fn },
    precision,
    recall,
    f1,
    perThresholdResults,
    optimalSdr,
    optimalPsi,
    optimalRws,
    recommendation,
    verdict,
    isPreliminary,
    unlinkedStrategyIds: unlinked,
    auditEntries,
  };
}

// ─── Markdown report builder ──────────────────────────────────────────────────

/**
 * Build Wave 27 Pass 2 B15 robustness signal test markdown report.
 * Pure function — no I/O. Caller decides whether to write to disk.
 */
export function buildRobustnessMarkdownReport(
  analysis: RobustnessAnalysisResult,
  isoDate: string,
): string {
  const {
    totalB15Rows,
    outcomeLinkedCount,
    confusion,
    precision,
    recall,
    f1,
    perThresholdResults,
    optimalSdr,
    optimalPsi,
    optimalRws,
    recommendation,
    verdict,
    isPreliminary,
  } = analysis;

  const lines: string[] = [];

  lines.push(`# Wave 27 Pass 2 — B15 Parameter Robustness Battery Signal Test`);
  lines.push(``);

  if (isPreliminary) {
    lines.push(`**PRELIMINARY — INSUFFICIENT SAMPLES (n=${outcomeLinkedCount} < ${MIN_STRATEGIES_FOR_FULL_ANALYSIS})**`);
    lines.push(`**Statistical conclusions below should not drive gate-wiring decisions.**`);
    lines.push(``);
  }

  lines.push(`**Date:** ${isoDate}`);
  lines.push(`**Backtests analyzed:** ${totalB15Rows}`);
  lines.push(`**Lifecycle outcomes linked:** ${outcomeLinkedCount}`);
  lines.push(`**Verdict:** ${verdict}`);
  lines.push(``);

  // Confusion matrix
  lines.push(`## B15 As Failure Predictor — Confusion Matrix`);
  lines.push(``);
  lines.push(`| | Failed (DECLINING/RETIRED/GRAVEYARD) | Succeeded (DEPLOYED stable) |`);
  lines.push(`|---|---|---|`);
  lines.push(`| B15 blocked | ${confusion.tp} (TP) | ${confusion.fp} (FP) |`);
  lines.push(`| B15 passed  | ${confusion.fn} (FN) | ${confusion.tn} (TN) |`);
  lines.push(``);
  lines.push(`- Precision = TP / (TP + FP) = ${precision.toFixed(4)}`);
  lines.push(`- Recall = TP / (TP + FN) = ${recall.toFixed(4)}`);
  lines.push(`- F1 = 2·P·R / (P+R) = ${f1.toFixed(4)}`);
  lines.push(``);

  // Per-threshold sensitivity (show a condensed table — one row per SDR variant, PSI/RWS at defaults)
  lines.push(`## Per-Threshold Sensitivity`);
  lines.push(``);
  lines.push(`| SDR | PSI | RWS | Blocked | Passed | Precision | Recall | F1 |`);
  lines.push(`|---|---|---|---|---|---|---|---|`);

  // Show 9 representative rows: vary one dimension at a time at defaults for others
  const representativeRows = perThresholdResults.filter(r => {
    const sdrIsDefault = Math.abs(r.sdrThreshold - B15_SDR_THRESHOLD) < 1e-9;
    const psiIsDefault = Math.abs(r.psiThreshold - B15_PSI_THRESHOLD) < 1e-9;
    const rwsIsDefault = Math.abs(r.rwsThreshold - B15_RWS_THRESHOLD) < 1e-9;
    // Include rows where exactly 0 or 1 dimension differs from default
    const diffCount = (sdrIsDefault ? 0 : 1) + (psiIsDefault ? 0 : 1) + (rwsIsDefault ? 0 : 1);
    return diffCount <= 1;
  });

  for (const r of representativeRows) {
    lines.push(
      `| ${r.sdrThreshold.toFixed(3)} | ${r.psiThreshold.toFixed(3)} | ${r.rwsThreshold.toFixed(3)}` +
      ` | ${r.blockedCount} | ${r.passedCount}` +
      ` | ${r.precision.toFixed(4)} | ${r.recall.toFixed(4)} | ${r.f1.toFixed(4)} |`
    );
  }
  lines.push(``);

  // Threshold optimization
  lines.push(`## SDR/PSI/RWS Threshold Optimization`);
  lines.push(``);
  lines.push(`- Current institutional defaults: SDR ≥ ${B15_SDR_THRESHOLD}, PSI ≤ ${B15_PSI_THRESHOLD}, RWS ≤ ${B15_RWS_THRESHOLD}`);
  lines.push(`- Optimal observed: SDR ≥ ${optimalSdr.toFixed(3)}, PSI ≤ ${optimalPsi.toFixed(3)}, RWS ≤ ${optimalRws.toFixed(3)}`);

  switch (recommendation) {
    case "RETAIN_DEFAULTS":
      lines.push(`- Recommendation: retain defaults — observed optimal within 5% F1 of institutional spec`);
      break;
    case "TIGHTEN_GATES":
      lines.push(`- Recommendation: suggest tightening — higher SDR floor and/or lower PSI/RWS caps improve precision by >5% F1`);
      break;
    case "RELAX_GATES":
      lines.push(`- Recommendation: suggest relaxing — lower SDR floor or higher PSI/RWS caps improve recall by >5% F1`);
      break;
    case "INSUFFICIENT_DATA":
      lines.push(`- Recommendation: insufficient data — need ${MIN_STRATEGIES_FOR_FULL_ANALYSIS}+ matched outcomes before threshold optimization`);
      break;
  }
  lines.push(``);

  // Decision rule
  lines.push(`## Decision Rule Applied`);
  lines.push(``);

  switch (verdict) {
    case "SIGNAL":
      lines.push(
        `**SIGNAL detected.** Precision ≥ 0.70 and Recall ≥ 0.50 (or F1 ≥ 0.60) on n=${outcomeLinkedCount} strategies. ` +
        `B15 battery has demonstrated predictive value as a forward-failure predictor. ` +
        `Current ${recommendation === "RETAIN_DEFAULTS" ? "default" : "adjusted"} thresholds apply.`
      );
      break;
    case "INCONCLUSIVE":
      lines.push(
        `**INCONCLUSIVE.** B15 shows partial predictive signal but precision/recall do not meet SIGNAL thresholds. ` +
        `Retain B15 as an advisory gate. Collect more lifecycle data before strengthening the gate.`
      );
      break;
    case "NO_SIGNAL":
      lines.push(
        `**NO SIGNAL.** B15 does not demonstrate predictive value on current lifecycle outcomes. ` +
        `Review B15 metric calibration. Document negative result. Do not rely on B15 alone for promotion decisions.`
      );
      break;
    case "PRELIMINARY":
      lines.push(
        `**PRELIMINARY.** n=${outcomeLinkedCount} matched outcomes < ${MIN_STRATEGIES_FOR_FULL_ANALYSIS} required. ` +
        `Do not draw conclusions. Re-run after more strategies complete full lifecycle.`
      );
      break;
  }
  lines.push(``);

  // Reproducibility
  lines.push(`## Reproducibility`);
  lines.push(``);
  lines.push(`- Source: backtests.b15_battery JSONB (Wave 25 Item 5, migration 0136)`);
  lines.push(`- Lifecycle join: lifecycle_transitions per strategy_id`);
  lines.push(`- Analysis date: ${isoDate}`);
  lines.push(`- Institutional thresholds: SDR ≥ ${B15_SDR_THRESHOLD}, PSI ≤ ${B15_PSI_THRESHOLD}, RWS ≤ ${B15_RWS_THRESHOLD}`);
  lines.push(`- Failure states: ${[...FAILURE_STATES].join(", ")}`);
  lines.push(`- Success states: ${[...SUCCESS_STATES].join(", ")}`);
  lines.push(``);

  return lines.join("\n");
}

// ─── Empty analysis fallback ──────────────────────────────────────────────────

function emptyAnalysis(
  totalB15Rows: number,
  outcomeLinkedCount: number,
  auditEntries: RobustnessAnalysisResult["auditEntries"],
): RobustnessAnalysisResult {
  return {
    totalB15Rows,
    outcomeLinkedCount,
    confusion: { tp: 0, fp: 0, tn: 0, fn: 0 },
    precision: 0,
    recall: 0,
    f1: 0,
    perThresholdResults: [],
    optimalSdr: B15_SDR_THRESHOLD,
    optimalPsi: B15_PSI_THRESHOLD,
    optimalRws: B15_RWS_THRESHOLD,
    recommendation: "INSUFFICIENT_DATA",
    verdict: "PRELIMINARY",
    isPreliminary: true,
    unlinkedStrategyIds: [],
    auditEntries,
  };
}
