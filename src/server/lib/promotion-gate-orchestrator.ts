/**
 * promotion-gate-orchestrator.ts — Wave 26 Pass G Pass E
 *
 * Orchestrates all 5 institutional promotion gates for PAPER → DEPLOY_READY.
 *
 * Gates evaluated (AND logic — ALL must pass):
 *   1. B14 ci_high   — P(ruin) conservative bound < 0.40 (Wave 27.5 Pass B)
 *   2. WFE ≥ 0.80    — Walk-Forward Efficiency floor lifted from 0.70 (Pass E)
 *   3. CPCV n_paths ≥ 15 — minimum combinatorial paths for OOS confidence
 *   4. WRC p < 0.05  — White's Reality Check data-snooping guard
 *   5. SPA p < 0.05  — Hansen's SPA (spa_consistent_p) stronger test
 *
 * Contract:
 *   - Read-only against existing DB data (no new computations triggered)
 *   - When ANY gate fails, writes audit `promotion.gate_failed`
 *   - When ALL pass, writes audit `promotion.gates_cleared`
 *   - Does NOT auto-promote — returns can_promote=true for operator/cron to act
 *   - Callable during pipeline PAUSE (dry-run readiness)
 *
 * Backward-compatibility:
 *   - Strategies already at DEPLOY_READY/PILOT/DEPLOYED are NOT demoted
 *   - Missing data for any gate (pre-Pass-E backtests) → that gate fails-open
 *     EXCEPT when explicitly documented as a hard block (B14, WFE)
 *   - WFE floor lifted 0.70 → 0.80 ONLY for NEW PAPER → DEPLOY_READY transitions
 *
 * WFE dual-threshold design — INTENTIONAL, not a bug:
 *   - 0.70 floor (WFE_HARD_FLOOR in wfe-gate.ts) = TESTING → PAPER lifecycle gate.
 *     This is an early signal that the strategy is at minimum viable OOS efficiency.
 *     Checked by lifecycle-service.ts at the TESTING→PAPER transition point.
 *   - 0.80 floor (WFE_PROMOTION_FLOOR in this file) = PAPER → DEPLOY_READY deploy gate.
 *     This is the institutional-grade bar before real capital is allocated.
 *     Checked exclusively here, inline within evaluatePromotionGates (the WFE
 *     branch that reads getWfePromotionFloor() / the effectiveWfeFloor override).
 *   - F-5 hardening (2026-06-23): removed the redundant standalone 0.70 gate that had
 *     been re-evaluated at PAPER → DEPLOY_READY.  The 0.80 orchestrator gate is now
 *     the sole authority for that transition.  Do NOT add back the 0.70 gate at
 *     PAPER → DEPLOY_READY — it would create a double evaluation with weaker semantics.
 */

import { logger } from "./logger.js";
import { evaluateB14CiGate } from "./b14-ci-gate.js";
import { evaluateWfeGate } from "./wfe-gate.js";

// ── Constants ────────────────────────────────────────────────────────────────

/** Env var name for WFE promotion floor (default 0.80 per Bailey/Lopez de Prado 2025). */
const WFE_PROMOTION_FLOOR_ENV = "WFE_PROMOTION_FLOOR";
const WFE_PROMOTION_FLOOR_DEFAULT = 0.80;

/** Env var name for CPCV minimum paths (default 15, institutional 2026 standard). */
const CPCV_MIN_PATHS_ENV = "CPCV_MIN_PATHS";
const CPCV_MIN_PATHS_DEFAULT = 15;

/** WRC p-value threshold (default 0.05). */
const WRC_P_THRESHOLD = 0.05;

/** SPA spa_consistent_p threshold (default 0.05). */
const SPA_P_THRESHOLD = 0.05;

/**
 * F-4 Hardening 2026-06-23: PROMOTION_GRANDFATHER_PRE_PASS_E opt-in flag.
 *
 * When NOT set (default "false"), null-datum gate paths fail-CLOSED: a strategy
 * with no CPCV/WRC/SPA/B14 data CANNOT reach DEPLOY_READY.
 * This is the institutional-grade default — missing evidence = blocked.
 *
 * Set PROMOTION_GRANDFATHER_PRE_PASS_E="true" ONLY for pre-Pass-E strategies
 * that legitimately have no WRC/SPA/CPCV data and need a grandfather window.
 * This flag requires explicit operator opt-in and is NOT the default.
 */
