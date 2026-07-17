/**
 * style-c-scaleout.ts (fresh-scan HIGH#5, 2026-07-12) — the pure Style C 33/33/34 scale-out split,
 * computed off the ORIGINAL entry size. Split out of paper-execution-service.ts so it is unit-testable
 * without importing that service (which throws at import when DATABASE_URL is unset).
 *
 * The bug it fixes: paper closed 33% of the SHRINKING remainder at each leg (TP1 floor(N*0.33) →
 * decrement → TP2 floor(remainder*0.33)), booking ~22/22/56 for N=9 while the backtester blends fixed
 * fractions of the ORIGINAL size (0.33/0.33/0.34) ≈ 33/33/34. That over-weighted the runner (the leg
 * most exposed to give-back on the Chandelier trail + 15:55 flatten), diverging paper P&L from the
 * backtest on every 2-TP trade.
 */

/**
 * Split `original` contracts into Style C legs 33% / 33% / 34% using CUMULATIVE rounding so the three
 * legs always sum to `original` exactly and the runner lands at ~34% (not the leftover after two
 * independent floors). Matches the backtester's fixed-fraction blend on the original size. TP1 always
 * closes >= 1 (it fires first). The paper caller still applies its own `< remaining` full-close guard,
 * so tiny positions (N=1) collapse to a single full close at TP1.
 *
 * Examples: 9 → 3/3/3 · 6 → 2/2/2 · 3 → 1/1/1 · 2 → 1/0/1 · 1 → 1/0/0.
 */
export function styleCScaleOut(original: number): { tp1: number; tp2: number; runner: number } {
  const n = Math.max(0, Math.floor(original));
  if (n <= 0) return { tp1: 0, tp2: 0, runner: 0 };
  const cum33 = Math.max(1, Math.round(n * 0.33));         // TP1 closes >= 1
  const cum66 = Math.max(cum33, Math.round(n * 0.66));     // cumulative through TP2 >= TP1
  return { tp1: cum33, tp2: cum66 - cum33, runner: n - cum66 };
}

/**
 * post-m3-paper-execution-lifecycle wave (2026-07-17) — generic version of styleCScaleOut()
 * parametrized by the exit plan's REGIME-DEPENDENT scaling schedule (ExitPlan.scaling.tp1_pct /
 * tp2_pct from adaptive-exit-engine.ts, e.g. TRENDING 20/30/50, HIGH_VOL_MACRO 60/30/10) instead
 * of the Style C hardcoded 33/33/34.
 *
 * The bug it fixes: paper-execution-service.ts computed and persisted the full adaptive ExitPlan
 * (liquidity-mapped TP1/TP2 prices + this regime-scaled split) into paper_positions.exit_plan at
 * position-open time (Wave 25.5 Gap A), but NOTHING at fill time ever read tp1_pct/tp2_pct back
 * out — every adaptive position's TP1/TP2 legs still split 33/33/34 via styleCScaleOut(), silently
 * discarding the computed plan. Same cumulative-rounding contract as styleCScaleOut so the three
 * legs always sum to `original` exactly and stay stable whether queried at TP1-fill-time (tp1 leg
 * only) or TP2-fill-time (tp2 leg = cumulative-through-tp2 minus the tp1 leg) — both calls derive
 * from the same immutable pos.exitPlan.scaling, so there is no drift between the two reads.
 *
 * Percent inputs are clamped to [0,1] and the TP1 leg is floored at >= 1 (matches styleCScaleOut's
 * "TP1 always fires first" invariant) so a degenerate 0% TP1 schedule still closes at least 1
 * contract rather than silently no-op'ing the fill.
 */
export function adaptiveScaleOut(
  original: number,
  tp1Pct: number,
  tp2Pct: number,
): { tp1: number; tp2: number; runner: number } {
  const n = Math.max(0, Math.floor(original));
  if (n <= 0) return { tp1: 0, tp2: 0, runner: 0 };
  const clamp01 = (x: number) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);
  const p1 = clamp01(tp1Pct);
  const p2 = clamp01(tp2Pct);
  const cumTp1 = Math.max(1, Math.round(n * p1));           // TP1 closes >= 1
  const cumTp2 = Math.max(cumTp1, Math.round(n * (p1 + p2))); // cumulative through TP2 >= TP1
  return { tp1: cumTp1, tp2: cumTp2 - cumTp1, runner: n - cumTp2 };
}
