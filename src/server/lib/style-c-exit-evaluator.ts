/**
 * style-c-exit-evaluator.ts — Pure TypeScript port of src/engine/exits/style_c_handler.py
 *
 * Decision-equivalent to style_c_handler.py v1.0.0 — same thresholds, same priority
 * order, same intrabar TP detection semantics, same HOLD-on-error contract.
 * Runs synchronously in the hot-path; no subprocess, no network, no I/O.
 *
 * Decision priority (mirrors Python evaluate_exit()):
 *   1. TIME_STOP_FLATTEN  — current_time_et >= 15:55 ET
 *   2. FILL_TP1_50PCT     — price_reached(entry + sign × R × 1.0) AND !tp1_filled
 *   3. FILL_TP2           — price_reached(entry + sign × R × 2.0) AND tp1_filled AND !tp2_filled
 *   4. TIGHTEN_TRAIL_TO_X — tp1_filled AND tp2_filled AND developing_session_poc not null
 *   5. HOLD               — default
 *
 * Note: FILL_TP1_50PCT is the reused decision name from Style D (fills 33% in Style C).
 *       Callers must use TP1_FRACTION_C (0.33), not the Style D 0.50 fraction.
 *
 * Parity contract:
 *   - Byte-for-byte decision-equivalent across the 5 priority branches.
 *   - handler_version suffix "_ts" distinguishes TS vs Python evaluation in telemetry.
 *   - STYLE_C_EXIT_PYTHON_FALLBACK=true routes to Python (parity-check / fallback).
 *
 * 2026-06-29: Fix 2 (HIGH) — replaces per-bar Python subprocess that caused 1h TP blackout
 *   when circuit breaker opened after 3 subprocess failures in 10 min.
 */

// ─── Constants (mirrors style_c_handler.py) ───────────────────────────────────

/** Matches Python HANDLER_VERSION; "_ts" suffix differentiates evaluator in telemetry. */
export const STYLE_C_EVALUATOR_VERSION = "style_c_v1.0.0_ts";

export const TP1_FRACTION_C = 0.33;
export const TP2_FRACTION_C = 0.33;
export const RUNNER_FRACTION_C = 0.34;

export const TP1_AT_R_C = 1.0;
export const TP2_AT_R_C = 2.0;

/** Configurable via env TIME_STOP_FLATTEN_ET (default "15:55"). Matches TRACK3_CONFIG. */
const TIME_STOP_FLATTEN_ET = process.env.TIME_STOP_FLATTEN_ET ?? "15:55";

// ─── Input / output types ─────────────────────────────────────────────────────

export interface StyleCEvalState {
  direction: "long" | "short";
  entry_price: number;
  /** Stop distance in points — always positive. Used to derive 1R and 2R targets. */
  stop_pts: number;
  /**
   * Current price (or intrabar favorable extreme when supplied by the paper engine).
   * Paper engine passes bar_high for longs / bar_low for shorts as current_price to
   * match backtester.py intrabar TP detection — see price_reached() below.
   */
  current_price: number;
  /** "HH:MM" in ET — parsed numerically, not lexicographically. */
  current_time_et: string;
  position_pct_open?: number;
  tick_size?: number;
  tp1_filled?: boolean;
  tp2_filled?: boolean;
  /** Developing session Point of Control for the runner trail. null = no VP feed. */
  developing_session_poc?: number | null;
  /** Regime audit fields (pass-through to evidence; do not affect decisions). */
  playbook?: string | null;
  vp_shape?: string | null;
  macro_state?: string | null;
  /**
   * Intrabar high (longs) / low (shorts) for limit-touch TP detection.
   * Mirrors backtester.py:1248/1260:
   *   long:  bar_high >= tp_price
   *   short: bar_low  <= tp_price
   * Falls back to current_price when null (backward-compat for callers without OHLC context).
   */
  bar_high?: number | null;
  bar_low?: number | null;
}

