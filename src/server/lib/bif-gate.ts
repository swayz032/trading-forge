/**
 * bif-gate.ts — Wave 3 Track 3B (paper-parity)
 *
 * Pure-function BIF (Backtest Inflation Factor) promotion gate.
 *
 * The Python WF result carries two fields:
 *   `bif`   (float) — Backtest Inflation Factor; quantifies overfitting bias in the
 *                     IS→OOS transfer.  Lower is better.  Derived from the
 *                     expected IS/OOS performance gap, normalised by parameter count.
 *   `k_eff` (float) — Effective parameter count; companion metric surfaced in the
 *                     audit payload for operator inspection.
 *
 * Gate semantics (priority order):
 *
 *   1. bif === null / undefined (pre-Wave-3 backtests)
 *      → legacyNull=true, passed=false, reason "bif.legacy_null_pre_wave3"
 *      → HARD BLOCK. Hardened 2026-07-12 (85e1500b, operator commit "Harden
 *        validation promotion gates"): the pipeline must fail closed on stale,
 *        missing, malformed, or unmeasured promotion evidence. A pre-Wave-3
 *        backtest with no BIF measurement is unmeasured overfitting risk, not a
 *        free pass — require a fresh BIF result before promoting. This replaced
 *        the original Wave-3 grandfather-pass design; do not revert to
 *        passed=true without a new operator ratification (see gate-contract
 *        siblings wfe-gate.ts / parameter-drift-gate.ts / pbo-gate.ts, all
 *        hardened in the same commit).
 *
 *   2. bif > BIF_BLOCK_THRESHOLD (default 4.0)
 *      → passed=false, reason "bif.blocked_exceeds_threshold"
 *      → HARD block.  Synthetic overfit: IS edge does not transfer to OOS.
 *
 *   3. BIF_WARN_THRESHOLD < bif ≤ BIF_BLOCK_THRESHOLD (default 2.0–4.0 band)
 *      → passed=true, reason "bif.warn_above_warn_threshold"
 *      → SOFT warn: elevated overfitting bias; promotion allowed with audit trace.
 *
 *   4. bif ≤ BIF_WARN_THRESHOLD (default ≤ 2.0)
 *      → passed=true, reason "bif.clean"
 *      → Clean pass; no overfitting concern.
 *
 * Convention: strict > (not ≥) for block threshold — bif exactly equal to
 * BIF_BLOCK_THRESHOLD is NOT blocked (same as B14 ci_high convention).
 *
 * Env overrides:
 *   BIF_WARN_THRESHOLD  (default "2.0") — warn band lower bound
 *   BIF_BLOCK_THRESHOLD (default "4.0") — hard-block threshold
 *
 * Exported pure functions have no DB access or side effects.
 */

import { logger } from "./logger.js";

// ── Threshold env helpers ─────────────────────────────────────────────────────

/**
 * Read BIF_WARN_THRESHOLD from env.
 * Default 2.0 — below this value, BIF is clean.
 * Exported for tests.
 */
export function getBifWarnThreshold(): number {
  const raw = process.env.BIF_WARN_THRESHOLD;
  if (raw === undefined || raw === "") return 2.0;
  const parsed = parseFloat(raw);
  if (isNaN(parsed) || parsed < 0) {
    logger.warn(
      { raw, defaulted: 2.0 },
      "BIF_WARN_THRESHOLD is invalid — using default 2.0",
    );
    return 2.0;
  }
  return parsed;
}

/**
 * Read BIF_BLOCK_THRESHOLD from env.
 * Default 4.0 — bif > this value triggers a HARD block.
 * Exported for tests.
 */
export function getBifBlockThreshold(): number {
  const raw = process.env.BIF_BLOCK_THRESHOLD;
  if (raw === undefined || raw === "") return 4.0;
  const parsed = parseFloat(raw);
  if (isNaN(parsed) || parsed < 0) {
    logger.warn(
      { raw, defaulted: 4.0 },
      "BIF_BLOCK_THRESHOLD is invalid — using default 4.0",
    );
    return 4.0;
  }
  return parsed;
}

// ── Result shape ──────────────────────────────────────────────────────────────

export interface BifGateResult {
  /** True when the gate allows promotion; false when it blocks. */
  passed: boolean;
  /** Human-readable reason string for the audit row. */
  reason: string;
  /**
   * True when bif was null/undefined (pre-Wave-3 backtest that never emitted the
   * field).  Gate is passed=false when legacyNull=true (hardened 2026-07-12,
   * 85e1500b) — unmeasured BIF blocks promotion until a fresh result is present.
   * Caller should surface the block reason in the audit log.
   */
  legacyNull: boolean;
  /** Full audit payload — merge into the audit_log result field. */
  auditPayload: {
    bif: number | null;
    k_eff: number | null;
    warn_threshold: number;
    block_threshold: number;
    blocked: boolean;
    legacy_null: boolean;
    reason: string;
    /**
     * M1 fix 2026-06-28: present when bif_proxy_basis="oos_mean_not_is" was
     * flagged by walk_forward.py.  NON-BLOCKING — documents that CPCV BIF ≈ 1.0
     * because IS proxy and WF agg_sharpe both derive from the same OOS series.
     * Wave 30 carry-forward: true per-path IS fold Sharpe will replace the proxy.
     */
    proxy_basis_warn?: string | null;
    /**
     * Present when bif_reliable=false was flagged by walk_forward.py (hardening/phase-0).
     * The BIF value is structurally ~1.0 due to CPCV OOS-only measurement; it is NOT a
     * real IS-vs-OOS evaluation. Audit-visible; gate always passes.
     */
    cpcv_unmeasured?: boolean;
    /** deep-scan L-2: present when compute_bif() threw and the gate failed CLOSED (not grandfathered). */
    computation_error?: boolean;
  };
}

