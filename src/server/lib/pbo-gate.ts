/**
 * pbo-gate.ts — Wave 29 Pass A.2 (backtest-core)
 *
 * Pure-function PBO (Probability of Backtest Overfitting) lifecycle gate.
 *
 * Institutional 2026 standard (Lopez de Prado / QuantBeckman 2025 / arXiv 2512.12924):
 *   PBO < PBO_OVERFIT_THRESHOLD_PCT (default 0.15) → TESTING → SHADOW/PAPER proceeds
 *   PBO ≥ threshold                                → BLOCK + lifecycle.pbo_overfit_block audit
 *
 * TWO SEPARATE THRESHOLDS (do NOT conflate):
 *   PBO_OVERFIT_THRESHOLD     (default 0.5)  — Wave 27.5 warn threshold
 *                                               (walk_forward.py emits pbo_high_overfit_risk warn)
 *   PBO_OVERFIT_THRESHOLD_PCT (default 0.15) — Wave 29 lifecycle hard gate
 *                                               (this file; TESTING → SHADOW/PAPER)
 *
 * TODO-A1: Wire gate to TESTING → SHADOW transition once A.1 adds the SHADOW
 * lifecycle state to lifecycle-service.ts. Currently wired to TESTING → PAPER.
 * A.4 architect will reconcile after A.1 lands. Gate logic is identical for
 * both transition targets — only the `toState` check in lifecycle-service.ts changes.
 *
 * Legacy null fallback (pre-Wave-29 backtests with no `pbo_overall`):
 *   → PROCEED + lifecycle.pbo_unavailable_legacy warn audit (grandfather window).
 *
 * Pattern references:
 *   - src/server/lib/b14-ci-gate.ts — structural template
 *   - src/server/lib/wfe-gate.ts — sibling gate pattern
 */

import { logger } from "./logger.js";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Default PBO threshold for TESTING → SHADOW/PAPER lifecycle gate (Wave 29). */
export const PBO_LIFECYCLE_THRESHOLD_DEFAULT = 0.15;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PboGateInput {
  /** PBO value from backtests.walk_forward_metadata.pbo_overall (Wave 29 field). */
  pbo_overall?: number | null;
  /** p-value from binomial test on PBO; null when scipy unavailable or n < 10. */
  pbo_p_value?: number | null;
  /**
   * CPCV-exempt reason (hardening/phase-0): walk_forward.py emits
   * pbo_degenerate_reason="cpcv_is_sharpe_unavailable" inside wf_metadata when
   * mode="cpcv". In CPCV mode the PBO rank-comparison requires per-path IS Sharpe
   * values that CPCV does not produce (all paths share OOS data). This is NOT a
   * legacy null — it is a known structural limitation of CPCV. Caller reads this
   * from wf_metadata.pbo_degenerate_reason and passes it here.
   */
  pbo_degenerate_reason?: string | null;
}

export interface PboGateResult {
  /** True when the gate allows promotion; false when it blocks. */
  ok: boolean;
  /** Resolved PBO value, or null for legacy/missing. */
  pbo: number | null;
  /** Effective threshold used for the comparison. */
  threshold: number;
  /** Human-readable reason for the gate decision. */
  reason?: string;
  /** True when the backtest pre-dates Wave 29 (no pbo_overall key). */
  legacyNull: boolean;
  /** Full audit payload for the audit_log result field. */
  auditPayload: {
    pbo: number | null;
    pbo_p_value: number | null;
    threshold: number;
    blocked: boolean;
    legacy_null: boolean;
    /** Present when the gate exempted this result due to CPCV structural limitation. */
    cpcv_exempt?: boolean;
  };
}

// ── Env helper ────────────────────────────────────────────────────────────────

/**
 * Read PBO_OVERFIT_THRESHOLD_PCT from env, defaulting to 0.15.
 * Exported for tests to verify the env-override path without side effects.
 *
 * NOTE: This is the LIFECYCLE gate threshold (Wave 29).
 * It is SEPARATE from PBO_OVERFIT_THRESHOLD (default 0.5) used by walk_forward.py
 * to emit the pbo_high_overfit_risk WARN audit.
 */
