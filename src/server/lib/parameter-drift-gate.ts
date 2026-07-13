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
 * CPCV-exempt path (hardening/phase-0, 2026-06-29 — C1 consumer side):
 *   walk_forward.py emits a top-level `param_stability_status` key in its output:
 *     - "cpcv_not_applicable" on the CPCV path (no single optimization window to
 *       measure parameter stability across — the drift classifier is structurally N/A)
 *     - "computed" (or absent) on the plain-WF / purged-embargo path
 *   When param_stability_status == "cpcv_not_applicable" this gate returns a DISTINCT
 *   `cpcv_exempt` result (passed=true, auditAction="lifecycle.parameter_drift_cpcv_exempt")
 *   — modeled EXACTLY on the wfe-gate.ts cpcv_exempt precedent. This makes the CPCV
 *   bypass VISIBLE + auditable rather than silently collapsing into `legacy_null`
 *   (indistinguishable from genuinely-old pre-Pass-B.1 backtests). Genuine legacy-null
 *   (status absent/undefined AND classification null) keeps emitting the legacy_null path.
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
  | "cpcv_exempt"                // param_stability_status="cpcv_not_applicable" → CPCV mode; drift formula N/A → distinct audit
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
    | "lifecycle.parameter_drift_cpcv_exempt"             // CPCV mode: drift formula N/A; PASS with distinct audit
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
 * @param paramStabilityStatus  Top-level walk_forward output key `param_stability_status`.
 *                        When "cpcv_not_applicable" the gate returns a DISTINCT
 *                        `cpcv_exempt` result (passed=true, distinct audit) instead of
 *                        collapsing to legacy_null — mirrors the wfe-gate.ts cpcv_exempt
 *                        precedent so the CPCV bypass is visible + auditable. Any other
 *                        value (incl. "computed", undefined, null) falls through to the
 *                        normal classification logic below.
 */
export function evaluateParameterDriftGate(
  classification: string | null | undefined,
  confidence: number | null | undefined,
  paramStabilityStatus?: string | null,
): ParameterDriftGateResult {
  // CPCV-exempt path (hardening/phase-0, 2026-06-29 — C1 consumer side):
  // walk_forward.py emits param_stability_status="cpcv_not_applicable" on the CPCV path.
  // In CPCV mode there is no single optimization window to measure parameter drift across,
  // so the 4-class regime-context classifier is structurally N/A. This is NOT a legacy
  // null (the producer deliberately signals the exemption) — the gate PASSES with a
  // DISTINCT audit action so the exemption is queryable and distinguishable from a
  // pre-Pass-B.1 backtest where the field was simply never written. Checked FIRST so
  // it takes precedence over the null-classification legacy path (mirrors wfe-gate.ts,
  // where cpcv_not_applicable is checked before the legacy-null fall-through).
  //
  // DUAL-CONVENTION (cross-agent contract reconciliation, 2026-06-29): the CPCV-exempt
  // signal is honored whether the caller threads it as the dedicated 3rd `paramStabilityStatus`
  // arg (the wfe-gate-precedent convention used by lifecycle-service.ts + paper-to-deploy-ready-gates.ts)
  // OR collapses it into the `classification` slot (the gate-chain seam convention:
  // `effectiveClassification = param_stability_status ?? drift_classification`). Recognizing
  // both slots makes this gate the single authority for the exemption regardless of caller
  // wiring, so the CPCV bypass can never silently fall through to the forward-compat "passed"
  // or "legacy_null" paths.
  if (paramStabilityStatus === "cpcv_not_applicable" || classification === "cpcv_not_applicable") {
    return {
      status: "cpcv_exempt",
      passed: false,
      classification: null,
      confidence: null,
      auditAction: "lifecycle.parameter_drift_cpcv_exempt",
    };
  }

  // Null classification — legacy or no regime data
  if (classification == null) {
    return {
      status: "legacy_null",
      passed: false,
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
