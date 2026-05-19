/**
 * quantum-agreement.ts — Tier 1.1 QAE shadow helper (pure function, no DB).
 *
 * Governance boundary:
 *   - This module is CHALLENGER-ONLY. It generates advisory evidence.
 *   - NO DB calls, NO lifecycle decisions, NO execution path imports.
 *   - Outputs flow into lifecycle_transitions quantum_agreement_score columns.
 *   - Phase 0: gate behavior is 100% classical. This metric is OBSERVED only.
 *
 * Authority boundary (explicit):
 *   - computeAgreement() MUST NOT be called on the execution/decision path.
 *   - It is evidence for the critic, not a gate override.
 *   - Callers must ensure quantum reads are non-blocking (evidence is best-effort).
 *
 * Formula:
 *   score = 1 - min(|classical - quantum| / 0.10, 1.0)
 *     → 1.0 at perfect agreement
 *     → 0.5 at 5pp delta
 *     → 0.0 at 10pp+ delta
 *
 * Tolerance threshold: 0.05 absolute delta (5 percentage points).
 *
 * Fallback triggers (quantum data is untrustworthy):
 *   1. classical is null/undefined
 *   2. quantum is null/undefined
 *   3. CI width > 0.20 (quantum run too imprecise to compare)
 *
 * When fallback=true, score and withinTolerance are still computed if both
 * inputs are non-null, so the data is available for debugging. Downstream
 * callers MUST check fallback before using score for evidence weighting.
 */

export interface AgreementResult {
  /** Agreement score in [0, 1]. 1.0 = perfect match, 0.0 = 10pp+ divergence. */
  score: number;
  /** Signed delta: quantum - classical. Positive = quantum estimates higher risk. */
  delta: number;
  /** True when |delta| <= 0.05 (5 percentage points). */
  withinTolerance: boolean;
  /**
   * True when quantum data is untrustworthy (null input or CI too wide).
   * Downstream MUST treat the quantum evidence as absent when this is true.
   * The classical decision is ALWAYS authoritative regardless of this value.
   */
  fallback: boolean;
  /**
   * |delta| expressed in percentage points (0–100 scale).
   * Zero when either input is null (no comparison possible).
   */
  disagreementPct: number;
}

/**
 * Compute quantum-classical agreement metrics for a single lifecycle transition.
 *
 * @param classical - Classical MC probability of ruin (0–1), or null if unavailable.
 * @param quantum   - Quantum MC estimated value (0–1), or null if unavailable.
 * @param ci        - [lower, upper] 95% confidence interval from quantum run, optional.
 * @returns AgreementResult with score, delta, withinTolerance, fallback, disagreementPct.
 *
 * AUTHORITY BOUNDARY: return value is advisory evidence only. NEVER route to execution.
 */
export function computeAgreement(
  classical: number | null,
  quantum: number | null,
  ci?: [number, number],
): AgreementResult {
  // ── Null / missing input → fallback immediately ────────────────────────────
  if (classical == null || quantum == null) {
    return {
      score: 0,
      delta: 0,
      withinTolerance: false,
      fallback: true,
      disagreementPct: 0,
    };
  }

  // ── CI width check — untrustworthy quantum estimate ────────────────────────
  // Width > 0.20 means the quantum estimator's confidence interval is too wide
  // for the comparison to carry meaningful evidence weight.
  const ciWidth = ci != null ? ci[1] - ci[0] : 0;
  const ciTooWide = ci != null && ciWidth > 0.20;

  // ── Core math ─────────────────────────────────────────────────────────────
  // delta: signed (quantum - classical). Positive = quantum thinks risk is higher.
  const delta = quantum - classical;
  const absDelta = Math.abs(delta);

  // score: 1.0 at perfect agreement, 0.0 at >=10pp divergence.
  // Linear scale across [0, 0.10], clamped at 0 below.
  const score = 1 - Math.min(absDelta / 0.10, 1.0);

  // withinTolerance: 5pp absolute delta is the Phase 0 advisory alert threshold.
  const withinTolerance = absDelta <= 0.05;

  // disagreementPct: human-readable percentage points (0–100).
  const disagreementPct = absDelta * 100;

  return {
    score,
    delta,
    withinTolerance,
    fallback: ciTooWide,
    disagreementPct,
  };
}