export function getPboLifecycleThreshold(): number {
  const raw = process.env.PBO_OVERFIT_THRESHOLD_PCT;
  if (raw === undefined || raw === "") return PBO_LIFECYCLE_THRESHOLD_DEFAULT;
  const parsed = parseFloat(raw);
  if (isNaN(parsed) || parsed < 0 || parsed > 1) {
    logger.warn(
      { raw, defaulted: PBO_LIFECYCLE_THRESHOLD_DEFAULT },
      "PBO_OVERFIT_THRESHOLD_PCT is invalid — using default 0.15",
    );
    return PBO_LIFECYCLE_THRESHOLD_DEFAULT;
  }
  return parsed;
}

// ── Gate function ─────────────────────────────────────────────────────────────

/**
 * Evaluate the PBO lifecycle gate.
 *
 * Gate semantics:
 *   pbo_overall === null/undefined → PROCEED (legacy grandfather) + legacy warn
 *   pbo_overall < threshold        → PROCEED (not blocked; strict <)
 *   pbo_overall === threshold      → PROCEED (strict <; at-threshold is not blocked)
 *   pbo_overall > threshold        → BLOCK + lifecycle.pbo_overfit_block audit
 *
 * Convention: strict < (not ≤) — pbo_overall exactly equal to threshold PROCEEDS.
 * Mirrors the B14 gate convention (strict > for blocking).
 *
 * @param backtestResult  Object with pbo_overall and optionally pbo_p_value.
 *                        Pass {} or { pbo_overall: undefined } for legacy backtests.
 * @param opts.threshold  Override env-derived threshold (for tests).
 */