function isGrandfatherEnabled(): boolean {
  return (process.env.PROMOTION_GRANDFATHER_PRE_PASS_E ?? "false") === "true";
}

// ── Types ────────────────────────────────────────────────────────────────────

export type GateName = "b14_ci_high" | "wfe_floor" | "cpcv_n_paths" | "wrc_p" | "spa_p";

export interface GateResult {
  /** Whether this gate allows promotion. */
  passed: boolean;
  /** The observed value (null when data is unavailable). */
  value: number | null;
  /** The threshold the value is compared against. */
  threshold: number;
  /** Human-readable reason / status string. */
  reason: string;
  /** True when the gate was evaluated against real data (false = legacy/no-data, fails-open). */
  data_available: boolean;
}

export interface PromotionGateOrchestratorResult {
  /** Per-gate results keyed by gate name. */
  gate_results: Record<GateName, GateResult>;
  /** True when ALL gates pass — signal for operator/cron to trigger promotion. */
  can_promote: boolean;
  /** Number of gates that blocked. */
  n_gates_failed: number;
  /** Names of gates that blocked. */
  failing_gates: GateName[];
}

/** Input data read from the latest completed backtest row for a strategy. */
export interface StrategyPromotionData {
  /** probability_of_ruin_ci dict from monte_carlo risk_metrics (may be null). */
  ruinCi?: { ci_high?: number | null; ci_low?: number | null; point_estimate?: number | null; ci_method?: string | null; n_resamples?: number | null } | null;
  /** Scalar probability_of_ruin (pre-Pass-A fallback for B14). */
  ruinPointEstimate?: number | null;
  /** walk_forward_results.wfe_overall (Pass B.1 combined-fold Sharpe). */
  wfeOverall?: number | null;
  /** walk_forward_results.wf_metadata.n_paths (CPCV run; null when non-CPCV WF). */
  cpcvNPaths?: number | null;
  /** backtests.wrc_result.p_value (Pass E). */
  wrcPValue?: number | null;
  /** backtests.spa_result.spa_consistent_p (Pass E). */
  spaConsistentP?: number | null;
}

// ── Env readers ───────────────────────────────────────────────────────────────

/** Read WFE_PROMOTION_FLOOR from env (default 0.80). */
export function getWfePromotionFloor(): number {
  const raw = process.env[WFE_PROMOTION_FLOOR_ENV];
  if (!raw) return WFE_PROMOTION_FLOOR_DEFAULT;
  const parsed = parseFloat(raw);
  if (isNaN(parsed) || parsed < 0 || parsed > 10) {
    logger.warn(
      { raw, defaulted: WFE_PROMOTION_FLOOR_DEFAULT },
      `${WFE_PROMOTION_FLOOR_ENV} invalid — using default ${WFE_PROMOTION_FLOOR_DEFAULT}`,
    );
    return WFE_PROMOTION_FLOOR_DEFAULT;
  }
  return parsed;
}

/** Read CPCV_MIN_PATHS from env (default 15). */
export function getCpcvMinPaths(): number {
  const raw = process.env[CPCV_MIN_PATHS_ENV];
  if (!raw) return CPCV_MIN_PATHS_DEFAULT;
  const parsed = parseInt(raw, 10);
  if (isNaN(parsed) || parsed < 1) {
    logger.warn(
      { raw, defaulted: CPCV_MIN_PATHS_DEFAULT },
      `${CPCV_MIN_PATHS_ENV} invalid — using default ${CPCV_MIN_PATHS_DEFAULT}`,
    );
    return CPCV_MIN_PATHS_DEFAULT;
  }
  return parsed;
}

// ── Individual gate evaluators ────────────────────────────────────────────────

function evaluateB14Gate(data: StrategyPromotionData): GateResult {
  const b14Result = evaluateB14CiGate(data.ruinCi ?? null, data.ruinPointEstimate ?? null);
  const ciHigh = data.ruinCi?.ci_high ?? data.ruinPointEstimate ?? null;

  if (ciHigh === null) {
    // F-4 Hardening 2026-06-23: fail-CLOSED by default when no MC data.
    // Opt-in to legacy fail-open behavior via PROMOTION_GRANDFATHER_PRE_PASS_E="true".
    const grandfather = isGrandfatherEnabled();
    return {
      passed: grandfather,
      value: null,
      threshold: 0.40,
      reason: grandfather
        ? "b14.ci_high_unavailable — no MC run, fail-open (PROMOTION_GRANDFATHER_PRE_PASS_E=true)"
        : "b14.ci_high_unavailable — no MC run, fail-closed (missing evidence blocks promotion)",
      data_available: false,
    };
  }

  return {
    passed: b14Result.passed,
    value: typeof ciHigh === "number" ? ciHigh : null,
    threshold: b14Result.auditPayload.threshold,
    reason: b14Result.reason,
    data_available: true,
  };
}

