/**
 * bif-gate.ts — Wave 3 Track 3B (paper-parity)
 *
 * Pure-function BIF (Bias Information Factor) promotion gate.
 *
 * The Python WF result carries two fields:
 *   `bif`   (float) — Bias Information Factor; quantifies overfitting bias in the
 *                     IS→OOS transfer.  Lower is better.  Derived from the
 *                     expected IS/OOS performance gap, normalised by parameter count.
 *   `k_eff` (float) — Effective parameter count; companion metric surfaced in the
 *                     audit payload for operator inspection.
 *
 * Gate semantics (priority order):
 *
 *   1. bif === null / undefined (pre-Wave-3 backtests)
 *      → legacyNull=true, passed=true, reason "bif.legacy_null_pre_wave3"
 *      → documented grandfather warn; NEVER block on missing data.
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
   * field).  Gate is ALWAYS passed=true when legacyNull=true — NEVER block on
   * missing data.  Caller should surface a grandfather warn in the audit log.
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
  };
}

// ── Gate evaluator ────────────────────────────────────────────────────────────

/**
 * Evaluate the BIF gate.
 *
 * @param bif   Bias Information Factor from Python WF result (`result.bif`).
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
  },
): BifGateResult {
  const warnThreshold = opts?.warnThreshold ?? getBifWarnThreshold();
  const blockThreshold = opts?.blockThreshold ?? getBifBlockThreshold();

  const bifNum = bif != null && Number.isFinite(Number(bif)) ? Number(bif) : null;
  const kEffNum = kEff != null && Number.isFinite(Number(kEff)) ? Number(kEff) : null;

  // ── 1. Legacy null — pre-Wave-3 backtest; bif field never emitted ──────────
  // NEVER block on missing data.  Grandfather window: every fresh WF run since
  // Wave 3 will emit `bif` and `k_eff`.
  if (bifNum === null) {
    logger.warn(
      { k_eff: kEffNum, warnThreshold, blockThreshold },
      "BIF gate: bif absent — pre-Wave-3 backtest; proceeding with legacy grandfather warn (bif.legacy_null_pre_wave3)",
    );
    return {
      passed: true,
      reason: "bif.legacy_null_pre_wave3",
      legacyNull: true,
      auditPayload: {
        bif: null,
        k_eff: kEffNum,
        warn_threshold: warnThreshold,
        block_threshold: blockThreshold,
        blocked: false,
        legacy_null: true,
        reason: "bif.legacy_null_pre_wave3",
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
    },
  };
}