export function evaluatePboGate(
  backtestResult: PboGateInput,
  opts?: { threshold?: number },
): PboGateResult {
  const effectiveThreshold = opts?.threshold ?? getPboLifecycleThreshold();
  const pboRaw = backtestResult.pbo_overall;
  const pValueRaw = backtestResult.pbo_p_value ?? null;

  // ── Plain-WF degenerate path (Track B coordination — 2026-06-29) ────────────
  // walk_forward.py writes pbo_degenerate_reason="plain_wf_is_unavailable" into the
  // PLAIN-WF wf_metadata when a plain-WF run produces a degenerate PBO (the IS/OOS
  // rank comparison could not be computed). Unlike CPCV — which has a structural
  // excuse (all paths share OOS data) — plain WF has NO such excuse: it RAN and came
  // back unusable, so the strategy is UN-VALIDATED, not measurement-limited. This is
  // therefore distinct from BOTH the CPCV-exempt PROCEED and the legacy-null
  // grandfather PROCEED. Fail-CLOSED → BLOCK with a distinct reason so the audit row
  // is never confused with either PROCEED path.
  // NOTE: the string "plain_wf_is_unavailable" must match Track B's walk_forward.py
  // emitter EXACTLY — do not rename without coordinating the Python side.
  if (pboRaw == null && backtestResult.pbo_degenerate_reason === "plain_wf_is_unavailable") {
    logger.warn(
      { threshold: effectiveThreshold, pbo_degenerate_reason: backtestResult.pbo_degenerate_reason },
      "PBO gate: BLOCKED — plain-WF PBO is degenerate/unavailable (plain_wf_is_unavailable); " +
        "fail-CLOSED (lifecycle.pbo_plain_wf_degenerate_block) — NOT CPCV-exempt, NOT legacy grandfather",
    );
    return {
      ok: false,
      pbo: null,
      threshold: effectiveThreshold,
      reason: "lifecycle.pbo_plain_wf_degenerate_block",
      legacyNull: false,
      auditPayload: {
        pbo: null,
        pbo_p_value: pValueRaw,
        threshold: effectiveThreshold,
        blocked: true,
        legacy_null: false,
      },
    };
  }

  // ── CPCV-exempt path (hardening/phase-0) ───────────────────────────────────
  // walk_forward.py emits pbo_degenerate_reason="cpcv_is_sharpe_unavailable" in
  // wf_metadata when mode="cpcv". PBO rank-comparison requires per-path IS Sharpe
  // which CPCV does not produce. This is NOT a legacy null — the producer explicitly
  // signals the structural limitation. Return a DISTINCT result so the audit row
  // uses "lifecycle.pbo_cpcv_is_unavailable" instead of the generic legacy action.
  // legacyNull=false so callers can distinguish this from the grandfather window.
  if (pboRaw == null && backtestResult.pbo_degenerate_reason === "cpcv_is_sharpe_unavailable") {
    logger.warn(
      { threshold: effectiveThreshold, pbo_degenerate_reason: backtestResult.pbo_degenerate_reason },
      "PBO gate: pbo_overall unavailable due to CPCV structural limitation — blocking promotion pending an IS-basis result (lifecycle.pbo_cpcv_is_unavailable)",
    );
    return {
      ok: false,
      pbo: null,
      threshold: effectiveThreshold,
      reason: "lifecycle.pbo_cpcv_is_unavailable",
      legacyNull: false,
      auditPayload: {
        pbo: null,
        pbo_p_value: pValueRaw,
        threshold: effectiveThreshold,
        blocked: true,
        legacy_null: false,
        cpcv_exempt: true,
      },
    };
  }

  // ── Legacy null path ───────────────────────────────────────────────────────
  // Pre-Wave-29 backtests do not have pbo_overall. We proceed with a warn.
  // This is the documented grandfather window — future backtests always emit the field.
  if (pboRaw == null) {
    logger.warn(
      { threshold: effectiveThreshold },
      "PBO gate: pbo_overall unavailable — blocking promotion until a fresh result is present (lifecycle.pbo_unavailable_legacy)",
    );
    return {
      ok: false,
      pbo: null,
      threshold: effectiveThreshold,
      reason: "lifecycle.pbo_unavailable_legacy",
      legacyNull: true,
      auditPayload: {
        pbo: null,
        pbo_p_value: pValueRaw,
        threshold: effectiveThreshold,
        blocked: true,
        legacy_null: true,
      },
    };
  }

  const pbo = Number(pboRaw);

  // ── Sample-size guard (degenerate / non-finite PBO) ───────────────────────
  // Python pbo_gate.py returns float('nan') when n_paths < PBO_MIN_PATHS=4.
  // In some wire paths this survives as JS NaN (e.g. Python json.dumps(nan)
  // produces "NaN" which JS JSON.parse rejects, but defensive coding is cheap).
  // NaN > 0.15 === false in JS, which would silently PASS the gate — that is the
  // documented BLOCKER bug (hardening/phase-0).
  // +Infinity / -Infinity are equally degenerate.
  // VERDICT: fail-CLOSED on any non-finite PBO. The degenerate case must block,
  // not grandfather. Legacy null (pre-Wave-29 missing field) grandfathers via the
  // pboRaw==null branch above; degenerate-computed ≠ missing-field.
  if (!Number.isFinite(pbo)) {
    logger.warn(
      { pboRaw, threshold: effectiveThreshold },
      "PBO gate: BLOCKED — pbo_overall is non-finite (sample-size guard or computation failure); fail-CLOSED (lifecycle.pbo_sample_size_guard)",
    );
    return {
      ok: false,
      pbo: null,
      threshold: effectiveThreshold,
      reason: "lifecycle.pbo_sample_size_guard",
      legacyNull: false,
      auditPayload: {
        pbo: null,
        pbo_p_value: pValueRaw,
        threshold: effectiveThreshold,
        blocked: true,
        legacy_null: false,
      },
    };
  }

  // ── Block path ─────────────────────────────────────────────────────────────
  // PBO > threshold = strategy is more likely to be overfit than not.
  // Strict >: PBO === threshold is NOT blocked (institutional convention).
  if (pbo > effectiveThreshold) {
    logger.warn(
      { pbo, threshold: effectiveThreshold, pbo_p_value: pValueRaw },
      "PBO gate: BLOCKED — pbo_overall exceeds lifecycle threshold (lifecycle.pbo_overfit_block)",
    );
    return {
      ok: false,
      pbo,
      threshold: effectiveThreshold,
      reason: "lifecycle.pbo_overfit_block",
      legacyNull: false,
      auditPayload: {
        pbo,
        pbo_p_value: pValueRaw,
        threshold: effectiveThreshold,
        blocked: true,
        legacy_null: false,
      },
    };
  }

  // ── Pass path ──────────────────────────────────────────────────────────────
  return {
    ok: true,
    pbo,
    threshold: effectiveThreshold,
    reason: "lifecycle.pbo_within_threshold",
    legacyNull: false,
    auditPayload: {
      pbo,
      pbo_p_value: pValueRaw,
      threshold: effectiveThreshold,
      blocked: false,
      legacy_null: false,
    },
  };
}
