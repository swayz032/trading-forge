/**
 * score-normalization.ts — Wave 28 Pass A.3 (critic-optimizer)
 *
 * Pure-function scoring library for the deep-analysis-pipeline composite
 * health score.  Consumed by the A.2 aggregator.
 *
 * Design mandates (OCC/Fed/FDIC April 2026 MRM):
 *   - PURE FUNCTIONS ONLY — no I/O, no Date.now(), no crypto.randomUUID().
 *     This library is replay-deterministic; every score is a function of its inputs.
 *   - EQUAL-WEIGHT default is FROZEN.  Any weight change is a model-change event
 *     requiring full validation.  Weights MUST NOT be mutated at runtime.
 *   - NO adaptive calibration.  If a future PR proposes weight learning it must
 *     go through a separate model-change pipeline; this lib has no learning surface.
 *   - All threshold constants MUST be exported; no magic numbers inline.
 *
 * Import logger from ./logger.js (not ../index.js) per CLAUDE.md feedback rule.
 * (This file is pure-functional with no logging surface — no logger import needed.)
 *
 * SHA-256 canonical-sorted-JSON pattern mirrors firm-rules-version.ts exactly.
 */

import { createHash } from "node:crypto";

// ─── Type exports ─────────────────────────────────────────────────────────────

/** All 13 subsystem names (12 original + rl_agent added in Wave 29 Pass C.3). */
export type SubsystemName =
  | "b14_survival_twin"
  | "wfe"
  | "parameter_drift"
  | "b15_robustness"
  | "compliance"
  | "trade_critique"
  | "pattern_aggregator"
  | "consistency_tracker"
  | "deepar"
  | "black_swan"
  | "nemo"
  | "quantum_replay"
  | "rl_agent";

/** Per-subsystem score: null means subsystem is unavailable for this cycle. */
export type SubsystemScores = Record<SubsystemName, number | null>;

export interface CompositeResult {
  /** Composite score ∈ [0, 1], or null when < MIN_AVAILABLE_FOR_COMPOSITE subsystems available. */
  score: number | null;
  /** Number of subsystems that contributed a non-null score. */
  availableCount: number;
  /** Sum of weights for the contributing subsystems (renormalized denominator). */
  availableWeightSum: number;
  /** Verdict derived from the composite score. */
  verdict: VerdictLabel | null;
  /** SHA-256 hex of the weight map used — for audit lineage. */
  weightsVersionId: string;
}

export type VerdictLabel = "HEALTHY" | "MARGINAL" | "UNHEALTHY" | "CRITICAL";

// ─── Threshold constants (HARD — export all, no magic numbers inline) ─────────

/**
 * Minimum number of subsystems that must have non-null scores for
 * computeComposite() to return a value.  Fewer than this → null (skip-write).
 */
export const MIN_AVAILABLE_FOR_COMPOSITE = 8;

/** Score at or above this → HEALTHY. */
export const VERDICT_HEALTHY_THRESHOLD = 0.75;

/** Score at or above this (and below HEALTHY) → MARGINAL. */
export const VERDICT_MARGINAL_THRESHOLD = 0.50;

/** Score at or above this (and below MARGINAL) → UNHEALTHY. */
export const VERDICT_UNHEALTHY_THRESHOLD = 0.25;

// B14 normalizer constants
/** B14 ci_high domain: ∈ [0, 1].  Inverted so lower ruin = healthier score. */
export const B14_CI_HIGH_DOMAIN_MAX = 1.0;

// WFE normalizer constants
/** WFE clip ceiling before normalization (wfe_overall scale is [0, ~2]). */
export const WFE_CLIP_MAX = 1.5;

// B15 normalizer constants
/** PSI scale factor: PSI is multiplied by this before subtraction from 1. */
export const B15_PSI_SCALE = 20;
/** RWS scale factor: RWS is multiplied by this before subtraction from 1. */
export const B15_RWS_SCALE = 5;

