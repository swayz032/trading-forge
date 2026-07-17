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
 * Hardening 2026-06-22 (production audit):
 *   - Threshold default tightened 0.40 → 0.20 (institutional/practitioner ceiling
 *     for funded-account trading; operator is risk-averse). Env-overridable.
 *   - Fail-CLOSED when ci_high===null (no firm-breach ruin, no scalar) instead
 *     of the previous silent-PASS. Reason: "b14.firm_breach_ruin_unavailable_fail_closed".
 *   - Fail-CLOSED when ruinCi.ruin_unavailable===true (Python signals no firm
 *     models were configured, so the terminal<=0 basis is categorically wrong).
 *   - Payout-denial rate gate: if per_firm[*].consistency_fail_rate is present in
 *     the ruinCi dict, block when worst-firm rate > B14_PAYOUT_DENIAL_THRESHOLD
 *     (default 0.10, env-overridable via B14_PAYOUT_DENIAL_THRESHOLD).
 *
 * Env override: B14_RUIN_CI_HIGH_THRESHOLD (float string, default "0.20").
 * Convention: strict > (not ≥) — ci_high exactly equal to threshold is NOT blocked.
 */

import { logger } from "./logger.js";

// ── DSR walk-forward gate ─────────────────────────────────────────────────────

/**
 * Input shape for evaluateDsrWalkForwardGate.
 *
 * Fields come from backtests.walk_forward_results.wf_metadata (written by
 * walk_forward.py FIX 7 / Wave A, 2026-06-22).
 *
 * Naming mirrors the Python side exactly:
 *   wf_metadata.dsr_pass        — Boolean | null (None when computation failed)
 *   wf_metadata.dsr_unavailable — Boolean (true when DSR computation threw)
 *   wf_metadata.dsr             — float | null (the raw DSR value, informational)
 */
export interface WalkForwardDsrInput {
  dsr_pass?: boolean | null;
  dsr_unavailable?: boolean | null;
  dsr?: number | null;
}

/**
 * Result shape returned by evaluateDsrWalkForwardGate.
 *
 * Four terminal states:
 *   "pass"            — dsr_pass=true; gate allows promotion.
 *   "blocked_dsr_unavailable" — dsr_unavailable=true AND dsr_pass=false;
 *                       Python DSR computation threw; fail-closed.
 *   "blocked_dsr_floor"       — dsr_pass=false (without dsr_unavailable);
 *                       DSR computed but below floor.
 *   "legacy_proceed"  — dsr_pass undefined/null; pre-Wave-A backtest.
 *                       ⚠ MISNOMER (name kept for consumer compat — cron, manual path,
 *                       check-gate-parity.mjs all match on this string): despite "proceed",
 *                       this BLOCKS (passed:false, auditPayload.blocked:true, fail-closed) —
 *                       a fresh DSR must be computed (re-run required). DSR is deliberately
 *                       NOT grandfathered the way WFE/B14/PBO legacy-null are (they → PROCEED);
 *                       an overfitting-detection gate must not be skipped on stale backtests.
 */
export type DsrGateStatus =
  | "pass"
  | "blocked_dsr_unavailable"
  | "blocked_dsr_floor"
  | "legacy_proceed";

export interface DsrWalkForwardGateResult {
  /** True when the gate allows promotion; false when it blocks. */
  passed: boolean;
  /** Terminal state string. */
  status: DsrGateStatus;
  /** Canonical audit action name to write to audit_log. */
  auditAction:
    | "lifecycle.dsr_unavailable_block"
    | "lifecycle.dsr_floor_block"
    | "lifecycle.dsr_unavailable_legacy"
    | null;
  /** Human-readable reason string (mirrors the audit action). */
  reason: string;
  /** Full audit payload — merge into the audit_log result field. */
  auditPayload: {
    dsr_pass: boolean | null;
    dsr_unavailable: boolean;
    dsr: number | null;
    status: DsrGateStatus;
    blocked: boolean;
  };
}