export interface StyleCEvalResult {
  decision: "TIME_STOP_FLATTEN" | "FILL_TP1_50PCT" | "FILL_TP2" | "TIGHTEN_TRAIL_TO_X" | "HOLD";
  new_stop?: number | null;
  evidence: Record<string, unknown>;
  handler_version: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns true when current_time_et >= TIME_STOP_FLATTEN_ET.
 * Mirrors _is_time_stop() in style_d_handler.py — parses "HH:MM" as integers
 * and compares as total minutes, matching Python's datetime.time comparison.
 * Returns false on parse failure (fail-open = keep trading; same as Python except clause).
 */
function _isTimeStop(currentTimeEt: string): boolean {
  try {
    const [ch, cm] = currentTimeEt.split(":").map(Number);
    const [fh, fm] = TIME_STOP_FLATTEN_ET.split(":").map(Number);
    if (!Number.isFinite(ch) || !Number.isFinite(cm) ||
        !Number.isFinite(fh) || !Number.isFinite(fm)) return false;
    return ch * 60 + cm >= fh * 60 + fm;
  } catch {
    return false;
  }
}

/**
 * Detects whether a TP target was reached intrabar.
 * Mirrors price_reached() in style_c_handler.py (C2 fix):
 *   long:  bar_high ?? current_price >= target
 *   short: bar_low  ?? current_price <= target
 */
function _priceReached(
  target: number,
  direction: "long" | "short",
  currentPrice: number,
  barHigh: number | null | undefined,
  barLow: number | null | undefined,
): boolean {
  if (direction === "long") {
    const probe = barHigh != null ? barHigh : currentPrice;
    return probe >= target;
  }
  const probe = barLow != null ? barLow : currentPrice;
  return probe <= target;
}

// ─── Main evaluator ───────────────────────────────────────────────────────────

/**
 * Pure-function Style C exit evaluator — TypeScript port of style_c_handler.py::evaluate_exit().
 * No I/O, no side effects, no async. Fail-closed: any exception returns HOLD.
 */
export function evaluateStyleCExit(state: StyleCEvalState): StyleCEvalResult {
  const evidence: Record<string, unknown> = {
    direction: state.direction,
    entry_price: state.entry_price,
    stop_pts: state.stop_pts,
    current_price: state.current_price,
    bar_high: state.bar_high ?? null,
    bar_low: state.bar_low ?? null,
    position_pct_open: state.position_pct_open ?? 1.0,
    tp1_filled: state.tp1_filled ?? false,
    tp2_filled: state.tp2_filled ?? false,
    current_time_et: state.current_time_et,
    playbook: state.playbook ?? null,
    vp_shape: state.vp_shape ?? null,
    macro_state: state.macro_state ?? null,
    handler_version: STYLE_C_EVALUATOR_VERSION,
  };

  try {
    // Validate critical numeric inputs (mirrors Python nan/inf guard)
    for (const [name, val] of [
      ["entry_price", state.entry_price],
      ["stop_pts", state.stop_pts],
      ["current_price", state.current_price],
    ] as [string, number][]) {
      if (!Number.isFinite(val) || Number.isNaN(val)) {
        evidence["error"] = `NaN_or_Inf_in_${name}`;
        return { decision: "HOLD", new_stop: null, evidence, handler_version: STYLE_C_EVALUATOR_VERSION };
      }
    }

    if (state.stop_pts <= 0) {
      evidence["error"] = "stop_pts_not_positive";
      return { decision: "HOLD", new_stop: null, evidence, handler_version: STYLE_C_EVALUATOR_VERSION };
    }

    const riskPts = state.stop_pts;
    const sign = state.direction === "long" ? 1 : -1;
    const tp1Price = state.entry_price + sign * riskPts * TP1_AT_R_C;
    const tp2Price = state.entry_price + sign * riskPts * TP2_AT_R_C;

    // ── Priority 1: Time-stop ─────────────────────────────────────────────────
    if (_isTimeStop(state.current_time_et)) {
      evidence["trigger"] = "time_stop";
      evidence["flatten_threshold"] = TIME_STOP_FLATTEN_ET;
      return { decision: "TIME_STOP_FLATTEN", new_stop: null, evidence, handler_version: STYLE_C_EVALUATOR_VERSION };
    }

    // ── Priority 2: TP1 fill at 1.0R ─────────────────────────────────────────
    if (_priceReached(tp1Price, state.direction, state.current_price, state.bar_high, state.bar_low)
        && !(state.tp1_filled ?? false)) {
      evidence["trigger"] = "tp1_fill";
      evidence["tp1_price"] = tp1Price;
      evidence["tp1_fraction"] = TP1_FRACTION_C;
      return { decision: "FILL_TP1_50PCT", new_stop: null, evidence, handler_version: STYLE_C_EVALUATOR_VERSION };
    }

    // ── Priority 3: TP2 fill at 2.0R ─────────────────────────────────────────
    if (_priceReached(tp2Price, state.direction, state.current_price, state.bar_high, state.bar_low)
        && (state.tp1_filled ?? false)
        && !(state.tp2_filled ?? false)) {
      evidence["trigger"] = "tp2_fill";
      evidence["tp2_price"] = tp2Price;
      evidence["tp2_fraction"] = TP2_FRACTION_C;
      return { decision: "FILL_TP2", new_stop: null, evidence, handler_version: STYLE_C_EVALUATOR_VERSION };
    }

    // ── Priority 4: POC trail for runner ──────────────────────────────────────
    // Mirrors Python: both poc_breached and !poc_breached emit TIGHTEN_TRAIL_TO_X.
    // The paper engine's BL-1 stop-breach block closes the position when price
    // actually falls through the trail — this block only updates the trail level.
    if ((state.tp1_filled ?? false) && (state.tp2_filled ?? false)
        && state.developing_session_poc != null) {
      const poc = state.developing_session_poc;
      const pocBreached = state.direction === "long"
        ? state.current_price <= poc
        : state.current_price >= poc;
      evidence["trigger"] = pocBreached ? "poc_trail_breached" : "poc_trail_update";
      evidence["developing_session_poc"] = poc;
      return {
        decision: "TIGHTEN_TRAIL_TO_X",
        new_stop: poc,
        evidence,
        handler_version: STYLE_C_EVALUATOR_VERSION,
      };
    }

    // ── Default: Hold ─────────────────────────────────────────────────────────
    evidence["trigger"] = "hold";
    return { decision: "HOLD", new_stop: null, evidence, handler_version: STYLE_C_EVALUATOR_VERSION };

  } catch (exc) {
    evidence["error"] = String(exc);
    return { decision: "HOLD", new_stop: null, evidence, handler_version: STYLE_C_EVALUATOR_VERSION };
  }
}

// ─── Telemetry helpers (for promotion-gate distortion analysis) ───────────────

/** Returns accumulated CB-open metrics from the shared paper-execution-service CB state. */
export interface StyleCCbTelemetry {
  /** Number of times the circuit breaker has opened this process lifetime. */
  circuitBreakerOpenCount: number;
  /** Total milliseconds the circuit breaker spent OPEN this process lifetime. */
  circuitBreakerOpenTotalMs: number;
}
