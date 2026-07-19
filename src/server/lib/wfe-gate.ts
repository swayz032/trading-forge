/**
 * wfe-gate.ts — Wave 27.5 Pass B.2 (paper-parity)
 *
 * Pure-function Walk-Forward Efficiency (WFE) gate.
 *
 * Pass B.1 (backtest-core) emits `backtests.walkForwardResults.wfe_overall`
 * (Drizzle column `walkForwardResults` = DB column `walk_forward_results`)
 * as the aggregate OOS/IS Sharpe ratio across all walk-forward windows.
 *
 * D7 (deep-scan #22, 2026-07-06): docstring corrected from the non-existent
 * `walk_forward_metadata.wfe_overall` — every real reader in lifecycle-service.ts
 * reads `latestBt.walkForwardResults.wfe_overall`.
 *
 * Institutional 2026 standard (aligned to CLAUDE.md §12 — parity fix 2026-06-22):
 *   wfe_overall >= WFE_HARD_FLOOR (0.70) → PASS
 *   wfe_overall <  WFE_HARD_FLOOR (0.70) → BLOCK (status="blocked", passed=false)
 *     — this includes the former "warn band" [0.50, 0.70).
 *     — emits lifecycle.wfe_hard_floor_block in all blocked cases.
 *   wfe_overall null (legacy pre-Pass-B.1) → BLOCK (status="legacy_null", passed=false)
 *     — hardened 2026-07-12 (85e1500b, operator commit "Harden validation promotion
 *       gates"): required fresh CPCV/WF evidence before TESTING → PAPER and blocked
 *       WFE (among BIF/DSR/parameter-drift/PBO/B14/slippage-survival) when
 *       unavailable or incomplete. A pre-Pass-B.1 backtest with no WFE measurement
 *       is unmeasured overfitting risk, not a free pass. This SUPERSEDES the
 *       original "grandfather pass" design below this docstring's older passes —
 *       do not revert to passed=true without a new operator ratification.
 *     EXCEPTION: wfe_status="degenerate_is" (G2a hardening 2026-06-22) — see below.
 *
 * Wave hardening 2026-06-22 (G2a) — degenerate IS contract:
 *   When walk_forward.py runs a full WF but IS windows produce non-positive /
 *   absent Sharpe, it emits wfe_overall=0.0 AND wfe_status="degenerate_is".
 *   This gate MUST read the wfe_status field FIRST to distinguish:
 *     - wfe_status="degenerate_is" → BLOCK (lifecycle.wfe_degenerate_is_block),
 *       regardless of wfe_overall value.  NOT a legacy null.
 *     - wfe_overall undefined/null AND wfe_status absent/undefined → genuine legacy
 *       (pre-W27.5 backtests where the key was never written) → BLOCK per the
 *       2026-07-12 hardening above (85e1500b) — no longer a grandfather pass.
 *
 * CPCV real-IS contract (deep-scan #9 FIX K 2026-07-02; X5 ratified 2026-07-09):
 *   When walk_forward.py runs CPCV mode AND a per-path IS basis is available, it
 *   emits a REAL numeric wfe_overall with wfe_status ∈ {"cpcv_combined_fold"
 *   (current — symmetric combined-fold OOS/IS), "cpcv_per_path_is" (legacy
 *   asymmetric per-path-average, accepted for backward-compat only)}.  Both are
 *   distinct from "cpcv_not_applicable" (IS unavailable → gate exempt).  The gate
 *   ENFORCES the same WFE_HARD_FLOOR as plain-WF and surfaces wfeBasis=<status>
 *   in the result for audit traceability.
 *
 * NOTE on WFE_WARN_FLOOR: The floor is retained as a named constant and env knob
 * so callers can observe how deep below the hard floor a strategy is, but it no
 * longer controls a "warn-and-allow" path. Any value below WFE_HARD_FLOOR blocks.
 *
 * The "warned" WfeGateStatus variant is preserved in the union for backward
 * compatibility with any serialized audit_log rows; it is never returned at runtime.
 *
 * Env overrides:
 *   WFE_HARD_FLOOR  (default "0.70") — below this value, block promotion
 *   WFE_WARN_FLOOR  (default "0.50") — informational lower reference; no longer gates
 *
 * Exported pure functions have no DB access or side effects.
 */

import { logger } from "./logger.js";

export type WfeGateStatus =
  | "passed"              // wfe_overall >= WFE_HARD_FLOOR
  | "warned"              // DEPRECATED — never returned at runtime post-2026-06-22 fix;
                          // retained for backward-compat with serialized audit_log rows only
  | "blocked"             // wfe_overall < WFE_HARD_FLOOR (includes former "warn band")
  | "degenerate_is_block" // wfe_status="degenerate_is" from producer (G2a hardening 2026-06-22)
  | "legacy_null"         // wfe_overall key absent (pre-Pass-B.1 backtest) → BLOCK (85e1500b hardening 2026-07-12)
  | "cpcv_exempt";        // wfe_status="cpcv_not_applicable" → CPCV mode; WFE unmeasured → BLOCK (85e1500b hardening 2026-07-12)

