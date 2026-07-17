/**
 * Wave 27 Pass 3.G1 — Consistency Gate Payout-Denial Prediction Library
 *
 * Pure-function library for the consistency-tracker replay-grading harness.
 * Answers: would the 40% warn + 50% block thresholds have ACTUALLY prevented
 * payout denials on historical Topstep accounts?
 *
 * Statistical methodology:
 *   - Confusion matrix: gate-fired vs payout-denied (proxy) in the subsequent
 *     14-day window
 *   - Precision/Recall/F1 of the consistency gate as a payout-denial predictor
 *   - Single-threshold sensitivity sweep: vary the ONE threshold the gate
 *     predictor actually fires on (see STRUCTURAL LIMITATION below for why
 *     this is a 1D sweep, not the 5×5 warn×block grid this lane shipped with
 *     originally)
 *
 * ── STRUCTURAL LIMITATION (deep-scan Replay-F1, 2026-07-17) ──────────────────
 * Two honesty fixes landed here after an adversarial finding:
 *
 * (1) DEAD PARAMETER (fixed): `gateFiresAtThreshold` used to take a `blockPct`
 *     argument it never referenced, so the old 5×5 (warn × block) threshold
 *     sweep produced byte-identical confusion matrices for every row sharing
 *     the same warn value — the "optimal block threshold" the report used to
 *     recommend was noise. There is no honest way to make block a distinct
 *     prediction level here: the ground-truth label (below) is binary, so a
 *     second "block-band vs warn-band" axis has nothing independent to
 *     predict against. Fixed by dropping the fabricated parameter and
 *     collapsing to the single threshold this lane actually grades.
 *
 * (2) CIRCULAR GROUND TRUTH (structural, NOT fixable by more data): the
 *     ground-truth label this lane evaluates against
 *     (scripts/replay-grade-consistency.ts::inferPayoutDenied) is proxied as
 *     `concentrationPct >= DEFAULT_BLOCK_THRESHOLD_PCT` (50%) because real
 *     Topstep payout-denial outcomes are not stored anywhere in this DB. The
 *     predictor (`gateFiresAtThreshold`) fires at `concentrationPct >=
 *     DEFAULT_WARN_THRESHOLD_PCT` (40%) — a STRICTLY LOWER threshold on the
 *     SAME underlying feature. Since 50% implies 40%, every truth-positive
 *     observation is mathematically ALSO a predictor-positive observation:
 *     FN is always 0, so recall can only ever be exactly 0 (zero denials
 *     observed) or exactly 1.0 (any denials observed) — never a real
 *     in-between value reflecting actual predictive skill. Precision here
 *     measures how much the two concentration thresholds' populations
 *     overlap, NOT whether the gate predicts a real independent outcome.
 *     This is a permanent structural fact of the proxy design, NOT a
 *     sample-size problem — n=1,000,000 observations would not fix it.
 *     Until a real, independent Topstep payout-denial outcome label exists,
 *     `applyConsistencyDecisionRule` is capped at INCONCLUSIVE (or
 *     PRELIMINARY below the sample floor) — it can never honestly emit
 *     SIGNAL or NO_SIGNAL. See `GROUND_TRUTH_LABEL_STRUCTURALLY_CIRCULAR`.
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
 * Single-axis sweep over the ONE threshold the predictor fires on — see the
 * module doc comment's "DEAD PARAMETER" note for why this is 1D, not 5×5.
 * Range spans the union of the lane's original warn (35-45) and block
 * (45-55) bounds so the descriptive sensitivity table still covers the same
 * concentration-percentage territory operators are used to seeing.
 */
export const THRESHOLD_STEP_PCT = 2.5;

export const THRESHOLD_SWEEP_VALUES = [35, 37.5, 40, 42.5, 45, 47.5, 50, 52.5, 55] as const;

/**
 * Structural fact of the current proxy design (see module doc comment,
 * "CIRCULAR GROUND TRUTH") — always true until the ground-truth label in
 * scripts/replay-grade-consistency.ts::inferPayoutDenied is replaced with a
 * real, independent Topstep payout-denial outcome. NOT a runtime measurement;
 * exported so callers/tests can assert the honesty cap is wired up.
 */