function evaluateCpcvGate(data: StrategyPromotionData): GateResult {
  const minPaths = getCpcvMinPaths();
  const nPaths = data.cpcvNPaths ?? null;

  if (nPaths === null) {
    // F-4 Hardening 2026-06-23: fail-CLOSED by default when no CPCV data.
    // Opt-in to legacy fail-open behavior via PROMOTION_GRANDFATHER_PRE_PASS_E="true".
    const grandfather = isGrandfatherEnabled();
    return {
      passed: grandfather,
      value: null,
      threshold: minPaths,
      reason: grandfather
        ? "cpcv.no_run — no CPCV data yet, fail-open (PROMOTION_GRANDFATHER_PRE_PASS_E=true)"
        : "cpcv.no_run — no CPCV data yet, fail-closed (missing evidence blocks promotion)",
      data_available: false,
    };
  }

  const numPaths = Number(nPaths);
  const passed = numPaths >= minPaths;

  return {
    passed,
    value: numPaths,
    threshold: minPaths,
    reason: passed
      ? `cpcv.passed (${numPaths} paths >= ${minPaths})`
      : `cpcv.insufficient_paths (${numPaths} < ${minPaths})`,
    data_available: true,
  };
}

function evaluateWrcGate(data: StrategyPromotionData): GateResult {
  const pValue = data.wrcPValue ?? null;

  if (pValue === null) {
    // F-4 Hardening 2026-06-23: fail-CLOSED by default when no WRC data.
    // Opt-in to legacy fail-open behavior via PROMOTION_GRANDFATHER_PRE_PASS_E="true".
    const grandfather = isGrandfatherEnabled();
    return {
      passed: grandfather,
      value: null,
      threshold: WRC_P_THRESHOLD,
      reason: grandfather
        ? "wrc.unavailable — no WRC data, fail-open (PROMOTION_GRANDFATHER_PRE_PASS_E=true)"
        : "wrc.unavailable — no WRC data, fail-closed (missing evidence blocks promotion)",
      data_available: false,
    };
  }

  const p = Number(pValue);
  const passed = p < WRC_P_THRESHOLD;

  return {
    passed,
    value: p,
    threshold: WRC_P_THRESHOLD,
    reason: passed
      ? `wrc.passed (p=${p.toFixed(4)} < ${WRC_P_THRESHOLD})`
      : `wrc.not_significant (p=${p.toFixed(4)} >= ${WRC_P_THRESHOLD})`,
    data_available: true,
  };
}

function evaluateSpaGate(data: StrategyPromotionData): GateResult {
  const spaP = data.spaConsistentP ?? null;

  if (spaP === null) {
    // F-4 Hardening 2026-06-23: fail-CLOSED by default when no SPA data.
    // Opt-in to legacy fail-open behavior via PROMOTION_GRANDFATHER_PRE_PASS_E="true".
    const grandfather = isGrandfatherEnabled();
    return {
      passed: grandfather,
      value: null,
      threshold: SPA_P_THRESHOLD,
      reason: grandfather
        ? "spa.unavailable — no SPA data, fail-open (PROMOTION_GRANDFATHER_PRE_PASS_E=true)"
        : "spa.unavailable — no SPA data, fail-closed (missing evidence blocks promotion)",
      data_available: false,
    };
  }

  const p = Number(spaP);
  const passed = p < SPA_P_THRESHOLD;

  return {
    passed,
    value: p,
    threshold: SPA_P_THRESHOLD,
    reason: passed
      ? `spa.passed (consistent_p=${p.toFixed(4)} < ${SPA_P_THRESHOLD})`
      : `spa.not_significant (consistent_p=${p.toFixed(4)} >= ${SPA_P_THRESHOLD})`,
    data_available: true,
  };
}

// ── Main orchestrator ─────────────────────────────────────────────────────────