/**
 * Evaluate the DSR walk-forward gate.
 *
 * Gate semantics (in priority order):
 *
 * 1. dsr_unavailable=true AND dsr_pass=false
 *    → BLOCK with status "blocked_dsr_unavailable"
 *    → audit "lifecycle.dsr_unavailable_block"
 *    (Python DSR computation threw; we cannot trust the strategy survived
 *     multiple-testing correction. Fail-closed per Wave A mandate.)
 *
 * 2. dsr_pass=false (dsr_unavailable falsy or absent)
 *    → BLOCK with status "blocked_dsr_floor"
 *    → audit "lifecycle.dsr_floor_block"
 *    (DSR computed and below floor. Strategy does not survive
 *     multiple-testing correction.)
 *
 * 3. dsr_pass=undefined | null
 *    → BLOCK (passed:false) with status "legacy_proceed" — the string is a MISNOMER
 *      (kept for consumer compat); the actual behavior is fail-CLOSED block.
 *    → audit "lifecycle.dsr_unavailable_legacy" (WARN; "blocking promotion until a
 *      fresh result is present")
 *    (Pre-Wave-A backtest that never emitted dsr_pass. Unlike WFE/B14/PBO, DSR is NOT
 *     grandfathered — the strategy must be re-run to compute a DSR. Every fresh WF run
 *     since 2026-06-22 emits the field, so this only affects un-re-run legacy rows.)
 *
 * 4. dsr_pass=true
 *    → PROCEED with status "pass"
 *    → no audit action (caller emits gate-passed row if desired)
 *
 * @param wfMetadata  Object with dsr_pass, dsr_unavailable, dsr from wf_metadata.
 *                    Pass null/undefined for pre-Wave-A backtests.
 */
export function evaluateDsrWalkForwardGate(
  wfMetadata: WalkForwardDsrInput | null | undefined,
): DsrWalkForwardGateResult {
  // Normalise nullish metadata to an empty object so field reads are uniform.
  const meta: WalkForwardDsrInput = wfMetadata ?? {};

  const dsrPass = meta.dsr_pass;
  const dsrUnavailable = meta.dsr_unavailable === true;
  const dsrValue = meta.dsr != null ? Number(meta.dsr) : null;

  // ── 1. Legacy path: dsr_pass not present (pre-Wave-A backtest) ─────────────
  // Distinct from "dsr_unavailable": legacy means the field was never emitted
  // by an older walk_forward.py, not that computation failed on a new run.
  if (dsrPass === undefined || dsrPass === null) {
    logger.warn(
      { dsr: dsrValue, dsrUnavailable },
      "DSR gate: dsr_pass absent — blocking promotion until a fresh result is present (lifecycle.dsr_unavailable_legacy)",
    );
    return {
      passed: false,
      status: "legacy_proceed",
      auditAction: "lifecycle.dsr_unavailable_legacy",
      reason: "lifecycle.dsr_unavailable_legacy",
      auditPayload: {
        dsr_pass: null,
        dsr_unavailable: dsrUnavailable,
        dsr: dsrValue,
        status: "legacy_proceed",
        blocked: true,
      },
    };
  }

  // ── 2. DSR pass: computation succeeded AND honest SR passed ────────────────
  if (dsrPass === true) {
    return {
      passed: true,
      status: "pass",
      auditAction: null,
      reason: "lifecycle.dsr_pass",
      auditPayload: {
        dsr_pass: true,
        dsr_unavailable: dsrUnavailable,
        dsr: dsrValue,
        status: "pass",
        blocked: false,
      },
    };
  }

  // dsrPass === false beyond this point.

  // ── 3. DSR unavailable: Python threw during computation ────────────────────
  // Priority: dsr_unavailable check comes BEFORE the bare dsr_pass=false path
  // because the cause matters for operator triage (computation failure vs. a
  // strategy that genuinely failed the honest-SR test).
  if (dsrUnavailable) {
    logger.warn(
      { dsr: dsrValue },
      "DSR gate: BLOCKED — dsr_unavailable=true AND dsr_pass=false (Python DSR computation failed; fail-closed per Wave A mandate) — lifecycle.dsr_unavailable_block",
    );
    return {
      passed: false,
      status: "blocked_dsr_unavailable",
      auditAction: "lifecycle.dsr_unavailable_block",
      reason: "lifecycle.dsr_unavailable_block",
      auditPayload: {
        dsr_pass: false,
        dsr_unavailable: true,
        dsr: dsrValue,
        status: "blocked_dsr_unavailable",
        blocked: true,
      },
    };
  }

  // ── 4. DSR floor: computation succeeded but SR is below honest floor ────────
  logger.warn(
    { dsr: dsrValue },
    "DSR gate: BLOCKED — dsr_pass=false (strategy did not survive multiple-testing correction) — lifecycle.dsr_floor_block",
  );
  return {
    passed: false,
    status: "blocked_dsr_floor",
    auditAction: "lifecycle.dsr_floor_block",
    reason: "lifecycle.dsr_floor_block",
    auditPayload: {
      dsr_pass: false,
      dsr_unavailable: false,
      dsr: dsrValue,
      status: "blocked_dsr_floor",
      blocked: true,
    },
  };
}

