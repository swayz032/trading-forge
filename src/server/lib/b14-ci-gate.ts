/**
 * b14-ci-gate.ts — Wave 27.5 Pass B.2 (paper-parity)
 *
 * Pure-function B14 Survival Twin CI gate.
 *
 * Pass A (mc_confidence.py + compute_all_mc_cis) now emits
 * `probability_of_ruin_ci` as a BCa-bootstrapped dict:
 *   { point_estimate, ci_low, ci_high, ci_method, n_resamples, standard_error }
 *
 * This helper centralises the ci_high read, threshold comparison, and audit
 * payload construction.  It is intentionally free of DB access and side effects
 * so that tests can cover every branch without a DB connection.
 *
 * Institutional default: block when ci_high > 0.40.
 * Env override: B14_RUIN_CI_HIGH_THRESHOLD (float string, default "0.40").
 * Convention: strict > (not ≥) — ci_high exactly equal to threshold is NOT blocked.
 */

import { logger } from "./logger.js";

export interface RuinCiDict {
  point_estimate?: number | null;
  ci_low?: number | null;
  ci_high?: number | null;
  ci_method?: string | null;
  n_resamples?: number | null;
  standard_error?: number | null;
}

export interface B14CiGateResult {
  /** True when the gate allows promotion; false when it blocks. */
  passed: boolean;
  /** Human-readable reason string for the audit row. */
  reason: string;
  /** Whether the legacy scalar fallback was used (missing ci_high). */
  legacyFallback: boolean;
  /** Full audit payload — merge into the audit_log result field. */
  auditPayload: {
    point_estimate: number | null;
    ci_low: number | null;
    ci_high: number | null;
    threshold: number;
    blocked: boolean;
    legacy_ruin_scalar_fallback: boolean;
    ci_method: string | null;
    n_resamples: number | null;
  };
}

/**
 * Read B14_RUIN_CI_HIGH_THRESHOLD from env, defaulting to 0.40.
 * Exported so tests can verify the env-override path without side effects.
 */
export function getB14CiHighThreshold(): number {
  const raw = process.env.B14_RUIN_CI_HIGH_THRESHOLD;
  if (raw === undefined || raw === "") return 0.40;
  const parsed = parseFloat(raw);
  if (isNaN(parsed) || parsed < 0 || parsed > 1) {
    logger.warn(
      { raw, defaulted: 0.40 },
      "B14_RUIN_CI_HIGH_THRESHOLD is invalid — using default 0.40",
    );
    return 0.40;
  }
  return parsed;
}

/**
 * Evaluate the B14 CI gate.
 *
 * @param ruinCi   The probability_of_ruin_ci dict from MC risk_metrics.
 *                 Pass null for legacy MC runs that pre-date Pass A.
 * @param pointEstimate  The scalar probability_of_ruin (pre-Pass-A fallback).
 *                       Used when ruinCi is null or lacks ci_high.
 * @param threshold  Override the env-derived threshold (for tests).
 *                   When undefined, reads from env.
 */
export function evaluateB14CiGate(
  ruinCi: RuinCiDict | null | undefined,
  pointEstimate: number | null | undefined,
  threshold?: number,
): B14CiGateResult {
  const effectiveThreshold = threshold ?? getB14CiHighThreshold();

  let ciHigh: number | null = null;
  let ciLow: number | null = null;
  let ciMethod: string | null = null;
  let nResamples: number | null = null;
  let pointEst: number | null = null;
  let legacyFallback = false;

  if (ruinCi != null && typeof ruinCi === "object") {
    ciHigh = ruinCi.ci_high != null ? Number(ruinCi.ci_high) : null;
    ciLow = ruinCi.ci_low != null ? Number(ruinCi.ci_low) : null;
    ciMethod = ruinCi.ci_method ?? null;
    nResamples = ruinCi.n_resamples != null ? Number(ruinCi.n_resamples) : null;
    pointEst = ruinCi.point_estimate != null ? Number(ruinCi.point_estimate) : null;
  }

  // Fall back to scalar point estimate when ci_high is unavailable (pre-Pass-A runs).
  if (ciHigh === null) {
    legacyFallback = true;
    ciHigh = pointEstimate != null ? Number(pointEstimate) : null;
    pointEst = ciHigh;
    logger.warn(
      { pointEstimate: ciHigh, threshold: effectiveThreshold },
      "B14 ci_high unavailable — falling back to scalar probability_of_ruin (b14.legacy_ruin_scalar_fallback)",
    );
  }

  // If we still have no value (no MC run at all for this backtest), pass through.
  // The outer B14 gate already handles "no backtest data" cases; this helper
  // only runs when the caller has confirmed a backtest row exists.
  if (ciHigh === null) {
    return {
      passed: true,
      reason: "b14.ci_high_unavailable_no_mc_run",
      legacyFallback: true,
      auditPayload: {
        point_estimate: null,
        ci_low: null,
        ci_high: null,
        threshold: effectiveThreshold,
        blocked: false,
        legacy_ruin_scalar_fallback: true,
        ci_method: null,
        n_resamples: null,
      },
    };
  }

  // Strict >  (not >=): ci_high exactly equal to threshold is NOT blocked.
  // Institutional convention: 0.40 means "reject strategies with GREATER THAN 40% ruin CI".
  const blocked = ciHigh > effectiveThreshold;

  return {
    passed: !blocked,
    reason: blocked ? "b14.ci_high_exceeds_threshold" : "b14.ci_high_within_threshold",
    legacyFallback,
    auditPayload: {
      point_estimate: pointEst,
      ci_low: ciLow,
      ci_high: ciHigh,
      threshold: effectiveThreshold,
      blocked,
      legacy_ruin_scalar_fallback: legacyFallback,
      ci_method: ciMethod,
      n_resamples: nResamples,
    },
  };
}
