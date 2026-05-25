/**
 * wfe-gate.ts — Wave 27.5 Pass B.2 (paper-parity)
 *
 * Pure-function Walk-Forward Efficiency (WFE) gate.
 *
 * Pass B.1 (backtest-core) emits `backtests.walk_forward_metadata.wfe_overall`
 * as the aggregate OOS/IS Sharpe ratio across all walk-forward windows.
 *
 * Institutional 2026 standard:
 *   wfe_overall >= WFE_HARD_FLOOR (0.70) → passes
 *   WFE_WARN_FLOOR (0.50) <= wfe_overall < WFE_HARD_FLOOR → warn (allow)
 *   wfe_overall < WFE_WARN_FLOOR (0.50) → BLOCK
 *   wfe_overall null (legacy pre-Pass-B.1) → allow, emit legacy audit
 *
 * Env overrides:
 *   WFE_HARD_FLOOR  (default "0.70") — below this value, block promotion
 *   WFE_WARN_FLOOR  (default "0.50") — below this value but above 0, warn only
 *
 * Exported pure functions have no DB access or side effects.
 */

import { logger } from "./logger.js";

export type WfeGateStatus =
  | "passed"          // wfe_overall >= WFE_HARD_FLOOR
  | "warned"          // WFE_WARN_FLOOR <= wfe_overall < WFE_HARD_FLOOR
  | "blocked"         // wfe_overall < WFE_WARN_FLOOR
  | "legacy_null";    // wfe_overall not available (pre-Pass-B.1 backtest)

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
    | "lifecycle.wfe_warning_below_target"
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
 *                    Pass null for legacy backtests pre-Pass-B.1.
 * @param hardFloor   Override env-derived WFE_HARD_FLOOR (for tests).
 * @param warnFloor   Override env-derived WFE_WARN_FLOOR (for tests).
 */
export function evaluateWfeGate(
  wfeOverall: number | null | undefined,
  hardFloor?: number,
  warnFloor?: number,
): WfeGateResult {
  const effectiveHardFloor = hardFloor ?? getWfeHardFloor();
  const effectiveWarnFloor = warnFloor ?? getWfeWarnFloor();

  // Legacy path — wfe_overall not available (pre-Pass-B.1 backtest)
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

  if (wfe >= effectiveWarnFloor) {
    // Between warn floor and hard floor — allow but emit warning
    return {
      status: "warned",
      passed: true,
      wfeOverall: wfe,
      hardFloor: effectiveHardFloor,
      warnFloor: effectiveWarnFloor,
      auditAction: "lifecycle.wfe_warning_below_target",
    };
  }

  // Below warn floor — hard block
  return {
    status: "blocked",
    passed: false,
    wfeOverall: wfe,
    hardFloor: effectiveHardFloor,
    warnFloor: effectiveWarnFloor,
    auditAction: "lifecycle.wfe_hard_floor_block",
  };
}
