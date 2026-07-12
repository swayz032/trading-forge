/**
 * runner-trail-ratchet.ts (F1/F2, deep-scan 2026-07-11) — the two production formulas the adaptive
 * runner-trail in paper-execution-service.ts::updatePositionPrices depends on, extracted so they are
 * directly unit-testable and cannot silently regress. Both mirror the backtester ORACLE
 * (src/engine/backtester.py) which is the source of truth for paper<->backtest parity.
 */

/**
 * F2: anchored-VWAP per-bar price basis = TYPICAL price (high+low+close)/3, matching
 * backtester.py:2083 `typical_price = (bar_high + bar_low + close) / 3.0`. Paper previously used the
 * close alone, so the anchored VWAP (and thus the runner trail stop / exit price) diverged from
 * backtest on any bar whose close skews to one end of its range.
 */
export function avwapTypicalPrice(high: number, low: number, close: number): number {
  return (high + low + close) / 3;
}

/**
 * F1: decide whether the runner trail may ADVANCE (ratchet) to `computedTrail`. Mirrors the
 * backtester oracle:
 *   - advance ONLY after TP2 fills (backtester.py:2088 `if tp2_filled:`); before TP2 the stop holds
 *     at the structural initial stop.
 *   - floor the ratchet at the structural initial stop: a null current trailHwm is treated as the
 *     initialStop, so the FIRST write can never be LOOSER than the stop the trade was sized against
 *     (the pre-fix code accepted the first computedTrail unconditionally, which for a chandelier /
 *     near-entry AVWAP could sit at ~break-even -> premature exits, or wider than the sized stop ->
 *     over-risk).
 * "Tighter" is a higher stop for a long, a lower stop for a short.
 */
export function shouldAdvanceRunnerTrail(params: {
  side: string; // "long" | "short"
  computedTrail: number;
  currentTrailHwm: number | null;
  initialStop: number | null;
  tp1Filled: boolean;
  tp2Filled: boolean;
}): boolean {
  const { side, computedTrail, currentTrailHwm, initialStop, tp1Filled, tp2Filled } = params;
  const tp2Ready = tp1Filled && tp2Filled;
  const ratchetFloor = currentTrailHwm ?? initialStop;
  if (!tp2Ready || ratchetFloor == null) return false;
  return side === "long" ? computedTrail > ratchetFloor : computedTrail < ratchetFloor;
}