// ── B14 ruin-CI gate ──────────────────────────────────────────────────────────

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
    // Payout-denial fields (present only when per_firm data available)
    worst_consistency_fail_rate?: number | null;
    payout_denial_threshold?: number | null;
  };
}

/**
 * Read B14_RUIN_CI_HIGH_THRESHOLD from env.
 *
 * Hardening 2026-06-22: default tightened 0.40 → 0.20.
 * 0.20 is the institutional/practitioner ceiling for funded-account trading
 * (the operator is risk-averse and uses EOD trailing drawdown).
 *
 * Exported so tests can verify the env-override path without side effects.
 */
export function getB14CiHighThreshold(): number {
  const raw = process.env.B14_RUIN_CI_HIGH_THRESHOLD;
  // Hardening 2026-06-22: default changed from 0.40 → 0.20.
  if (raw === undefined || raw === "") return 0.20;
  const parsed = parseFloat(raw);
  if (isNaN(parsed) || parsed < 0 || parsed > 1) {
    logger.warn(
      { raw, defaulted: 0.20 },
      "B14_RUIN_CI_HIGH_THRESHOLD is invalid — using default 0.20",
    );
    return 0.20;
  }
  return parsed;
}

/**
 * Read B14_PAYOUT_DENIAL_THRESHOLD from env, defaulting to 0.10.
 *
 * When the MC firm_survival output includes per-firm consistency_fail_rate,
 * B14 gates on this too (Topstep documents payout-denial for consistency
 * violations; 10% is a conservative bound for funded-account risk aversion).
 *
 * Exported for tests.
 */
export function getB14PayoutDenialThreshold(): number {
  const raw = process.env.B14_PAYOUT_DENIAL_THRESHOLD;
  if (raw === undefined || raw === "") return 0.10;
  const parsed = parseFloat(raw);
  if (isNaN(parsed) || parsed < 0 || parsed > 1) {
    logger.warn(
      { raw, defaulted: 0.10 },
      "B14_PAYOUT_DENIAL_THRESHOLD is invalid — using default 0.10",
    );
    return 0.10;
  }
  return parsed;
}