// DeepAR normalizer constants
/** Default forecast error threshold for DeepAR normalization. */
export const DEEPAR_DEFAULT_THRESHOLD = 1.0;

// Consistency Tracker normalizer constants
/** Consistency pct at or below this → score 1.0. */
export const CONSISTENCY_LOWER_BOUND = 0.40;
/** Consistency pct at or above this → score 0.0. */
export const CONSISTENCY_UPPER_BOUND = 0.50;

// ─── EQUAL_WEIGHTS — frozen, version-hashed ───────────────────────────────────

/**
 * OCC/Fed/FDIC April 2026 MRM: equal-weight across all 13 subsystems.
 * Each weight = 1/13 ≈ 0.07692...
 *
 * Wave 29 Pass C.3: rl_agent added as 13th subsystem with equal weight.
 * The weightsVersionId (SHA-256 over canonical-sorted-JSON) re-hashes
 * automatically — any downstream consumer that pinned the old 16-char hash
 * will see a new value (model-change event per MRM contract).
 *
 * FROZEN via Object.freeze — any mutation attempt throws at runtime.
 * Any future weight change is a model-change event requiring full validation.
 */
export const EQUAL_WEIGHTS: Readonly<Record<SubsystemName, number>> = Object.freeze({
  b14_survival_twin:   1 / 13,
  wfe:                 1 / 13,
  parameter_drift:     1 / 13,
  b15_robustness:      1 / 13,
  compliance:          1 / 13,
  trade_critique:      1 / 13,
  pattern_aggregator:  1 / 13,
  consistency_tracker: 1 / 13,
  deepar:              1 / 13,
  black_swan:          1 / 13,
  nemo:                1 / 13,
  quantum_replay:      1 / 13,
  rl_agent:            1 / 13,
} as const);

// ─── Normalizer functions (one per subsystem) ─────────────────────────────────

/**
 * B14 Survival Twin: ci_high ∈ [0, 1] → invert so higher ruin = lower health.
 * score = 1 - ci_high
 * A ci_high of 0.40 (the gate threshold) maps to score = 0.60.
 */
export function normalizeB14SurvivalTwin(
  ciHigh: number,
  available: boolean,
): number | null {
  if (!available) return null;
  return Math.max(0, Math.min(1, 1 - ciHigh));
}

/**
 * Walk-Forward Efficiency: wfe_overall ∈ [0, ~2] → clip to [0, WFE_CLIP_MAX], divide.
 * score = clip(wfe_overall, 0, 1.5) / 1.5
 */
export function normalizeWfe(
  wfeOverall: number,
  available: boolean,
): number | null {
  if (!available) return null;
  const clipped = Math.max(0, Math.min(WFE_CLIP_MAX, wfeOverall));
  return clipped / WFE_CLIP_MAX;
}

/**
 * Parameter Drift: categorical classification → discrete confidence score.
 *   stable           → 1.0
 *   regime_driven    → 0.75
 *   indeterminate    → 0.40
 *   overfit_drift    → 0.0
 */
export function normalizeParameterDrift(
  classification: "stable" | "regime_driven" | "indeterminate" | "overfit_drift" | string,
  available: boolean,
): number | null {
  if (!available) return null;
  switch (classification) {
    case "stable":        return 1.0;
    case "regime_driven": return 0.75;
    case "indeterminate": return 0.40;
    case "overfit_drift": return 0.0;
    default:              return null;
  }
}

/**
 * B15 Parameter Robustness Battery: institutional 2026 floor logic.
 * score = min(SDR, 1 - PSI × 20, 1 - RWS × 5), clipped to [0, 1].
 *
 * Where:
 *   SDR  ∈ [0, 1] — Strategy Degradation Ratio (lower = worse)
 *   PSI  ∈ [0, 1] — Parameter Sensitivity Index (higher = worse)
 *   RWS  ∈ [0, 1] — Robustness Width Score inverse (higher = worse)
 *
 * Promotion gates: SDR < 0.85 OR PSI > 0.05 OR RWS > 0.20 → block.
 * These normalizer inputs agree with the gate thresholds but map
 * the full range to [0, 1] rather than replicating gate logic.
 */
