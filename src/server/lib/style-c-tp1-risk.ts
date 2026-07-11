/**
 * style-c-tp1-risk.ts — F-1 (deep-scan re-scan 2026-07-10, HIGH)
 *
 * Single source of truth for the Style C TP1 R-unit (initial risk in points).
 *
 * WHY THIS EXISTS: there were TWO independent TP1-threshold computations that must agree
 * bar-for-bar but silently diverged:
 *   1. paper-execution-service.ts callExitHandler (the site that BOOKS the 33% TP1 partial
 *      close) — anchored to the STATIC entry-time stop (`|entryPrice - initialStopPrice|`),
 *      the "Defect 3 fix", so TP targets don't float with ATR (matches the backtester).
 *   2. paper-signal-service.ts BE+1 tracker (the ONLY site that moves the stop to
 *      break-even on TP1) — recomputed R from the LIVE current-bar ATR every bar.
 * Framework-overlay sets Style C stops as {type:"atr"} with no persisted ATR, so (2)'s TP1
 * target FLOATED bar-to-bar while (1) was fixed at entry. Consequence: when ATR drifted up,
 * price hit the real (fixed) TP1 — partial booked — but the tracker's higher floating target
 * hadn't triggered, so the stop stayed on the ORIGINAL WIDE stop instead of moving to BE+1:
 * a silent, unbounded-duration widened-risk window that contradicts the documented
 * "BE+1 on TP1 fill" invariant. Both sites now derive R through THIS helper so they cannot
 * diverge again.
 *
 * Contract: prefer the static entry-time stop distance; fall back to a caller-supplied ATR
 * distance ONLY for pre-migration-0179 rows whose `initialStopPrice` is null (a grandfather
 * edge — every post-0179 position carries it, so the static path is the hot path).
 */

export interface StyleCTp1RiskInput {
  entryPrice: number;
  /**
   * paper_positions.initialStopPrice — the structural stop set at openPosition time.
   * Accepts string (drizzle numeric/decimal columns deserialize as string) or number;
   * coerced via Number() internally (a non-finite result falls through to the ATR fallback).
   */
  initialStopPrice: string | number | null | undefined;
  /**
   * Legacy dynamic-ATR risk distance in points, used ONLY when initialStopPrice is null
   * (pre-0179 rows). Callers compute this their own way; it is never consulted on the
   * static hot path.
   */
  atrFallbackPoints: number;
}

/**
 * The Style C TP1 R-unit (initial risk in points). Static entry-time stop distance when
 * `initialStopPrice` is present (the hot path, ATR-independent), else the legacy ATR
 * fallback. Never negative (abs). Returns 0 only if both inputs are unusable.
 */
export function styleCTp1RiskPoints(input: StyleCTp1RiskInput): number {
  const { entryPrice, initialStopPrice, atrFallbackPoints } = input;
  if (initialStopPrice != null) {
    const stop = Number(initialStopPrice);
    if (Number.isFinite(stop) && Number.isFinite(entryPrice)) {
      return Math.abs(entryPrice - stop);
    }
  }
  return Number.isFinite(atrFallbackPoints) && atrFallbackPoints > 0 ? atrFallbackPoints : 0;
}