export const GROUND_TRUTH_LABEL_STRUCTURALLY_CIRCULAR = true;

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
 * Result for one threshold in the single-axis sensitivity sweep.
 * (Was a warn×block 5×5 grid pre-Replay-F1 fix — see module doc comment.
 * `blockThresholdPct` was removed, not renamed: there is no honest second
 * axis to report against a binary ground-truth label.)
 */
export interface ThresholdSweepResult {
  thresholdPct: number;
  /** Count of observations where gate fired at this threshold */
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

  /** Confusion matrix at the default threshold (warn=40%) */
  confusion: ConsistencyConfusionMatrix;
  precision: number;
  recall: number;
  f1: number;

  /**
   * Single-axis threshold sensitivity table (descriptive — how the
   * concentration distribution overlaps the ground-truth proxy at nearby
   * thresholds). NOT an "optimal threshold" search — see
   * groundTruthLabelCircular for why no threshold here can be honestly
   * called "optimal" against this proxy label.
   */
  thresholdSweep: ThresholdSweepResult[];

  /**
   * Always true (see GROUND_TRUTH_LABEL_STRUCTURALLY_CIRCULAR module doc
   * comment). Surfaced on the result object so downstream report/dashboard
   * consumers can render the caveat without re-deriving it themselves.
   */
  groundTruthLabelCircular: boolean;

  /** Verdict — capped at INCONCLUSIVE/PRELIMINARY while groundTruthLabelCircular is true */
  verdict: ConsistencyVerdict;
  isPreliminary: boolean;