/**
 * Evaluate all 5 promotion gates for PAPER → DEPLOY_READY.
 *
 * This function is pure with respect to gate evaluation logic but requires
 * the caller to have already fetched StrategyPromotionData from the DB.
 * It does NOT perform DB reads itself — the caller (lifecycle-service.ts or
 * dry-run scripts) is responsible for fetching the data.
 *
 * To write audit rows, call `writePromotionGateAudit` separately after
 * receiving the result.
 *
 * @param strategyData  Pre-fetched promotion data from the latest backtest.
 * @param wfeFloor      Optional override of WFE floor (for tests / dry-run).
 * @param cpcvMinPaths  Optional override of CPCV min paths (for tests / dry-run).
 */
export function evaluatePromotionGates(
  strategyData: StrategyPromotionData,
  wfeFloor?: number,
  cpcvMinPathsOverride?: number,
): PromotionGateOrchestratorResult {
  // Apply optional overrides
  const effectiveWfeFloor = wfeFloor ?? getWfePromotionFloor();
  const effectiveCpcvMin = cpcvMinPathsOverride ?? getCpcvMinPaths();

  // Evaluate each gate independently
  const b14Result = evaluateB14Gate(strategyData);

  // WFE gate — use override floor
  // F-4 Hardening 2026-06-23: null WFE fails-CLOSED by default.
  // Opt-in to legacy fail-open via PROMOTION_GRANDFATHER_PRE_PASS_E="true".
  const wfe = strategyData.wfeOverall ?? null;
  const wfeResult: GateResult = wfe === null
    ? (() => {
        const grandfather = isGrandfatherEnabled();
        return {
          passed: grandfather,
          value: null,
          threshold: effectiveWfeFloor,
          reason: grandfather
            ? "wfe.unavailable_legacy — no WFE data, fail-open (PROMOTION_GRANDFATHER_PRE_PASS_E=true)"
            : "wfe.unavailable_legacy — no WFE data, fail-closed (missing evidence blocks promotion)",
          data_available: false,
        };
      })()
    : (() => {
        const numWfe = Number(wfe);
        const passed = numWfe >= effectiveWfeFloor;
        return {
          passed,
          value: numWfe,
          threshold: effectiveWfeFloor,
          reason: passed
            ? `wfe.passed (${numWfe.toFixed(3)} >= ${effectiveWfeFloor})`
            : `gate.wfe_floor_failed (${numWfe.toFixed(3)} < ${effectiveWfeFloor})`,
          data_available: true,
        };
      })();

  // CPCV gate — use override min
  // F-4 Hardening 2026-06-23: null CPCV fails-CLOSED by default.
  // Opt-in to legacy fail-open via PROMOTION_GRANDFATHER_PRE_PASS_E="true".
  const nPaths = strategyData.cpcvNPaths ?? null;
  const cpcvResult: GateResult = nPaths === null
    ? (() => {
        const grandfather = isGrandfatherEnabled();
        return {
          passed: grandfather,
          value: null,
          threshold: effectiveCpcvMin,
          reason: grandfather
            ? "cpcv.no_run — no CPCV data yet, fail-open (PROMOTION_GRANDFATHER_PRE_PASS_E=true)"
            : "cpcv.no_run — no CPCV data yet, fail-closed (missing evidence blocks promotion)",
          data_available: false,
        };
      })()
    : (() => {
        const numPaths = Number(nPaths);
        const passed = numPaths >= effectiveCpcvMin;
        return {
          passed,
          value: numPaths,
          threshold: effectiveCpcvMin,
          reason: passed
            ? `cpcv.passed (${numPaths} paths >= ${effectiveCpcvMin})`
            : `cpcv.insufficient_paths (${numPaths} < ${effectiveCpcvMin})`,
          data_available: true,
        };
      })();

  const wrcResult = evaluateWrcGate(strategyData);
  const spaResult = evaluateSpaGate(strategyData);

  const gate_results: Record<GateName, GateResult> = {
    b14_ci_high: b14Result,
    wfe_floor: wfeResult,
    cpcv_n_paths: cpcvResult,
    wrc_p: wrcResult,
    spa_p: spaResult,
  };

  const failing_gates = (Object.entries(gate_results) as [GateName, GateResult][])
    .filter(([, r]) => !r.passed)
    .map(([name]) => name);

  return {
    gate_results,
    can_promote: failing_gates.length === 0,
    n_gates_failed: failing_gates.length,
    failing_gates,
  };
}
