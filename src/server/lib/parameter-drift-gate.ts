/**
 * parameter-drift-gate.ts — Wave 27.5 Pass B.2 (paper-parity)
 *
 * Pure-function parameter drift classification gate.
 *
 * Pass B.1 (backtest-core) emits two fields into
 * `backtests.walk_forward_metadata`:
 *   - parameter_drift_classification: "overfit_drift" | "indeterminate" |
 *                                     "regime_driven" | "stable" | "classifier_error" | null
 *   - parameter_drift_confidence: float [0, 1] | null
 *
 * Gate logic (from spec):
 *   classification == "overfit_drift" AND confidence >= 0.70 → BLOCK
 *   classification == "overfit_drift" AND confidence < 0.70  → WARN (allow)
 *   classification == "indeterminate"                         → WARN (allow)
 *   classification == "classifier_error"                     → BLOCK (G2b hardening 2026-06-22)
 *   classification == "regime_driven" OR "stable"            → pass, no action
 *   classification == null (legacy or no regime data)        → allow + audit
 *
 * Wave hardening 2026-06-22 (G2b): "classifier_error" is DISTINCT from
 * "indeterminate".  A classifier CRASH on a real (possibly overfit) strategy
 * is indistinguishable from a crash on any other strategy, so the institutional-
 * safe default is to BLOCK.  "indeterminate" retains its genuine-ambiguity /
 * warn-and-allow semantics.  The forward-compat unknown-value fall-through MUST
 * NOT apply to "classifier_error" — it is a known, explicit, fail-closed value.
 *
 * Exported pure functions have no DB access or side effects.
 */

export type ParameterDriftClassification =
  | "overfit_drift"
  | "indeterminate"
  | "regime_driven"
  | "stable"
  | "classifier_error"  // G2b hardening 2026-06-22: classifier raised an exception
  | (string & {});      // forward-compat for future Pass B.1 values

export type ParameterDriftGateStatus =
  | "blocked"                    // overfit_drift + confidence >= 0.70
  | "blocked_classifier_error"   // classifier_error (G2b hardening 2026-06-22)
  | "warned_overfit"             // overfit_drift + confidence < 0.70
  | "warned_indeterminate"       // indeterminate classification
  | "passed"                     // regime_driven | stable
  | "legacy_null";               // null classification (pre-Pass-B.1)

export interface ParameterDriftGateResult {
  status: ParameterDriftGateStatus;
  /** True when the gate allows promotion. */
  passed: boolean;
  classification: string | null;
  confidence: number | null;
  /** Audit action name to emit. Null when no audit action is needed. */
  auditAction:
    | "lifecycle.parameter_overfit_drift_block"
    | "lifecycle.parameter_drift_classifier_error_block"  // G2b hardening 2026-06-22
    | "lifecycle.parameter_drift_indeterminate_warn"
    | "lifecycle.parameter_drift_overfit_low_confidence_warn"
    | "lifecycle.parameter_drift_unavailable"
    | null; // null = stable/regime_driven, no audit needed
}

/** Confidence threshold above which overfit_drift becomes a hard block. */
const OVERFIT_DRIFT_CONFIDENCE_THRESHOLD = 0.70;

/**
 * Evaluate the parameter drift classification gate.
 *
 * @param classification  Value of walk_forward_metadata.parameter_drift_classification.
 *                        Pass null for legacy backtests or when Pass B.1 data absent.
 * @param confidence      Value of walk_forward_metadata.parameter_drift_confidence.
 *                        May be null even when classification is non-null.
 */
export function evaluateParameterDriftGate(
  classification: string | null | undefined,
  confidence: number | null | undefined,
): ParameterDriftGateResult {
  // Null classification — legacy or no regime data
  if (classification == null) {
    return {
      status: "legacy_null",
      passed: true,
      classification: null,
      confidence: null,
      auditAction: "lifecycle.parameter_drift_unavailable",
    };
  }

  const conf = confidence != null ? Number(confidence) : null;

  if (classification === "overfit_drift") {
    // When confidence is null, treat conservatively as high-confidence overfit
    // only if explicitly >= threshold. Missing confidence → warn, not block.
    const isHighConfidence = conf != null && conf >= OVERFIT_DRIFT_CONFIDENCE_THRESHOLD;

    if (isHighConfidence) {
      return {
        status: "blocked",
        passed: false,
        classification,
        confidence: conf,
        auditAction: "lifecycle.parameter_overfit_drift_block",
      };
    }

    // overfit_drift but low/missing confidence — warn, allow through
    return {
      status: "warned_overfit",
      passed: true,
      classification,
      confidence: conf,
      auditAction: "lifecycle.parameter_drift_overfit_low_confidence_warn",
    };
  }

  if (classification === "indeterminate") {
    return {
      status: "warned_indeterminate",
      passed: true,
      classification,
      confidence: conf,
      auditAction: "lifecycle.parameter_drift_indeterminate_warn",
    };
  }

  // Wave hardening 2026-06-22 (G2b): classifier exception in walk_forward.py emits
  // "classifier_error".  The institutional-safe default is to BLOCK — a crash on a
  // real (possibly overfit) strategy is indistinguishable from any other crash.
  // This check is BEFORE the forward-compat fall-through so unknown-value pass-through
  // can never absorb "classifier_error" into a silent allow.
  if (classification === "classifier_error") {
    return {
      status: "blocked_classifier_error",
      passed: false,
      classification,
      confidence: conf,
      auditAction: "lifecycle.parameter_drift_classifier_error_block",
    };
  }

  // "regime_driven" | "stable" | any future safe classification (forward-compat pass)
  // NOTE: "classifier_error" is explicitly handled above and MUST NOT reach here.
  return {
    status: "passed",
    passed: true,
    classification,
    confidence: conf,
    auditAction: null,
  };
}