  /** Audit entries */
  auditEntries: Array<{ level: "info" | "warn"; message: string; data?: unknown }>;
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Determine if an observation's gate "fired" at the given threshold.
 * Gate fires when concentrationPct >= thresholdPct.
 *
 * deep-scan Replay-F1 (2026-07-17): this function used to also accept a
 * `blockPct` argument it never referenced (a dead parameter — see module doc
 * comment). There is no honest second prediction level to model here: the
 * ground-truth proxy is binary, so a "block-band vs warn-band" distinction
 * has nothing independent to predict against. Dropped the parameter instead
 * of faking a use for it.
 *
 * When falsePositiveSuspected is true, the gate was downgraded to WARN;
 * we still count it as fired (conservative — the gate DID signal something).
 */
export function gateFiresAtThreshold(
  obs: DayAccountState,
  thresholdPct: number,
): boolean {
  return obs.concentrationPct >= thresholdPct;
}

/**
 * Build confusion matrix from observations at the given threshold.
 * Observations with payoutDenied === null are skipped.
 */
export function buildConsistencyMatrix(
  observations: DayAccountState[],
  thresholdPct: number = DEFAULT_WARN_THRESHOLD_PCT,
): ConsistencyConfusionMatrix & { skipped: number } {
  let tp = 0, fp = 0, tn = 0, fn = 0, skipped = 0;

  for (const obs of observations) {
    if (obs.payoutDenied === null) {
      skipped++;
      continue;
    }

    const fired = gateFiresAtThreshold(obs, thresholdPct);
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
 * Run the single-axis threshold sensitivity table over THRESHOLD_SWEEP_VALUES.
 *
 * deep-scan Replay-F1 (2026-07-17): this used to be a warn×block 5×5 grid
 * (25 rows) where varying `blockPct` never changed the result — every row
 * sharing a warn value was byte-identical (dead parameter). Collapsed to the
 * single threshold the predictor actually fires on. This table is
 * DESCRIPTIVE ONLY (how the concentration distribution shifts near the
 * default threshold) — it is not, and must never be presented as, an
 * "optimal threshold" search; see GROUND_TRUTH_LABEL_STRUCTURALLY_CIRCULAR.
 * `selectOptimalThresholds()` was removed rather than adapted to 1D — no
 * threshold selected against this proxy label is honestly "optimal."
 */
export function computeThresholdSensitivity(
  observations: DayAccountState[],
): ThresholdSweepResult[] {
  const results: ThresholdSweepResult[] = [];

  for (const thresholdPct of THRESHOLD_SWEEP_VALUES) {
    const { tp, fp, tn, fn } = buildConsistencyMatrix(observations, thresholdPct);

    const gatedCount = tp + fp;
    const passedCount = tn + fn;
    const precision = computePrecision({ tp, fp, tn, fn });
    const recall = computeRecall({ tp, fp, tn, fn });
    const f1 = computeF1(precision, recall);

    results.push({
      thresholdPct,
      gatedCount,
      passedCount,
      confusion: { tp, fp, tn, fn },
      precision,
      recall,
      f1,
    });
  }

  return results;
}

// ─── Decision rule ────────────────────────────────────────────────────────────

/**
 * Apply Wave 27 Pass 3 consistency gate decision rule.
 *
 * PRELIMINARY:   n < 50
 * INCONCLUSIVE:  n >= 50 (STRUCTURAL CAP — see below)
 *
 * deep-scan Replay-F1 (2026-07-17): this rule USED TO be a normal
 * precision/recall/F1 threshold ladder (SIGNAL when precision>=0.65 AND
 * recall>=0.50, etc.) exactly like the other 6 replay lanes. That is no
 * longer honest for THIS lane specifically: recall here is mathematically
 * forced to exactly 0 or 1 by the ground-truth proxy's construction (see
 * GROUND_TRUTH_LABEL_STRUCTURALLY_CIRCULAR / the module doc comment) — it
 * never reflects real predictive skill, so a rule that keys off recall (or
 * F1, which is recall-dependent) would launder a mathematical artifact into
 * an apparent "SIGNAL detected, wire this gate into production" claim.
 *
 * The verdict is therefore capped at INCONCLUSIVE for any sample large
 * enough to leave PRELIMINARY — this lane can NEVER emit SIGNAL or NO_SIGNAL
 * until scripts/replay-grade-consistency.ts::inferPayoutDenied is replaced
 * with a real, independent Topstep payout-denial outcome (not a proxy
 * derived from the same concentrationPct feature the gate predicts on).
 * precision/recall/f1/n are kept as parameters (rather than deleted) so the
 * function signature stays stable for callers and so a future fix that
 * replaces the ground-truth proxy can re-enable the full ladder without an
 * API break — they are intentionally NOT used to select SIGNAL/NO_SIGNAL
 * while the cap is active.
 */
export function applyConsistencyDecisionRule(
  _precision: number,
  _recall: number,
  _f1: number,
  n: number,
): ConsistencyVerdict {
  if (n < MIN_OBSERVATIONS_FOR_FULL_ANALYSIS) return "PRELIMINARY";
  return "INCONCLUSIVE";
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

  // Default threshold matrix (single threshold — see module doc comment for
  // why there is no separate block-threshold matrix here anymore).
  const defaultMatrix = buildConsistencyMatrix(enriched, DEFAULT_WARN_THRESHOLD_PCT);
  const precision = computePrecision(defaultMatrix);
  const recall = computeRecall(defaultMatrix);
  const f1 = computeF1(precision, recall);

  const n = withOutcome.length;

  // Descriptive single-axis sensitivity table (NOT an optimal-threshold search).
  const sweep = computeThresholdSensitivity(enriched);

  const verdict = applyConsistencyDecisionRule(precision, recall, f1, n);
  const isPreliminary = n < MIN_OBSERVATIONS_FOR_FULL_ANALYSIS;

  if (isPreliminary) {
    auditEntries.push({
      level: "warn",
      message: `PRELIMINARY: only ${n} observations with outcome (need ${MIN_OBSERVATIONS_FOR_FULL_ANALYSIS})`,
    });
  } else {
    auditEntries.push({
      level: "warn",
      message:
        "INCONCLUSIVE (structural cap): the ground-truth payout-denial label is a proxy " +
        "derived from the SAME concentrationPct feature the gate predicts on " +
        "(concentrationPct >= 50% vs the gate's >= 40%), so recall is definitionally 0 or " +
        "1 and cannot reflect real predictive skill. This verdict cannot become SIGNAL or " +
        "NO_SIGNAL until a real, independent Topstep payout-denial outcome exists in the DB.",
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
    groundTruthLabelCircular: GROUND_TRUTH_LABEL_STRUCTURALLY_CIRCULAR,
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
  } else if (result.groundTruthLabelCircular) {
    lines.push(
      `**INCONCLUSIVE — STRUCTURALLY NON-INFORMATIVE GROUND TRUTH.** ` +
        `The payout-denial label this lane grades against is a proxy derived from the SAME ` +
        `\`concentrationPct\` feature the gate predicts on (label fires at ≥${DEFAULT_BLOCK_THRESHOLD_PCT}%, ` +
        `predictor fires at ≥${DEFAULT_WARN_THRESHOLD_PCT}%) — every label-positive is mathematically ` +
        `also a predictor-positive, so Recall is definitionally 0 or 1 and never reflects real ` +
        `predictive skill. Precision below measures how much the two thresholds' concentration ` +
        `populations overlap, NOT whether the gate predicts a real independent outcome. ` +
        `**This is a permanent structural fact, not a sample-size problem — this lane cannot ` +
        `honestly emit SIGNAL or NO_SIGNAL until a real, independent Topstep payout-denial ` +
        `outcome label exists in the DB.**`,
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
  lines.push(`- Recall = TP / (TP + FN) = ${result.recall.toFixed(4)} (definitionally 0 or 1 — see caveat above)`);
  lines.push(`- F1 = 2·P·R / (P+R) = ${result.f1.toFixed(4)}`);
  lines.push(``);

  // Threshold sensitivity — descriptive only, NOT an optimal-threshold search.
  lines.push(`## Threshold Sensitivity Table (single-axis, descriptive only)`);
  lines.push(``);
  lines.push(
    `Shows how the confusion matrix shifts as the ONE threshold this lane grades ` +
      `(concentrationPct) moves near the default. This is NOT a recommendation engine — ` +
      `see the ground-truth caveat above for why no threshold here can be called "optimal."`,
  );
  lines.push(``);
  lines.push(`| Threshold% | Gated | Passed | Precision | Recall | F1 |`);
  lines.push(`|---|---|---|---|---|---|`);

  for (const r of result.thresholdSweep) {
    const isDefault = Math.abs(r.thresholdPct - DEFAULT_WARN_THRESHOLD_PCT) < 0.01;
    lines.push(
      `| ${r.thresholdPct.toFixed(1)}%` +
        ` | ${r.gatedCount} | ${r.passedCount}` +
        ` | ${r.precision.toFixed(4)} | ${r.recall.toFixed(4)} | ${r.f1.toFixed(4)}` +
        `${isDefault ? " ← default" : ""} |`,
    );
  }
  lines.push(``);

  // Decision rule
  lines.push(`## Decision Rule Applied`);
  lines.push(``);

  switch (result.verdict) {
    case "SIGNAL":
    case "NO_SIGNAL":
      // Structurally unreachable while groundTruthLabelCircular is true — see
      // applyConsistencyDecisionRule. Kept as an exhaustive switch case so a
      // future ground-truth fix that re-enables these branches doesn't need
      // to touch this switch statement, only the decision-rule function.
      lines.push(
        `**${result.verdict}.** Unexpected — this verdict should be structurally unreachable ` +
          `while the ground-truth label remains circular. Investigate applyConsistencyDecisionRule().`,
      );
      break;
    case "INCONCLUSIVE":
      lines.push(
        `**INCONCLUSIVE (structural cap).** The ground-truth payout-denial label is a proxy ` +
          `derived from the same feature the gate predicts on, so Recall is definitionally 0 or 1 ` +
          `and this lane cannot honestly claim predictive validity either way. ` +
          `Retain the consistency gate as advisory only. Do NOT wire shouldBlockNewEntry() into a ` +
          `hard block on the strength of this report. Re-evaluate only after a real, independent ` +
          `Topstep payout-denial outcome label exists.`,
      );
      break;
    case "PRELIMINARY":
      lines.push(
        `**PRELIMINARY.** n=${result.observationsWithOutcome} < ${MIN_OBSERVATIONS_FOR_FULL_ANALYSIS} observations with known outcome. ` +
          `Cannot draw conclusions. Re-run after more payout cycle data is available. ` +
          `(Note: even with n ≥ ${MIN_OBSERVATIONS_FOR_FULL_ANALYSIS}, the verdict is capped at INCONCLUSIVE — see above.)`,
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
    `- Sweep grid (single-axis, descriptive only): ${THRESHOLD_SWEEP_VALUES.join("/")}%`,
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
    groundTruthLabelCircular: GROUND_TRUTH_LABEL_STRUCTURALLY_CIRCULAR,
    verdict: "PRELIMINARY",
    isPreliminary: true,
    auditEntries,
  };
}
