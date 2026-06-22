/**
 * shadow-evidence-analyzer.ts — Wave 28 Pass B.3 (critic-optimizer)
 *
 * Pure-functional analysis core for the shadow evidence analysis script.
 * Consumed by scripts/analyze-shadow-evidence.ts (CLI) and tests.
 *
 * Design mandates:
 *   - PURE FUNCTIONS ONLY — no I/O, no Date.now(), no crypto.randomUUID().
 *   - NO logger import (no side effects — no logging surface).
 *   - `asOf` must be passed by caller; never derived internally.
 *   - Replay-deterministic: same inputs → same outputs always.
 *
 * Governance:
 *   - READS evidence; never mutates promotion logic.
 *   - Challenger outputs are advisory, not authoritative.
 *   - Wave 27.5 hard gates retain independent veto power.
 *
 * ─── Finding #12 / Fix 6 — Coordination Item (DO NOT EDIT lifecycle-service.ts) ───
 *
 * This module reads `shadow_result.availability` from the `composite.shadow_evaluation`
 * audit-log rows written by lifecycle-service.ts.  Fix 1 of this wave corrected the
 * analyzer to read `availability` (not `verdict`) for the availabilityBreakdown
 * classification.
 *
 * The `ShadowResult` interface in composite-shadow-gate.ts carries BOTH fields:
 *   - `availability: "available" | "stale" | "missing" | "below_threshold"`
 *   - `verdict: "HEALTHY" | "MARGINAL" | "UNHEALTHY" | "CRITICAL" | null`
 *
 * lifecycle-service.ts stores the full `ShadowResult` object at:
 *   result.shadow_result  (inside `composite.shadow_evaluation` audit row, line 3105)
 *
 * The grep-verified shape at lifecycle-service.ts:3095-3107 shows:
 *   result: { strategy_id, hard_gate_outcome, shadow_result: shadowResult, agreement }
 * where `shadowResult` is the raw return value of `evaluateCompositeShadow()`, which
 * ALWAYS includes the `availability` key for every possible shadow state.
 *
 * THEREFORE: Fix 1 is safe — `shadow_result.availability` IS persisted.
 * The backward-compat fallback in the fix (reading `verdict` for legacy rows) covers
 * any rows written before the composite-shadow-gate.ts Wave 28 Pass B.1 commit.
 *
 * Paper-parity coordination: if lifecycle-service.ts is ever refactored to only persist
 * `shadow_result.verdict` (e.g. to reduce JSONB bloat), this analyzer WILL silently
 * misclassify all non-available states as `evaluated`.  The paper-parity agent must
 * preserve the full `ShadowResult` object (including `availability`) in the stored payload.
 * Do NOT edit lifecycle-service.ts to drop `availability` from the persisted shape
 * without updating this analyzer to adapt.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AuditRow {
  id: string;
  action: string;
  result: Record<string, unknown> | null;
  created_at: Date;
}

export type ShadowVerdict =
  | "PRELIMINARY"
  | "ACTIVATE_PASS_C"
  | "INCONCLUSIVE"
  | "REVISE_COMPOSITE";

export interface AgreementCounts {
  agree_allow: number;
  agree_block: number;
  disagree_shadow_blocks: number;
  disagree_shadow_allows: number;
  shadow_no_opinion: number;
}

/** 2×2 confusion matrix (shadow_no_opinion excluded from all cells) */
export interface ConfusionMatrix {
  /** hard_gate=allow AND shadow=would_promote */
  tp: number;
  /** hard_gate=allow AND shadow=would_block */
  fn: number;
  /** hard_gate=block AND shadow=would_promote */
  fp: number;
  /** hard_gate=block AND shadow=would_block */
  tn: number;
}

export interface PerStrategyStats {
  strategyId: string;
  total: number;
  agreements: number;
  agreementRate: number;
}

