/**
 * stop-geometry.ts — Wave 2 (2026-07-16) unified stop-geometry contract.
 *
 * ONE bounded core, TWO role-separated helpers. The whole point: the managed
 * stop the paper engine trades and the sizing stop the position-sizer budgets
 * are derived from the SAME per-symbol ceiling/floor tables the backtester uses,
 * so paper geometry == backtest geometry == sizing geometry, forever, enforced
 * by scripts/check-ts-python-stop-geometry-parity.ts against the Python mirror
 * src/engine/stop_geometry.py.
 *
 * ROLE SEPARATION
 * ---------------
 *   managedStopPts(symbol, atr, configMult) = min(ceiling, configMult × atr)
 *     The stop the trade is MANAGED against (paper + backtest). NO floor — the
 *     backtest management layer has no floor; the MES 6pt floor lives ONLY in the
 *     DSL admission layer, which the tighter managed stop dominates. Flooring the
 *     managed stop would make paper WIDER than the backtest that graded every
 *     promotion whenever MES ATR < 4.
 *
 *   sizingStopPts(symbol, atr, configMult) = min(max(configMult × atr, floor ?? 0), ceiling)
 *     The stop distance the position SIZE is budgeted against. Floor WIDENS (a
 *     safety rail against near-zero-ATR blowups sizing huge), shared ceiling caps.
 *     Floor semantics == Python `_STOP_FLOOR_ENV_MAP` (MES 6.0 default; MNQ/MCL
 *     env opt-in; 0 disables).
 *
 * INVARIANT (parity-gate + property-test per cell):
 *   sizingStopPts(s,a,m) >= managedStopPts(s,a,m)   for all inputs
 *   ⇒ the dollar risk at the managed stop is always <= the budget the sizer
 *     reserved for it (you can never risk more than the 2%-per-trade ceiling).
 *   Proof sketch: both share the same ceiling; sizing takes max(mult×atr, floor)
 *   which is >= mult×atr, then applies the same ceiling — a monotone clamp of a
 *   value >= the managed pre-ceiling value, so the post-ceiling result is >=.
 *
 * PURE. No DB imports, no side effects — safe to import from the parity gate,
 * risk-sizing, paper-execution, or tests. Ceiling comes from contract-class.ts
 * (getStopCeilingPts); floor is defined here (Python parity — also fixes the
 * TS-side missing MNQ/MCL env opt-in that risk-sizing.ts never had).
 */

import { getStopCeilingPts } from "./contract-class.js";

/**
 * Per-symbol stop FLOOR table — the canonical TS mirror of Python
 * `_STOP_FLOOR_ENV_MAP` in src/engine/stop_geometry.py.
 *
 * A floor WIDENS a stop that is too tight (sizing safety rail). Only MES has a
 * default floor (6.0pt); MNQ/MCL are opt-in via env. Env value of 0 (or
 * negative) DISABLES the floor for that symbol (returns null).
 *
 * Env keys are shared with the Python side (parity requirement):
 *   STOP_FLOOR_PTS_MES  default 6.0
 *   STOP_FLOOR_PTS_MNQ  default null (opt-in)
 *   STOP_FLOOR_PTS_MCL  default null (opt-in)
 *
 * Read at CALL TIME (process.env) so the parity gate's env-override subprocess
 * cases (STOP_FLOOR_PTS_MNQ=12; STOP_FLOOR_PTS_MES=0) resolve identically to the
 * Python side (which also reads env per-call).
 */
const STOP_FLOOR_ENV_MAP: Record<string, { env: string; default: number | null }> = {
  MES: { env: "STOP_FLOOR_PTS_MES", default: 6.0 },
  ES: { env: "STOP_FLOOR_PTS_MES", default: 6.0 }, // micro alias — shares MES env var
  MNQ: { env: "STOP_FLOOR_PTS_MNQ", default: null }, // no default — opt-in via env
  NQ: { env: "STOP_FLOOR_PTS_MNQ", default: null },
  MCL: { env: "STOP_FLOOR_PTS_MCL", default: null }, // no default — opt-in via env
  CL: { env: "STOP_FLOOR_PTS_MCL", default: null },
};

/**
 * Resolve the stop FLOOR (minimum stop distance, in price points) for a symbol.
 *
 * Returns null when no floor applies (unknown symbol, or opt-in env unset for
 * MNQ/MCL, or env explicitly set to 0/negative — which disables the floor).
 *
 * Mirrors Python `get_stop_floor_for_symbol`. Case-insensitive. Never throws.
 */
export function getStopFloorPts(symbol: string): number | null {
  if (!symbol) return null;
  const entry = STOP_FLOOR_ENV_MAP[symbol.toUpperCase()];
  if (!entry) return null;
  const raw = process.env[entry.env];
  if (raw !== undefined) {
    const v = parseFloat(raw);
    if (Number.isNaN(v)) return entry.default;
    return v > 0 ? v : null; // 0 or negative = no floor
  }
  return entry.default;
}

/**
 * MANAGED stop distance in points = min(ceiling(symbol), configMult × atr).
 * NO floor. This is the geometry that graded every promotion (the backtest
 * management layer runs exactly this). Paper must manage on the same distance.
 */
export function managedStopPts(symbol: string, atr: number, configMult: number): number {
  return Math.min(getStopCeilingPts(symbol), configMult * atr);
}

/**
 * SIZING stop distance in points = min(max(configMult × atr, floor ?? 0), ceiling).
 * Floor widens (near-zero-ATR safety rail), shared ceiling caps. Always
 * >= managedStopPts for the same inputs (the invariant that bounds risk-at-stop
 * to the sizing budget).
 */
export function sizingStopPts(symbol: string, atr: number, configMult: number): number {
  const floor = getStopFloorPts(symbol) ?? 0;
  const ceiling = getStopCeilingPts(symbol);
  return Math.min(Math.max(configMult * atr, floor), ceiling);
}