// ── Gate evaluator ────────────────────────────────────────────────────────────

/**
 * Evaluate the BIF gate.
 *
 * @param bif   Backtest Inflation Factor from Python WF result (`result.bif`).
 *              Pass null / undefined for pre-Wave-3 backtests.
 * @param kEff  Effective parameter count from Python WF result (`result.k_eff`).
 *              Surfaced in the audit payload; does not affect the pass/block decision.
 * @param opts  Optional threshold overrides (primarily for tests).
 */
export function evaluateBifGate(
  bif: number | null | undefined,
  kEff: number | null | undefined,
  opts?: {
    warnThreshold?: number;
    blockThreshold?: number;
    /**
     * M1 fix 2026-06-28: bif_proxy_basis from walk_forward.py wf_metadata.
     * When "oos_mean_not_is", emits a NON-BLOCKING audit warn (bif.proxy_basis_oos_mean)
     * because CPCV BIF ≈ 1.0 — IS proxy and WF agg_sharpe both derive from OOS data.
     * Does NOT change the passed/blocked verdict.
     */
    proxyBasis?: string | null;
    /**
     * CPCV-unmeasured flag (hardening/phase-0): walk_forward.py emits bif_reliable=false
     * in wf_metadata when mode="cpcv". In CPCV mode the BIF IS-Sharpe proxy and OOS
     * agg_sharpe both derive from the same OOS series → BIF ≈ 1.0 structurally, not
     * from a real IS evaluation. When bifReliable===false the gate returns a DISTINCT
     * status ("bif.cpcv_unmeasured") so the audit row is visible and distinguishable
     * from a genuine clean pass. Gate ALWAYS passed=true when bifReliable===false —
     * do NOT block on a measurement-limitation.
     */
    bifReliable?: boolean | null;
    /**
     * deep-scan promotion L-2 (HIGH, 2026-07-06): walk_forward.py now emits `bif_computation_error=true` when
     * compute_bif() actually THREW (vs a genuine pre-Wave-3 backtest that never emitted `bif` at all). A real
     * computation failure must FAIL CLOSED (like WFE degenerate_is / PBO worst-case / parameter-drift
     * classifier_error) — NOT be grandfathered as legacy-null. Pass the Python flag here.
     */
    computationError?: boolean | null;
  },
): BifGateResult {
  const warnThreshold = opts?.warnThreshold ?? getBifWarnThreshold();
  const blockThreshold = opts?.blockThreshold ?? getBifBlockThreshold();

  const bifNum = bif != null && Number.isFinite(Number(bif)) ? Number(bif) : null;
  const kEffNum = kEff != null && Number.isFinite(Number(kEff)) ? Number(kEff) : null;

  // M1 fix 2026-06-28: non-blocking proxy-basis warn.
  // When CPCV mode emits bif_proxy_basis="oos_mean_not_is", the IS Sharpe proxy
  // and agg_sharpe both derive from the same OOS series → BIF ≈ 1.0 always.
  // Emit a warn so operators know the BIF gate is structurally near-no-op in
  // CPCV mode.  NEVER changes the passed/blocked verdict.
  const proxyBasisWarn: string | null =
    opts?.proxyBasis === "oos_mean_not_is" ? "bif.proxy_basis_oos_mean" : null;
  if (proxyBasisWarn !== null) {
    logger.warn(
      { bif: bifNum, k_eff: kEffNum, proxyBasis: opts?.proxyBasis },
      "BIF gate: CPCV proxy-basis warn — IS sharpe proxy derived from OOS series " +
        "(bif.proxy_basis_oos_mean); BIF ≈ 1.0 in default CPCV mode (Wave 30 carry-forward: true IS fold Sharpe)",
    );
  }

  // ── 0. CPCV-unmeasured path (hardening/phase-0) ────────────────────────────
  // walk_forward.py emits bif_reliable=false in wf_metadata when mode="cpcv".
  // BIF ≈ 1.0 structurally (IS proxy and OOS agg_sharpe both from OOS series) —
  // NOT a real IS-vs-OOS comparison. Return a DISTINCT status so the audit row
  // ("bif.cpcv_unmeasured") is visible and distinguishable from a genuine bif.clean.
  // A structural measurement limitation cannot authorize promotion.
  if (opts?.bifReliable === false) {
    logger.warn(
      { bif: bifNum, k_eff: kEffNum },
      "BIF gate: bif_reliable=false (CPCV mode) — BIF is structurally unmeasured (IS proxy = OOS mean); " +
        "blocking promotion with distinct audit (bif.cpcv_unmeasured)",
    );
    return {
      passed: false,
      reason: "bif.cpcv_unmeasured",
      legacyNull: false,
      auditPayload: {
        bif: bifNum,
        k_eff: kEffNum,
        warn_threshold: warnThreshold,
        block_threshold: blockThreshold,
        blocked: true,
        legacy_null: false,
        reason: "bif.cpcv_unmeasured",
        proxy_basis_warn: proxyBasisWarn,
        cpcv_unmeasured: true,
      },
    };
  }

  // ── 0b. Computation error — compute_bif() THREW (deep-scan L-2) ────────────
  // Distinct from legacy-null: this is a MODERN backtest whose BIF computation failed. It must FAIL CLOSED
  // (block promotion) — the same fail-safe contract the sibling gates use (WFE degenerate_is, PBO worst-case
  // 1.0, parameter-drift classifier_error). Grandfathering it as legacy-null would be a silent fail-OPEN on a
  // real error, the exact bug this closes.
  if (opts?.computationError === true) {
    logger.error(
      { bif: bifNum, k_eff: kEffNum },
      "BIF gate: bif_computation_error=true (compute_bif threw) — FAIL CLOSED (bif.computation_error_fail_closed); " +
        "NOT grandfathered. Investigate the walk_forward BIF path for this backtest.",
    );
    return {
      passed: false,
      reason: "bif.computation_error_fail_closed",
      legacyNull: false,
      auditPayload: {
        bif: null,
        k_eff: kEffNum,
        warn_threshold: warnThreshold,
        block_threshold: blockThreshold,
        blocked: true,
        legacy_null: false,
        reason: "bif.computation_error_fail_closed",
        proxy_basis_warn: proxyBasisWarn,
        computation_error: true,
      },
    };
  }

  // ── 1. Legacy null — pre-Wave-3 backtest; bif field never emitted ──────────
  // Missing BIF evidence cannot authorize a fresh promotion.
  if (bifNum === null) {
    logger.warn(
      { k_eff: kEffNum, warnThreshold, blockThreshold },
      "BIF gate: bif absent — blocking promotion until a fresh BIF result is present (bif.legacy_null_pre_wave3)",
    );
    return {
      passed: false,
      reason: "bif.legacy_null_pre_wave3",
      legacyNull: true,
      auditPayload: {
        bif: null,
        k_eff: kEffNum,
        warn_threshold: warnThreshold,
        block_threshold: blockThreshold,
        blocked: true,
        legacy_null: true,
        reason: "bif.legacy_null_pre_wave3",
        proxy_basis_warn: proxyBasisWarn,
      },
    };
  }

  // ── 2. Hard block — bif exceeds block threshold ────────────────────────────
  // Strict > (not ≥): bif exactly equal to blockThreshold is NOT blocked.
  if (bifNum > blockThreshold) {
    logger.warn(
      { bif: bifNum, k_eff: kEffNum, blockThreshold },
      "BIF gate: BLOCKED — bif exceeds block threshold (synthetic overfit; IS edge does not transfer to OOS) — bif.blocked_exceeds_threshold",
    );
    return {
      passed: false,
      reason: "bif.blocked_exceeds_threshold",
      legacyNull: false,
      auditPayload: {
        bif: bifNum,
        k_eff: kEffNum,
        warn_threshold: warnThreshold,
        block_threshold: blockThreshold,
        blocked: true,
        legacy_null: false,
        reason: "bif.blocked_exceeds_threshold",
        proxy_basis_warn: proxyBasisWarn,
      },
    };
  }

  // ── 3. Warn band — bif above warn threshold but below block threshold ───────
  // Elevated overfitting bias: operator-visible WARN; promotion allowed.
  if (bifNum > warnThreshold) {
    logger.warn(
      { bif: bifNum, k_eff: kEffNum, warnThreshold, blockThreshold },
      "BIF gate: WARN — bif in warn band (elevated overfitting bias; below hard-block) — bif.warn_above_warn_threshold",
    );
    return {
      passed: true,
      reason: "bif.warn_above_warn_threshold",
      legacyNull: false,
      auditPayload: {
        bif: bifNum,
        k_eff: kEffNum,
        warn_threshold: warnThreshold,
        block_threshold: blockThreshold,
        blocked: false,
        legacy_null: false,
        reason: "bif.warn_above_warn_threshold",
        proxy_basis_warn: proxyBasisWarn,
      },
    };
  }

  // ── 4. Clean pass — bif within acceptable range ────────────────────────────
  return {
    passed: true,
    reason: "bif.clean",
    legacyNull: false,
    auditPayload: {
      bif: bifNum,
      k_eff: kEffNum,
      warn_threshold: warnThreshold,
      block_threshold: blockThreshold,
      blocked: false,
      legacy_null: false,
      reason: "bif.clean",
      proxy_basis_warn: proxyBasisWarn,
    },
  };
}