/**
 * Evaluate the B14 CI gate.
 *
 * Priority order (first match wins):
 *
 * 0. ruin_unavailable=true in ruinCi
 *    → BLOCK "b14.firm_breach_ruin_unavailable_fail_closed"
 *    (Python signalled that no firm models were configured, so the
 *     terminal<=0 basis is categorically wrong for funded-account trading.)
 *
 * 1. Non-finite ci_high AND non-finite/absent scalar
 *    → BLOCK "b14.ruin_estimate_non_finite_fail_closed"
 *    (scipy BCa DegenerateDataWarning: MC ran but ruin estimate is corrupt.)
 *
 * 2. ci_high === null (no firm-breach ruin available, including no MC run)
 *    → BLOCK "b14.firm_breach_ruin_unavailable_fail_closed"
 *    (Hardening 2026-06-22: previously returned passed:true. When survival
 *     cannot be proven, we block. Any legacy/pre-MC grandfather must be an
 *     explicit, dated, operator-visible allow at the CALLER, not here.)
 *
 * 3. ci_high > threshold
 *    → BLOCK "b14.ci_high_exceeds_threshold"
 *
 * 4. per_firm consistency_fail_rate > payout-denial threshold
 *    → BLOCK "b14.payout_denial_rate_exceeds_threshold"
 *
 * 5. ci_high <= threshold AND payout-denial ok (or absent)
 *    → PASS "b14.ci_high_within_threshold"
 *
 * @param ruinCi        The probability_of_ruin_ci dict from MC risk_metrics.
 *                      Pass null for legacy MC runs that pre-date Pass A.
 * @param pointEstimate The scalar probability_of_ruin (pre-Pass-A fallback).
 *                      Used when ruinCi is null or lacks ci_high.
 * @param threshold     Override the env-derived ci_high threshold (for tests).
 *                      When undefined, reads from env.
 */