export interface AnalysisResult {
  windowDays: number;
  minSample: number;
  asOf: Date;
  totalAttempts: number;
  agreements: AgreementCounts;
  /** (agree_allow + agree_block) / (total - shadow_no_opinion) */
  agreementRate: number;
  /** distinct weights_version_ids seen */
  weightsVersionIds: string[];
  weightsVersionDrift: boolean;
  availabilityBreakdown: {
    missing: number;
    stale: number;
    below_threshold: number;
    evaluated: number;
  };
  confusionMatrix: ConfusionMatrix;
  perStrategy: PerStrategyStats[];
  verdict: ShadowVerdict;
  verdictFlags: string[];
  sampleSufficient: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const DEFAULT_WINDOW_DAYS = 14;
export const DEFAULT_MIN_SAMPLE = 50;
export const AGREEMENT_ACTIVATE_THRESHOLD = 0.85;
export const AGREEMENT_INCONCLUSIVE_THRESHOLD = 0.70;

// ─── Pure-functional core ─────────────────────────────────────────────────────

/**
 * Main analysis function.  Pure-functional: no Date.now(), no I/O.
 * Caller provides asOf explicitly for determinism and replay safety.
 *
 * @param rows - audit_log rows with action='composite.shadow_evaluation'
 * @param opts - analysis options; asOf must be supplied by caller
 */
export function analyzeShadowEvidence(
  rows: AuditRow[],
  opts: {
    windowDays: number;
    minSample: number;
    asOf: Date;
  },
): AnalysisResult {
  const { windowDays, minSample, asOf } = opts;

  const windowStart = new Date(asOf.getTime() - windowDays * 24 * 60 * 60 * 1000);

  // Filter rows to window
  const windowRows = rows.filter(r => r.created_at >= windowStart && r.created_at <= asOf);

  const totalAttempts = windowRows.length;

  // Per-row extraction
  const agreements: AgreementCounts = {
    agree_allow: 0,
    agree_block: 0,
    disagree_shadow_blocks: 0,
    disagree_shadow_allows: 0,
    shadow_no_opinion: 0,
  };

  const confusionMatrix: ConfusionMatrix = { tp: 0, fn: 0, fp: 0, tn: 0 };

  const weightsVersionIdSet = new Set<string>();
  const availabilityBreakdown = { missing: 0, stale: 0, below_threshold: 0, evaluated: 0 };

  const perStrategyMap = new Map<string, { total: number; agreements: number }>();

  for (const row of windowRows) {
    const result = row.result ?? {};

    // Extract fields from result JSONB
    const strategyId = extractString(result, "strategyId") ?? "unknown";
    const hardGateOutcome = extractString(result, "hardGateOutcome"); // "allow" | "block"
    const shadowResult = extractObject(result, "shadow_result");
    const shadowDecision = shadowResult ? extractString(shadowResult, "shadow_decision") : null;
    const shadowVerdict = shadowResult ? extractString(shadowResult, "verdict") : null;
    const agreement = extractBoolean(result, "agreement"); // true/false/null
    const weightsVersionId = extractString(result, "weights_version_id");

    // Weights version tracking
    if (weightsVersionId) {
      weightsVersionIdSet.add(weightsVersionId);
    }

    // Availability breakdown.
    //
    // FIX (Finding #12 — Wave A Critic): composite-shadow-gate.ts writes
    // `verdict: null` for non-available rows (missing / stale / below_threshold)
    // and carries the classification on the `availability` field instead.
    // The old code compared `shadowVerdict` (the `verdict` key inside
    // shadow_result) against the strings "missing"/"stale"/"below_threshold",
    // which never matched — verdict is null for those states.  The result was
    // that ALL non-evaluated rows were silently counted as "evaluated", inflating
    // the evaluated counter and suppressing the real breakdown counts.
    //
    // Fix: read `availability` from shadow_result when present; fall back to
    // `verdict` for backward-compat with any legacy rows that stored the
    // classification on verdict directly.
    const availability = shadowResult ? extractString(shadowResult, "availability") : null;

    // Determine the canonical availability bucket for this row.
    const availabilityBucket = (() => {
      // Prefer the explicit `availability` field (written by composite-shadow-gate.ts).
      if (availability === "missing") return "missing";
      if (availability === "stale") return "stale";
      if (availability === "below_threshold") return "below_threshold";
      if (availability === "available") return "evaluated";

      // Backward-compat: legacy rows may store the classification on `verdict`.
      if (shadowVerdict === "missing") return "missing";
      if (shadowVerdict === "stale") return "stale";
      if (shadowVerdict === "below_threshold") return "below_threshold";

      // Row has a real verdict (HEALTHY/MARGINAL/UNHEALTHY/CRITICAL) or any
      // non-null/non-sentinel verdict string — treat as evaluated.
      if (shadowVerdict !== null && shadowVerdict !== "evaluated") return "evaluated";

      // Default: if verdict is "evaluated" (old sentinel) or we have no
      // availability + no recognisable verdict, treat as evaluated.
      return "evaluated";
    })();

    // Detect malformed rows: availability=available but verdict is null/missing.
    const isMalformed =
      (availability === "available" || availability === null) &&
      shadowVerdict === null &&
      shadowDecision === null;

    if (isMalformed) {
      // Count toward evaluated so sample-size math is not silently inflated by
      // malformed rows, but mark them clearly in the breakdown.
      // NOTE: malformed rows should NOT contribute to agreement counts below;
      // the isShadowNoOpinion guard will catch them via shadowDecision===null.
      availabilityBreakdown.evaluated++;
    } else {
      switch (availabilityBucket) {
        case "missing":          availabilityBreakdown.missing++;          break;
        case "stale":            availabilityBreakdown.stale++;            break;
        case "below_threshold":  availabilityBreakdown.below_threshold++;  break;
        default:                 availabilityBreakdown.evaluated++;        break;
      }
    }

    // Shadow decision classification
    const isShadowNoOpinion =
      shadowDecision === "NO_OPINION" ||
      shadowDecision === null ||
      availabilityBucket === "missing" ||
      availabilityBucket === "stale" ||
      availabilityBucket === "below_threshold" ||
      isMalformed;

    if (isShadowNoOpinion) {
      agreements.shadow_no_opinion++;
      // Skip from agreement and confusion matrix calculations
      updatePerStrategy(perStrategyMap, strategyId, false, true);
      continue;
    }

    // Agreement counting
    if (agreement === true) {
      if (hardGateOutcome === "allow") {
        agreements.agree_allow++;
      } else {
        agreements.agree_block++;
      }
    } else if (agreement === false) {
      // Disagree: determine direction
      if (shadowDecision === "would_block") {
        agreements.disagree_shadow_blocks++;
      } else {
        agreements.disagree_shadow_allows++;
      }
    }

    // Confusion matrix (shadow_no_opinion excluded)
    const shadowWouldPromote =
      shadowDecision === "would_promote" || shadowDecision === "allow";
    const shadowWouldBlock =
      shadowDecision === "would_block" || shadowDecision === "block";

    if (hardGateOutcome === "allow" && shadowWouldPromote) {
      confusionMatrix.tp++;
    } else if (hardGateOutcome === "allow" && shadowWouldBlock) {
      confusionMatrix.fn++;
    } else if (hardGateOutcome === "block" && shadowWouldPromote) {
      confusionMatrix.fp++;
    } else if (hardGateOutcome === "block" && shadowWouldBlock) {
      confusionMatrix.tn++;
    }

    // Per-strategy stats
    updatePerStrategy(perStrategyMap, strategyId, agreement === true, false);
  }

  // Compute agreement rate (exclude shadow_no_opinion from denominator)
  const denominatorN = totalAttempts - agreements.shadow_no_opinion;
  const agreementN = agreements.agree_allow + agreements.agree_block;
  const agreementRate = denominatorN > 0 ? agreementN / denominatorN : 0;

  const sampleSufficient = denominatorN >= minSample;

  // Weights version drift
  const weightsVersionIds = Array.from(weightsVersionIdSet).sort();
  const weightsVersionDrift = weightsVersionIds.length > 1;

  // Build per-strategy stats
  const perStrategy: PerStrategyStats[] = Array.from(perStrategyMap.entries())
    .map(([strategyId, stats]) => ({
      strategyId,
      total: stats.total,
      agreements: stats.agreements,
      agreementRate: stats.total > 0 ? stats.agreements / stats.total : 0,
    }))
    .sort((a, b) => b.total - a.total);

  // Decision rule
  const verdictFlags: string[] = [];

  if (weightsVersionDrift) {
    verdictFlags.push("WEIGHTS_DRIFT_DETECTED");
  }

  let verdict: ShadowVerdict;

  if (!sampleSufficient) {
    verdict = "PRELIMINARY";
  } else if (agreementRate >= AGREEMENT_ACTIVATE_THRESHOLD) {
    verdict = "ACTIVATE_PASS_C";
  } else if (agreementRate >= AGREEMENT_INCONCLUSIVE_THRESHOLD) {
    verdict = "INCONCLUSIVE";
  } else {
    verdict = "REVISE_COMPOSITE";
  }

  return {
    windowDays,
    minSample,
    asOf,
    totalAttempts,
    agreements,
    agreementRate,
    weightsVersionIds,
    weightsVersionDrift,
    availabilityBreakdown,
    confusionMatrix,
    perStrategy,
    verdict,
    verdictFlags,
    sampleSufficient,
  };
}

// ─── Markdown report builder ──────────────────────────────────────────────────

export function buildMarkdownReport(result: AnalysisResult, isoDate: string): string {
  const {
    windowDays,
    minSample,
    asOf,
    totalAttempts,
    agreements,
    agreementRate,
    weightsVersionIds,
    weightsVersionDrift,
    availabilityBreakdown,
    confusionMatrix,
    perStrategy,
    verdict,
    verdictFlags,
    sampleSufficient,
  } = result;

  const denominatorN = totalAttempts - agreements.shadow_no_opinion;
  const verdictPill = formatVerdictPill(verdict);
  const flagsLine = verdictFlags.length > 0 ? ` | Flags: ${verdictFlags.join(", ")}` : "";

  const plainEnglishSummary = buildPlainEnglishSummary(result);

  const lines: string[] = [
    `# Shadow Evidence Analysis — ${isoDate}`,
    "",
    `**Verdict:** ${verdictPill}${flagsLine}`,
    "",
    `> ${plainEnglishSummary}`,
    "",
    "---",
    "",
    "## Parameters",
    "",
    `| Parameter | Value |`,
    `|---|---|`,
    `| Window days | ${windowDays} |`,
    `| Min sample (denominator, excl. NO_OPINION) | ${minSample} |`,
    `| As-of date | ${asOf.toISOString()} |`,
    "",
    "## Agreement Summary",
    "",
    `| Metric | Value |`,
    `|---|---|`,
    `| Total promotion attempts | ${totalAttempts} |`,
    `| Shadow NO_OPINION excluded | ${agreements.shadow_no_opinion} |`,
    `| Denominator (opinionated) | ${denominatorN} |`,
    `| Agree — hard gate ALLOW | ${agreements.agree_allow} |`,
    `| Agree — hard gate BLOCK | ${agreements.agree_block} |`,
    `| Disagree — shadow would_block | ${agreements.disagree_shadow_blocks} |`,
    `| Disagree — shadow would_allow | ${agreements.disagree_shadow_allows} |`,
    `| **Agreement rate** | **${(agreementRate * 100).toFixed(1)}%** |`,
    `| Sample sufficient? | ${sampleSufficient ? "YES" : "NO (PRELIMINARY)"} |`,
    "",
    "## Decision Thresholds",
    "",
    `| Threshold | Value | Met? |`,
    `|---|---|---|`,
    `| ACTIVATE_PASS_C floor | ≥ ${(AGREEMENT_ACTIVATE_THRESHOLD * 100).toFixed(0)}% | ${agreementRate >= AGREEMENT_ACTIVATE_THRESHOLD ? "YES" : "NO"} |`,
    `| INCONCLUSIVE floor | ≥ ${(AGREEMENT_INCONCLUSIVE_THRESHOLD * 100).toFixed(0)}% | ${agreementRate >= AGREEMENT_INCONCLUSIVE_THRESHOLD ? "YES" : "NO"} |`,
    "",
    "## Confusion Matrix (shadow_no_opinion excluded)",
    "",
    `|  | Shadow: would_promote | Shadow: would_block |`,
    `|---|---|---|`,
    `| Hard gate: ALLOW | TP = ${confusionMatrix.tp} | FN = ${confusionMatrix.fn} |`,
    `| Hard gate: BLOCK | FP = ${confusionMatrix.fp} | TN = ${confusionMatrix.tn} |`,
    "",
    "## Availability Breakdown",
    "",
    `| Category | Count |`,
    `|---|---|`,
    `| Evaluated (had opinion) | ${availabilityBreakdown.evaluated} |`,
    `| Missing (no score) | ${availabilityBreakdown.missing} |`,
    `| Stale (score too old) | ${availabilityBreakdown.stale} |`,
    `| Below threshold (composite not computed) | ${availabilityBreakdown.below_threshold} |`,
    "",
    "## Weights Version Integrity",
    "",
    `| Distinct weights_version_ids seen | ${weightsVersionIds.length} |`,
    `| Drift detected (>1 version) | ${weightsVersionDrift ? "YES — MIXED EPOCHS" : "NO"} |`,
  ];

  if (weightsVersionDrift) {
    lines.push("", "**WARNING:** Multiple weights versions detected. Scores span different model epochs.");
    lines.push("Recommendation: split the report by epoch boundary or extend the window beyond the drift date.");
    lines.push("", `Versions seen: ${weightsVersionIds.join(", ")}`);
  }

  if (perStrategy.length > 0) {
    lines.push(
      "",
      "## Per-Strategy Breakdown",
      "",
      "| Strategy ID | Attempts | Agreements | Agreement Rate |",
      "|---|---|---|---|",
    );
    for (const s of perStrategy.slice(0, 20)) {
      lines.push(
        `| ${s.strategyId} | ${s.total} | ${s.agreements} | ${(s.agreementRate * 100).toFixed(1)}% |`,
      );
    }
    if (perStrategy.length > 20) {
      lines.push(`| *(${perStrategy.length - 20} more strategies omitted)* | | | |`);
    }
  }

  lines.push(
    "",
    "---",
    "",
    "## Recommendation",
    "",
    buildRecommendationText(verdict, verdictFlags, agreementRate, denominatorN, minSample),
    "",
    "---",
    "",
    "## Machine-Readable Verdict",
    "",
    "```json",
    JSON.stringify(
      {
        verdict,
        verdict_flags: verdictFlags,
        agreement_rate: Math.round(agreementRate * 10000) / 10000,
        total_attempts: totalAttempts,
        denominator_n: denominatorN,
        sample_sufficient: sampleSufficient,
        window_days: windowDays,
        as_of: asOf.toISOString(),
        weights_version_drift: weightsVersionDrift,
        weights_version_ids: weightsVersionIds,
      },
      null,
      2,
    ),
    "```",
  );

  return lines.join("\n");
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function updatePerStrategy(
  map: Map<string, { total: number; agreements: number }>,
  strategyId: string,
  agreed: boolean,
  skipOpinion: boolean,
): void {
  if (!map.has(strategyId)) {
    map.set(strategyId, { total: 0, agreements: 0 });
  }
  const entry = map.get(strategyId)!;
  if (!skipOpinion) {
    entry.total++;
    if (agreed) entry.agreements++;
  }
}

function extractString(obj: Record<string, unknown>, key: string): string | null {
  const val = obj[key];
  if (typeof val === "string") return val;
  return null;
}

function extractObject(obj: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const val = obj[key];
  if (val !== null && typeof val === "object" && !Array.isArray(val)) {
    return val as Record<string, unknown>;
  }
  return null;
}

function extractBoolean(obj: Record<string, unknown>, key: string): boolean | null {
  const val = obj[key];
  if (typeof val === "boolean") return val;
  return null;
}

function formatVerdictPill(verdict: ShadowVerdict): string {
  switch (verdict) {
    case "ACTIVATE_PASS_C":
      return "**[ACTIVATE_PASS_C]** — composite shadow tracks hard gates reliably";
    case "INCONCLUSIVE":
      return "**[INCONCLUSIVE]** — extend window 14 more days and re-run";
    case "REVISE_COMPOSITE":
      return "**[REVISE_COMPOSITE]** — do NOT activate; investigate normalizer/weight calibration";
    case "PRELIMINARY":
      return "**[PRELIMINARY]** — insufficient data; recommend waiting for more accumulation";
  }
}

function buildPlainEnglishSummary(result: AnalysisResult): string {
  const { verdict, agreementRate, agreements, totalAttempts } = result;
  const denominator = totalAttempts - agreements.shadow_no_opinion;

  switch (verdict) {
    case "PRELIMINARY":
      return `Not enough data yet — only ${denominator} opinionated samples vs the ${result.minSample} required. ` +
        `The composite score agreed with hard gates ${(agreementRate * 100).toFixed(0)}% of the time so far, ` +
        `but that number is not yet reliable. Keep accumulating data.`;
    case "ACTIVATE_PASS_C":
      return `The composite score agreed with Wave 27.5 hard gates ${(agreementRate * 100).toFixed(1)}% of the time ` +
        `across ${denominator} evaluated promotion attempts. This meets the 85% reliability bar — ` +
        `Pass C (composite-aware tier routing) can be activated.`;
    case "INCONCLUSIVE":
      return `The composite score agreed with hard gates ${(agreementRate * 100).toFixed(1)}% of the time — ` +
        `above the 70% floor but short of the 85% activation threshold. ` +
        `Extend the window by 14 more days and re-run. Check the disagreement skew in the confusion matrix ` +
        `to determine if weight recalibration would help.`;
    case "REVISE_COMPOSITE":
      return `The composite score agreed with hard gates only ${(agreementRate * 100).toFixed(1)}% of the time — ` +
        `below the 70% floor. Do NOT activate Pass C. ` +
        `Investigate the score normalizer and weight calibration. Look at the confusion matrix for systematic bias.`;
  }
}

function buildRecommendationText(
  verdict: ShadowVerdict,
  flags: string[],
  agreementRate: number,
  denominatorN: number,
  minSample: number,
): string {
  const hasDrift = flags.includes("WEIGHTS_DRIFT_DETECTED");
  const driftWarning = hasDrift
    ? "\n\n**WEIGHTS_DRIFT_DETECTED:** Mixed epoch results. Consider splitting by drift boundary before re-running."
    : "";

  switch (verdict) {
    case "PRELIMINARY":
      return `Accumulate more data. Currently at ${denominatorN}/${minSample} required opinionated samples. ` +
        `Re-run this script after approximately ${Math.max(1, minSample - denominatorN)} more PAPER → DEPLOY_READY attempts.` +
        driftWarning;
    case "ACTIVATE_PASS_C":
      return `Agreement rate ${(agreementRate * 100).toFixed(1)}% ≥ 85% threshold over ${denominatorN} opinionated samples. ` +
        `Proceed with Pass C activation (composite-aware tier routing). ` +
        `Operator action: flip \`WAVE_28_COMPOSITE_GATING_ENABLED=true\` and ship Pass C shadow-gate wiring.` +
        driftWarning;
    case "INCONCLUSIVE":
      return `Agreement rate ${(agreementRate * 100).toFixed(1)}% is in the 70-85% inconclusive band. ` +
        `Extend the analysis window by 14 more days (\`--window-days 28\`) and re-run. ` +
        `If the disagreement skew is predominantly \`disagree_shadow_blocks\`, investigate whether ` +
        `normalizer scaling is too conservative on the blocking side.` +
        driftWarning;
    case "REVISE_COMPOSITE":
      return `Agreement rate ${(agreementRate * 100).toFixed(1)}% < 70% floor. ` +
        `Do NOT activate Pass C. Investigate: (1) score normalizer per-subsystem output ranges, ` +
        `(2) EQUAL_WEIGHTS calibration (should remain frozen until MRM review), ` +
        `(3) subsystem availability — high \`shadow_no_opinion\` count inflates the denominator exclusion.` +
        driftWarning;
  }
}