export function normalizeB15Robustness(
  sdr: number,
  psi: number,
  rws: number,
  available: boolean,
): number | null {
  if (!available) return null;
  const raw = Math.min(sdr, 1 - psi * B15_PSI_SCALE, 1 - rws * B15_RWS_SCALE);
  return Math.max(0, Math.min(1, raw));
}

/**
 * Compliance: score = 1 - block_rate.
 * block_rate = 0 → score = 1.0 (no violations)
 * block_rate = 1 → score = 0.0 (all trades blocked)
 */
export function normalizeCompliance(
  blockRate: number,
  available: boolean,
): number | null {
  if (!available) return null;
  return Math.max(0, Math.min(1, 1 - blockRate));
}

/** Mapping from trade-critique letter grades to linear [0, 1] scores. */
const GRADE_SCORES: Record<string, number> = {
  "A+": 1.00,
  "A":  0.85,
  "B+": 0.70,
  "B":  0.55,
  "C+": 0.40,
  "C":  0.25,
  "D":  0.10,
  "F":  0.00,
};

/**
 * Trade Critique: average of linear grade scores.
 * Grades: A+/A/B+/B/C+/C/D/F → 1.0/0.85/0.70/0.55/0.40/0.25/0.10/0.0
 * Empty array or unrecognized grades → null.
 */
export function normalizeTradeCritique(
  grades: string[],
  available: boolean,
): number | null {
  if (!available) return null;
  if (grades.length === 0) return null;
  const mapped = grades.map((g) => GRADE_SCORES[g]);
  if (mapped.some((v) => v === undefined)) return null;
  const sum = mapped.reduce((acc, v) => acc + (v as number), 0);
  return sum / grades.length;
}

/**
 * Pattern Aggregator: latest A/B verdict.
 *   applied    → 1.0 (pattern applied, signal confirmed)
 *   no_change  → 0.7 (no actionable pattern found)
 *   failed     → 0.0 (aggregation failed or pattern rejected)
 */
export function normalizePatternAggregator(
  verdict: "applied" | "no_change" | "failed" | string,
  available: boolean,
): number | null {
  if (!available) return null;
  switch (verdict) {
    case "applied":   return 1.0;
    case "no_change": return 0.7;
    case "failed":    return 0.0;
    default:          return null;
  }
}

/**
 * Consistency Tracker: intraday P&L concentration penalty.
 * score = 1 - max(0, current_pct - CONSISTENCY_LOWER_BOUND) / (CONSISTENCY_UPPER_BOUND - CONSISTENCY_LOWER_BOUND)
 * At ≤ 40%: score = 1.0 (well distributed)
 * At ≥ 50%: score = 0.0 (dangerously concentrated)
 * Linear between the two bounds.
 *
 * Exactly at boundary: ≤ 40% → 1.0, ≥ 50% → 0.0 (exclusive lower bound per spec).
 */
export function normalizeConsistencyTracker(
  currentPct: number,
  available: boolean,
): number | null {
  if (!available) return null;
  const range = CONSISTENCY_UPPER_BOUND - CONSISTENCY_LOWER_BOUND; // 0.10
  const excess = Math.max(0, currentPct - CONSISTENCY_LOWER_BOUND);
  return Math.max(0, Math.min(1, 1 - excess / range));
}

/**
 * DeepAR: forecast vs realized absolute error normalized by threshold.
 * score = 1 - clip(|forecast_vs_realized| / threshold, 0, 1)
 * Perfect forecast (error = 0) → 1.0.
 * Error ≥ threshold → 0.0.
 */
export function normalizeDeepAr(
  forecastVsRealized: number,
  available: boolean,
  threshold: number = DEEPAR_DEFAULT_THRESHOLD,
): number | null {
  if (!available) return null;
  const normalizedError = Math.abs(forecastVsRealized) / threshold;
  return Math.max(0, Math.min(1, 1 - normalizedError));
}