export function evaluateB14CiGate(
  ruinCi: RuinCiDict | null | undefined,
  pointEstimate: number | null | undefined,
  threshold?: number,
): B14CiGateResult {
  const effectiveThreshold = threshold ?? getB14CiHighThreshold();
  const payoutDenialThreshold = getB14PayoutDenialThreshold();

  let ciHigh: number | null = null;
  let ciLow: number | null = null;
  let ciMethod: string | null = null;
  let nResamples: number | null = null;
  let pointEst: number | null = null;
  let legacyFallback = false;
  // Wave hardening 2026-06-22, B14 non-finite ruin guard:
  // Tracks whether MC ran but produced a non-finite estimate (NaN/Infinity from scipy BCa
  // on degenerate strategies). This is distinct from "no MC run at all" (ruinCi is null).
  // The distinction drives: corrupt-MC → fail-CLOSED; absent-MC → also fail-CLOSED (Fix F-1).
  let hadNonFiniteRuinEstimate = false;
  // Non-finite raw values surfaced in the fail-CLOSED audit payload.
  let rawNonFiniteCiHigh: number | null = null;
  let rawNonFiniteScalar: number | null = null;

  // ── Priority 0: ruin_unavailable=true (Python no-firm authoritative signal) ──
  // When Python sets ruin_unavailable=true, it means no firm models were configured
  // and the probability_of_ruin_ci has only a terminal<=0 basis. That basis is
  // categorically wrong for funded-account trading (EOD trailing DD can close the
  // account while cumulative P&L is positive). Fail-CLOSED immediately.
  if (ruinCi != null && typeof ruinCi === "object") {
    const ruinUnavailable = (ruinCi as Record<string, unknown>).ruin_unavailable;
    if (ruinUnavailable === true) {
      logger.warn(
        { threshold: effectiveThreshold },
        "B14: ruin_unavailable=true in probability_of_ruin_ci (no firm models configured) — " +
        "firm-breach ruin CI unavailable; failing CLOSED (b14.firm_breach_ruin_unavailable_fail_closed)",
      );
      return {
        passed: false,
        reason: "b14.firm_breach_ruin_unavailable_fail_closed",
        legacyFallback: true,
        auditPayload: {
          point_estimate: null,
          ci_low: null,
          ci_high: null,
          threshold: effectiveThreshold,
          blocked: true,
          legacy_ruin_scalar_fallback: true,
          ci_method: null,
          n_resamples: null,
        },
      };
    }
  }

  if (ruinCi != null && typeof ruinCi === "object") {
    // Wave hardening 2026-06-22, B14 non-finite ruin guard:
    // scipy BCa returns NaN for degenerate (near-all-zero) strategies.
    // NaN != null is true, so the bare != null check silently produced
    // ciHigh = NaN → NaN > threshold evaluates false → silent PASS.
    // Treat non-finite as missing so the scalar-fallback branch handles it.
    const rawCiHigh = ruinCi.ci_high != null ? Number(ruinCi.ci_high) : null;
    if (rawCiHigh !== null && !Number.isFinite(rawCiHigh)) {
      hadNonFiniteRuinEstimate = true;
      rawNonFiniteCiHigh = rawCiHigh;
    }
    ciHigh = Number.isFinite(rawCiHigh) ? rawCiHigh : null;
    ciLow = ruinCi.ci_low != null ? Number(ruinCi.ci_low) : null;
    ciMethod = ruinCi.ci_method ?? null;
    nResamples = ruinCi.n_resamples != null ? Number(ruinCi.n_resamples) : null;
    const rawPointEst = ruinCi.point_estimate != null ? Number(ruinCi.point_estimate) : null;
    pointEst = Number.isFinite(rawPointEst) ? rawPointEst : null;
  }

  // Fall back to scalar point estimate when ci_high is unavailable (pre-Pass-A runs).
  // Also applies when ci_high was non-finite (NaN/Infinity) from scipy BCa on degenerate data.
  if (ciHigh === null) {
    legacyFallback = true;
    // Wave hardening 2026-06-22: also finite-check the scalar fallback — a NaN scalar
    // must NOT become ciHigh (same silent-pass bug applies to the scalar path).
    const rawScalar = pointEstimate != null ? Number(pointEstimate) : null;
    if (rawScalar !== null && !Number.isFinite(rawScalar)) {
      hadNonFiniteRuinEstimate = true;
      rawNonFiniteScalar = rawScalar;
    }
    ciHigh = Number.isFinite(rawScalar) ? rawScalar : null;
    pointEst = ciHigh;
    if (ciHigh !== null) {
      // Only log the scalar-fallback warning when we actually have a scalar to use.
      logger.warn(
        { pointEstimate: ciHigh, threshold: effectiveThreshold },
        "B14 ci_high unavailable — falling back to scalar probability_of_ruin (b14.legacy_ruin_scalar_fallback)",
      );
    }
  }

  // Wave hardening 2026-06-22: fail-CLOSED when MC ran but produced only non-finite
  // ruin estimates (e.g. scipy BCa DegenerateDataWarning returns NaN for ci_high AND scalar
  // is also NaN or absent). This is NOT the same as "no MC run at all" (handled below).
  // A corrupt/degenerate ruin estimate from a real MC run is a risk signal that must BLOCK,
  // not silently pass. The outer B14 gate's "no backtest data" pass-through does not apply.
  if (ciHigh === null && hadNonFiniteRuinEstimate) {
    logger.warn(
      { rawNonFiniteCiHigh, rawNonFiniteScalar, threshold: effectiveThreshold },
      "B14 ruin estimate non-finite (NaN/Infinity from scipy BCa degenerate strategy) — failing CLOSED per Wave hardening 2026-06-22",
    );
    return {
      passed: false,
      reason: "b14.ruin_estimate_non_finite_fail_closed",
      legacyFallback: true,
      auditPayload: {
        point_estimate: null,
        ci_low: null,
        ci_high: null,
        threshold: effectiveThreshold,
        blocked: true,
        legacy_ruin_scalar_fallback: true,
        ci_method: ciMethod,
        n_resamples: nResamples,
      },
    };
  }

  // ── F-1 hardening 2026-06-22: fail-CLOSED when no ruin value is available ──
  // Previously returned passed:true with reason "b14.ci_high_unavailable_no_mc_run".
  // That was wrong: when survival cannot be proven, we BLOCK.
  // Any legacy/pre-MC grandfather must be an explicit, dated, operator-visible allow
  // at the CALLER (lifecycle-service.ts), NOT an unconditional pass in this helper.
  if (ciHigh === null) {
    logger.warn(
      { threshold: effectiveThreshold },
      "B14: no firm-breach ruin CI available and no finite scalar fallback — " +
      "failing CLOSED (b14.firm_breach_ruin_unavailable_fail_closed). " +
      "Ensure MC is run with firms=['topstep_50k','mffu_50k'] before promoting.",
    );
    return {
      passed: false,
      reason: "b14.firm_breach_ruin_unavailable_fail_closed",
      legacyFallback: true,
      auditPayload: {
        point_estimate: null,
        ci_low: null,
        ci_high: null,
        threshold: effectiveThreshold,
        blocked: true,
        legacy_ruin_scalar_fallback: true,
        ci_method: null,
        n_resamples: null,
      },
    };
  }

  // ── Ruin CI threshold check ─────────────────────────────────────────────────
  // Strict >  (not >=): ci_high exactly equal to threshold is NOT blocked.
  // Institutional convention: 0.20 means "reject strategies with GREATER THAN 20% ruin CI".
  const blocked = ciHigh > effectiveThreshold;

  if (blocked) {
    return {
      passed: false,
      reason: "b14.ci_high_exceeds_threshold",
      legacyFallback,
      auditPayload: {
        point_estimate: pointEst,
        ci_low: ciLow,
        ci_high: ciHigh,
        threshold: effectiveThreshold,
        blocked: true,
        legacy_ruin_scalar_fallback: legacyFallback,
        ci_method: ciMethod,
        n_resamples: nResamples,
      },
    };
  }

  // ── Payout-denial rate check (E — hardening 2026-06-22) ───────────────────
  // When the MC output includes per_firm.*.consistency_fail_rate, gate on the
  // worst-firm value. Topstep documents payout-denial bans for consistency
  // violations (single-day concentration > 40% of payout-window P&L).
  // consistency_fail_rate is the MC-simulated frequency of such violations.
  const perFirm = ruinCi != null && typeof ruinCi === "object"
    ? ((ruinCi as Record<string, unknown>).per_firm as Record<string, Record<string, unknown>> | null | undefined) ?? null
    : null;

  if (perFirm != null && typeof perFirm === "object") {
    let worstConsistencyFailRate: number | null = null;
    for (const firmData of Object.values(perFirm)) {
      if (firmData && typeof firmData === "object") {
        const rate = (firmData as Record<string, unknown>).consistency_fail_rate;
        if (rate != null && typeof rate === "number" && Number.isFinite(rate)) {
          if (worstConsistencyFailRate === null || rate > worstConsistencyFailRate) {
            worstConsistencyFailRate = rate;
          }
        }
      }
    }

    if (worstConsistencyFailRate !== null && worstConsistencyFailRate > payoutDenialThreshold) {
      logger.warn(
        { worstConsistencyFailRate, payoutDenialThreshold, threshold: effectiveThreshold },
        "B14 payout-denial gate BLOCKED: worst-firm consistency_fail_rate exceeds threshold " +
        "(b14.payout_denial_rate_exceeds_threshold)",
      );
      return {
        passed: false,
        reason: "b14.payout_denial_rate_exceeds_threshold",
        legacyFallback,
        auditPayload: {
          point_estimate: pointEst,
          ci_low: ciLow,
          ci_high: ciHigh,
          threshold: effectiveThreshold,
          blocked: true,
          legacy_ruin_scalar_fallback: legacyFallback,
          ci_method: ciMethod,
          n_resamples: nResamples,
          worst_consistency_fail_rate: worstConsistencyFailRate,
          payout_denial_threshold: payoutDenialThreshold,
        },
      };
    }
  }

  // ── All checks passed ───────────────────────────────────────────────────────
  return {
    passed: true,
    reason: "b14.ci_high_within_threshold",
    legacyFallback,
    auditPayload: {
      point_estimate: pointEst,
      ci_low: ciLow,
      ci_high: ciHigh,
      threshold: effectiveThreshold,
      blocked: false,
      legacy_ruin_scalar_fallback: legacyFallback,
      ci_method: ciMethod,
      n_resamples: nResamples,
    },
  };
}
