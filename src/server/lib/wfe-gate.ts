/**
 * wfe-gate.ts — Wave 27.5 Pass B.2 (paper-parity)
 *
 * Pure-function Walk-Forward Efficiency (WFE) gate.
 *
 * Pass B.1 (backtest-core) emits `backtests.walk_forward_metadata.wfe_overall`
 * as the aggregate OOS/IS Sharpe ratio across all walk-forward windows.
 *
 * Institutional 2026 standard (aligned to CLAUDE.md §12 — parity fix 2026-06-22):
 *   wfe_overall >= WFE_HARD_FLOOR (0.70) → PASS
 *   wfe_overall <  WFE_HARD_FLOOR (0.70) → BLOCK (status="blocked", passed=false)
 *     — this includes the former "warn band" [0.50, 0.70).
 *     — emits lifecycle.wfe_hard_floor_block in all blocked cases.
 *   wfe_overall null (legacy pre-Pass-B.1) → PASS, emit legacy audit
 *     EXCEPTION: wfe_status="degenerate_is" (G2a hardening 2026-06-22) — see below.
 *
 * Wave hardening 2026-06-22 (G2a) — degenerate IS contract:
 *   When walk_forward.py runs a full WF but IS windows produce non-positive /
 *   absent Sharpe, it emits wfe_overall=0.0 AND wfe_status="degenerate_is".
 *   This gate MUST read the wfe_status field FIRST to distinguish:
 *     - wfe_status="degenerate_is" → BLOCK (lifecycle.wfe_degenerate_is_block),
 *       regardless of wfe_overall value.  NOT a legacy null.
 *     - wfe_overall undefined/null AND wfe_status absent/undefined → genuine legacy
 *       (pre-W27.5 backtests where the key was never written) → grandfather pass.
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
  | "legacy_null";        // wfe_overall key absent (pre-Pass-B.1 backtest) → grandfather pass

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
    | null; // null = passes, no audit needed for happy path (optional caller choice)
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
 * @param wfeOverall  Value of backtests.walk_forward_metadata.wfe_overall.
 *                    Pass null/undefined for legacy backtests pre-Pass-B.1 WHERE
 *                    the key is genuinely absent.
 * @param hardFloor   Override env-derived WFE_HARD_FLOOR (for tests).
 * @param warnFloor   Override env-derived WFE_WARN_FLOOR (for tests).
 * @param wfeStatus   Value of backtests.walk_forward_metadata.wfe_status.
 *                    When "degenerate_is" the gate BLOCKS regardless of wfeOverall
 *                    (G2a hardening 2026-06-22 — producer emits 0.0 + "degenerate_is"
 *                    when IS windows yield non-positive / absent Sharpe; this MUST NOT
 *                    be treated as a legacy null / grandfather pass).
 */
export function evaluateWfeGate(
  wfeOverall: number | null | undefined,
  hardFloor?: number,
  warnFloor?: number,
  wfeStatus?: string | null,
): WfeGateResult {
  const effectiveHardFloor = hardFloor ?? getWfeHardFloor();
  const effectiveWarnFloor = warnFloor ?? getWfeWarnFloor();

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

  // Legacy path — wfe_overall key genuinely absent (pre-Pass-B.1 backtest).
  // Only reached when wfeStatus is NOT "degenerate_is" (checked above).
  if (wfeOverall == null) {
    return {
      status: "legacy_null",
      passed: true,
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