export interface WfeGateResult {
  status: WfeGateStatus;
  /** True when the gate allows promotion. */
  passed: boolean;
  wfeOverall: number | null;
  hardFloor: number;
  warnFloor: number;
  /** Audit action name to record. */
  auditAction:
    | "lifecycle.wfe_hard_floor_block"
    | "lifecycle.wfe_degenerate_is_block"   // G2a hardening 2026-06-22: IS windows produced no positive Sharpe
    | "lifecycle.wfe_warning_below_target"  // DEPRECATED — no longer returned at runtime (2026-06-22 parity fix)
    | "lifecycle.wfe_unavailable_legacy"
    | "lifecycle.wfe_cpcv_exempt"           // CPCV mode: WFE formula is not applicable; PASS with distinct audit
    | null; // null = passes, no audit needed for happy path (optional caller choice)
  /**
   * Identifies the WFE computation basis when the producer used a non-standard evaluation
   * path.  Present only when wfe_status was a known CPCV variant; undefined on plain-WF,
   * legacy-null, and degenerate-IS paths.  Callers that write audit rows should include
   * this field so the evaluation basis is traceable.
   *
   * Deep-scan #9 FIX K (2026-07-02): populated for wfe_status="cpcv_per_path_is".
   */
  wfeBasis?: string;
}

function parseFloorEnv(key: string, defaultVal: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw === "") return defaultVal;
  const parsed = parseFloat(raw);
  if (isNaN(parsed) || parsed < 0 || parsed > 10) {
    logger.warn({ key, raw, defaulted: defaultVal }, `${key} is invalid — using default ${defaultVal}`);
    return defaultVal;
  }
  return parsed;
}

/** Read WFE_HARD_FLOOR from env. Exported for test overrides. */
export function getWfeHardFloor(): number {
  return parseFloorEnv("WFE_HARD_FLOOR", 0.70);
}

/** Read WFE_WARN_FLOOR from env. Exported for test overrides. */
export function getWfeWarnFloor(): number {
  return parseFloorEnv("WFE_WARN_FLOOR", 0.50);
}

/**
 * Evaluate the WFE gate.
 *
 * @param wfeOverall  Value of backtests.walkForwardResults.wfe_overall.
 *                    Pass null/undefined for legacy backtests pre-Pass-B.1 WHERE
 *                    the key is genuinely absent.
 * @param hardFloor   Override env-derived WFE_HARD_FLOOR (for tests).
 * @param warnFloor   Override env-derived WFE_WARN_FLOOR (for tests).
 * @param wfeStatus   Value of backtests.walkForwardResults.wfe_status.
 *                    When "degenerate_is" the gate BLOCKS regardless of wfeOverall
 *                    (G2a hardening 2026-06-22 — producer emits 0.0 + "degenerate_is"
 *                    when IS windows yield non-positive / absent Sharpe; this MUST NOT
 *                    be treated as a legacy null / grandfather pass).
 *                    When "cpcv_combined_fold" (X5 ratified 2026-07-09) or the legacy
 *                    "cpcv_per_path_is" the gate ENFORCES the same hard floor as plain-WF
 *                    (CPCV ran with a real IS basis; wfe_overall is a real value and must
 *                    be evaluated).
 */