/**
 * Black Swan: scalar advisory from challenger subsystem, already ∈ [0, 1].
 * Passthrough — return as-is when available.
 */
export function normalizeBlackSwan(
  score: number,
  available: boolean,
): number | null {
  if (!available) return null;
  return Math.max(0, Math.min(1, score));
}

/**
 * NeMo: scalar advisory from challenger subsystem, already ∈ [0, 1].
 * Passthrough — return as-is when available.
 */
export function normalizeNemo(
  score: number,
  available: boolean,
): number | null {
  if (!available) return null;
  return Math.max(0, Math.min(1, score));
}

/** Quantum Replay signal classification → discrete confidence score. */
const QUANTUM_REPLAY_SCORES: Record<string, number> = {
  SIGNAL:       1.0,
  PRELIMINARY:  0.7,
  INCONCLUSIVE: 0.5,
  NO_SIGNAL:    0.3,
  FAILURE:      0.0,
};

/**
 * Quantum Replay: verdict label → discrete [0, 1] confidence.
 *   SIGNAL       → 1.0
 *   PRELIMINARY  → 0.7
 *   INCONCLUSIVE → 0.5
 *   NO_SIGNAL    → 0.3
 *   FAILURE      → 0.0
 */
export function normalizeQuantumReplay(
  verdict: "SIGNAL" | "PRELIMINARY" | "INCONCLUSIVE" | "NO_SIGNAL" | "FAILURE" | string,
  available: boolean,
): number | null {
  if (!available) return null;
  const score = QUANTUM_REPLAY_SCORES[verdict];
  return score !== undefined ? score : null;
}

// ─── RL Agent normalizer (Wave 29 Pass C.3) ──────────────────────────────────

/**
 * RL Agent (13th subsystem): normalise the RL effective_confidence to [0,1]
 * with graduation gating.
 *
 * Returns null (subsystem unavailable) when:
 *   - kill_switch_dormant = false  → Sharpe gap > 30% → kill switch active
 *   - dsr_passed = false           → RL policy has not yet graduated
 * Otherwise: return rl_confidence (already [0,1] from effective_confidence).
 *
 * This function is the single-source gating rule for whether the RL agent
 * contributes to the composite.  The aggregator's MIN_COMPOSITE_SUBSYSTEMS=8
 * floor handles cycles where RL is unavailable — the composite still writes
 * as long as ≥8 other subsystems are available.
 *
 * @param rl_confidence      effective_confidence from quantum_rl_runs [0,1]
 * @param dsr_passed         Whether the DSR gate has been passed (rl-dsr-gate)
 * @param kill_switch_dormant Whether the kill switch is dormant (safe to use)
 */
export function normalizeRLConfidence(
  rl_confidence: number,
  dsr_passed: boolean,
  kill_switch_dormant: boolean,
): number | null {
  if (!kill_switch_dormant) return null;  // Kill switch active → unavailable
  if (!dsr_passed) return null;           // Not yet graduated → unavailable
  return Math.max(0, Math.min(1, rl_confidence));
}

// ─── Composite computation ────────────────────────────────────────────────────

/**
 * Compute the weighted composite health score from per-subsystem scores.
 *
 * Rules:
 *   - null-filled subsystems are excluded from numerator AND denominator.
 *     The weights of available subsystems are renormalized (their relative
 *     contributions remain EQUAL to each other, but sum to 1 over available set).
 *   - If available subsystem count < MIN_AVAILABLE_FOR_COMPOSITE → return null.
 *     The A.2 aggregator handles this as a skip-write cycle.
 *   - Result is always ∈ [0, 1] when non-null.
 *
 * @param subsystemScores  Record mapping each subsystem name to its score or null.
 * @param weights          Weight map (defaults to EQUAL_WEIGHTS).
 * @returns CompositeResult — includes the score, available count, weight sum,
 *          verdict, and the weights-version-id for audit traceability.
 */
