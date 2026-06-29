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
   * FINDING-1 fix: discriminator flag emitted by walk_forward.py when pbo_gate.py
   * fires the degenerate guard (IS==OOS for all paths — per-path IS Sharpe unavailable
   * in CPCV mode). When true, the gate BLOCKS with pbo_cpcv_degenerate_block rather
   * than using the legacy-null grandfather-pass path (pbo_unavailable_legacy).
   *
   * Distinction:
   *   pbo_overall===null AND pbo_degenerate===undefined/false → legacy-null → PROCEED
   *   pbo_overall===null AND pbo_degenerate===true            → CPCV degenerate → BLOCK
   */
  pbo_degenerate?: boolean | null;
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
    /** FINDING-1: present and true when CPCV degenerate guard fired. */
    cpcv_degenerate?: boolean;
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
 * Gate semantics (in evaluation order):
 *   pbo_degenerate === true        → BLOCK (FINDING-1: CPCV IS==OOS; pbo_cpcv_degenerate_block)
 *   pbo_overall === null/undefined → PROCEED (legacy grandfather) + legacy warn
 *   pbo_overall is non-finite      → BLOCK (sample-size guard; pbo_sample_size_guard)
 *   pbo_overall > threshold        → BLOCK + lifecycle.pbo_overfit_block audit
 *   pbo_overall <= threshold       → PROCEED (not blocked; strict <)
 *
 * CRITICAL DISTINCTION (Finding 1):
 *   pbo_overall===null AND pbo_degenerate===undefined/false → legacy-null → PROCEED
 *   pbo_overall===null AND pbo_degenerate===true            → CPCV degenerate → BLOCK
 *
 * Legacy-null path is ONLY for pre-Wave-29 backtests where pbo_overall was never
 * computed. CPCV degenerate is a known structural failure mode (not a missing field).
 *
 * Convention: strict < (not ≤) — pbo_overall exactly equal to threshold PROCEEDS.
 * Mirrors the B14 gate convention (strict > for blocking).
 *
 * @param backtestResult  Object with pbo_overall, optionally pbo_p_value and pbo_degenerate.
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

  // ── FINDING-1 fix: CPCV degenerate path ────────────────────────────────────
  // walk_forward.py emits pbo_degenerate=true when pbo_gate.py fires the degenerate
  // guard (IS==OOS for ALL paths — per-path IS Sharpe is unavailable in CPCV mode).
  // This is structurally different from a legacy-null pre-Wave-29 backtest:
  //   - Legacy null: pbo_overall field absent (grandfather window) → PROCEED is correct.
  //   - CPCV degenerate: pbo_overall=null because PBO was ATTEMPTED but structurally
  //     impossible (IS==OOS for every path). Grandfathering would HIDE the failure.
  // BLOCK is fail-CLOSED: we know the PBO gate cannot fire meaningfully in this run;
  // the strategy must re-run with a WF configuration that produces genuine IS data.
  if (backtestResult.pbo_degenerate === true) {
    logger.warn(
      { threshold: effectiveThreshold },
      "PBO gate: BLOCKED — pbo_degenerate=true (CPCV degenerate guard fired: IS==OOS " +
        "for all paths; per-path IS Sharpe unavailable; lifecycle.pbo_cpcv_degenerate_block)",
    );
    return {
      ok: false,
      pbo: null,
      threshold: effectiveThreshold,
      reason: "lifecycle.pbo_cpcv_degenerate_block",
      legacyNull: false,
      auditPayload: {
        pbo: null,
        pbo_p_value: pValueRaw,
        threshold: effectiveThreshold,
        blocked: true,
        legacy_null: false,
        cpcv_degenerate: true,
      },
    };
  }

  // ── Legacy null path ───────────────────────────────────────────────────────
  // Pre-Wave-29 backtests do not have pbo_overall. We proceed with a warn.
  // This is the documented grandfather window — future backtests always emit the field.
  // NOTE: pbo_degenerate check MUST come first (see FINDING-1 block above).
  if (pboRaw == null) {
    logger.warn(
      { threshold: effectiveThreshold },
      "PBO gate: pbo_overall unavailable (pre-Wave-29 backtest) — proceeding with legacy warn (lifecycle.pbo_unavailable_legacy)",
    );
    return {
      ok: true,
      pbo: null,
      threshold: effectiveThreshold,
      reason: "lifecycle.pbo_unavailable_legacy",
      legacyNull: true,
      auditPayload: {
        pbo: null,
        pbo_p_value: pValueRaw,
        threshold: effectiveThreshold,
        blocked: false,
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