export function evaluateWfeGate(
  wfeOverall: number | null | undefined,
  hardFloor?: number,
  warnFloor?: number,
  wfeStatus?: string | null,
): WfeGateResult {
  const effectiveHardFloor = hardFloor ?? getWfeHardFloor();
  const effectiveWarnFloor = warnFloor ?? getWfeWarnFloor();

  // CPCV-exempt path (hardening/phase-0): walk_forward.py emits wfe_status="cpcv_not_applicable"
  // when the run used Combinatorial Purged Cross-Validation (mode="cpcv").  In CPCV mode the
  // WFE ratio (OOS/IS Sharpe) is structurally undefined — CPCV has no single IS window to
  // compare against.  This is NOT a legacy null (wfe_overall was deliberately set to None/null
  // by the producer) and NOT a degenerate IS failure.  Hardened 2026-07-12 (85e1500b): the
  // gate BLOCKS with a DISTINCT audit action — unmeasured WFE is unmeasured overfitting risk,
  // not a free pass, even though it's visible/auditable as its own status.
  if (wfeStatus === "cpcv_not_applicable") {
    return {
      status: "cpcv_exempt",
      passed: false,
      wfeOverall: null,
      hardFloor: effectiveHardFloor,
      warnFloor: effectiveWarnFloor,
      auditAction: "lifecycle.wfe_cpcv_exempt",
    };
  }

  // Wave hardening 2026-06-22 (G2a) — degenerate IS path: producer signals that WF
  // ran but IS Sharpe was non-positive / absent.  This is a DISTINCT state from a
  // legacy null (key truly absent).  BLOCK here; never grandfather-pass.
  if (wfeStatus === "degenerate_is") {
    return {
      status: "degenerate_is_block",
      passed: false,
      wfeOverall: wfeOverall != null ? Number(wfeOverall) : null,
      hardFloor: effectiveHardFloor,
      warnFloor: effectiveWarnFloor,
      auditAction: "lifecycle.wfe_degenerate_is_block",
    };
  }

  // Deep-scan #9 FIX K (2026-07-02) — CPCV real-IS path:
  // walk_forward.py CPCV mode emits a CPCV IS-basis status + a real numeric
  // wfe_overall.  Two accepted status strings (both enforce the hard floor):
  //   - "cpcv_combined_fold" (X5 RATIFIED 2026-07-09) — symmetric combined-fold
  //     OOS Sharpe / combined-fold IS Sharpe (pooled per-path IS daily P&L).
  //     This is the current producer output and the institutional contract.
  //   - "cpcv_per_path_is" (deep-scan #9, pre-ratification) — asymmetric
  //     per-path-average IS denominator.  Kept accepted for backward-compat with
  //     any in-flight backtest or serialized audit_log row emitted before the
  //     X5 ratification; new runs never emit it.
  // Both are distinct from "cpcv_not_applicable" (no per-path IS → gate exempt)
  // and "degenerate_is" (WF ran but IS non-positive → hard block regardless).
  // ENFORCE the same WFE_HARD_FLOOR as plain-WF; surface wfeBasis=<actual status>
  // so callers record the true evaluation basis in audit rows.
  if (wfeStatus === "cpcv_combined_fold" || wfeStatus === "cpcv_per_path_is") {
    if (wfeOverall == null) {
      // Fail-closed: producer claimed a CPCV IS basis but emitted no wfe_overall — BLOCK.
      return {
        status: "blocked",
        passed: false,
        wfeOverall: null,
        hardFloor: effectiveHardFloor,
        warnFloor: effectiveWarnFloor,
        wfeBasis: wfeStatus,
        auditAction: "lifecycle.wfe_hard_floor_block",
      };
    }
    const wfeCpcv = Number(wfeOverall);
    if (wfeCpcv >= effectiveHardFloor) {
      return {
        status: "passed",
        passed: true,
        wfeOverall: wfeCpcv,
        hardFloor: effectiveHardFloor,
        warnFloor: effectiveWarnFloor,
        wfeBasis: wfeStatus,
        auditAction: null,
      };
    }
    // Below hard floor — BLOCK.  Same audit action as plain-WF; wfeBasis distinguishes
    // the evaluation path for lifecycle audit rows.
    return {
      status: "blocked",
      passed: false,
      wfeOverall: wfeCpcv,
      hardFloor: effectiveHardFloor,
      warnFloor: effectiveWarnFloor,
      wfeBasis: wfeStatus,
      auditAction: "lifecycle.wfe_hard_floor_block",
    };
  }

  // Missing WFE cannot authorize a fresh promotion.
  if (wfeOverall == null) {
    return {
      status: "legacy_null",
      passed: false,
      wfeOverall: null,
      hardFloor: effectiveHardFloor,
      warnFloor: effectiveWarnFloor,
      auditAction: "lifecycle.wfe_unavailable_legacy",
    };
  }

  const wfe = Number(wfeOverall);

  if (wfe >= effectiveHardFloor) {
    // Happy path — no audit needed, but we surface the status for the caller
    return {
      status: "passed",
      passed: true,
      wfeOverall: wfe,
      hardFloor: effectiveHardFloor,
      warnFloor: effectiveWarnFloor,
      auditAction: null,
    };
  }

  // Below hard floor (includes the former "warn band" [WFE_WARN_FLOOR, WFE_HARD_FLOOR)) —
  // HARD BLOCK per institutional 2026 standard documented in CLAUDE.md §12.
  // Parity fix 2026-06-22: the [0.50, 0.70) band previously returned passed=true ("warned");
  // that allowed strategies with WFE up to 0.699 to promote, contradicting the documented floor.
  return {
    status: "blocked",
    passed: false,
    wfeOverall: wfe,
    hardFloor: effectiveHardFloor,
    warnFloor: effectiveWarnFloor,
    auditAction: "lifecycle.wfe_hard_floor_block",
  };
}