export function computeComposite(
  subsystemScores: Record<string, number | null>,
  weights: Readonly<Record<string, number>> = EQUAL_WEIGHTS,
): CompositeResult {
  const weightsVersionId = computeWeightsVersionId(weights);

  let weightedSum = 0;
  let availableWeightSum = 0;
  let availableCount = 0;

  for (const [key, score] of Object.entries(subsystemScores)) {
    if (score === null || score === undefined) continue;
    const w = weights[key];
    if (w === undefined || w === 0) continue;
    weightedSum += score * w;
    availableWeightSum += w;
    availableCount++;
  }

  if (availableCount < MIN_AVAILABLE_FOR_COMPOSITE) {
    return {
      score: null,
      availableCount,
      availableWeightSum,
      verdict: null,
      weightsVersionId,
    };
  }

  // Renormalize: divide by the sum of available weights so the composite
  // remains ∈ [0, 1] even when some subsystems are unavailable.
  const compositeScore = availableWeightSum > 0
    ? weightedSum / availableWeightSum
    : null;

  const finalScore = compositeScore !== null
    ? Math.max(0, Math.min(1, compositeScore))
    : null;

  return {
    score: finalScore,
    availableCount,
    availableWeightSum,
    verdict: verdictFromComposite(finalScore),
    weightsVersionId,
  };
}

// ─── Weights version fingerprint ─────────────────────────────────────────────

/**
 * Produce a canonical JSON string with sorted keys (no whitespace).
 * Mirrors firm-rules-version.ts::canonicalJson exactly.
 */
function canonicalJson(obj: unknown): string {
  return JSON.stringify(obj, sortedKeyReplacer);
}

/**
 * JSON.stringify replacer that sorts object keys lexicographically.
 * Mirrors firm-rules-version.ts::sortedKeyReplacer exactly.
 */
function sortedKeyReplacer(_key: string, value: unknown): unknown {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[k] = (value as Record<string, unknown>)[k];
    }
    return sorted;
  }
  return value;
}

/**
 * Compute a full SHA-256 hex fingerprint over the canonical-sorted-JSON of a
 * weights map.  Any weight change produces a different hash — automatic audit
 * lineage without manual version bumping.
 *
 * Returns a full 64-character hex string (unlike firm-rules-version.ts which
 * returns only the first 16 chars for readability).  The full hash is preferred
 * here because weight maps are small and collision resistance matters for MRM.
 *
 * @param weights  The weight map to fingerprint.
 * @returns        Lowercase SHA-256 hex string (64 chars).
 */
export function computeWeightsVersionId(weights: Readonly<Record<string, number>>): string {
  const canonical = canonicalJson(weights as Record<string, unknown>);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

// ─── Verdict classification ───────────────────────────────────────────────────

/**
 * Classify a composite score into a human-readable verdict.
 *
 * Boundaries (exclusive lower bounds — the score AT the boundary belongs to the
 * LOWER category, consistent with "must be strictly above threshold to qualify"):
 *   score >= 0.75  → HEALTHY
 *   score >= 0.50  → MARGINAL
 *   score >= 0.25  → UNHEALTHY
 *   score <  0.25  → CRITICAL
 *   null           → null (caller handles skip-write / unknown state)
 *
 * Exactly at boundary examples:
 *   0.75 → HEALTHY   (>= 0.75)
 *   0.50 → MARGINAL  (>= 0.50, < 0.75)
 *   0.25 → UNHEALTHY (>= 0.25, < 0.50)
 *   0.24 → CRITICAL  (< 0.25)
 */
export function verdictFromComposite(score: number | null): VerdictLabel | null {
  if (score === null) return null;
  if (score >= VERDICT_HEALTHY_THRESHOLD)    return "HEALTHY";
  if (score >= VERDICT_MARGINAL_THRESHOLD)   return "MARGINAL";
  if (score >= VERDICT_UNHEALTHY_THRESHOLD)  return "UNHEALTHY";
  return "CRITICAL";
}
