/**
 * shadow-signal-divergence-checker.ts — Wave 29 Pass A.3 (critic-optimizer)
 *
 * Pure-function shadow-signal divergence comparator.
 *
 * Catches training-serving skew before paper money is deployed.
 * Compare logged shadow signals (TradingView Pine emissions WITHOUT
 * TradersPost webhook) against what the historical backtest expected
 * the strategy to do for the same period.
 *
 * Gate: ≥5% divergence across ≥20 signals → BLOCK SHADOW → PAPER.
 *
 * Institutional evidence (AltStreet Quant 2.0 Dec 2025):
 *   training-serving skew = 15-25% of all institutional production model failures.
 *
 * This module is PURE — no I/O, no Date.now(), no side effects.
 * The companion loader (shadow-signal-divergence-loader.ts) handles DB reads.
 *
 * Bar-period conventions:
 *   - "1 bar" = the strategy's execution timeframe bar (exec-TF).
 *   - For timing comparisons we use the signal_ts as a Unix epoch seconds integer.
 *   - ±1 bar tolerance is expressed as ONE_BAR_SECONDS via the caller; default 300 (5-min).
 */

// ──────────────────────────────────────────────────────────────────────────────
// Public shapes
// ──────────────────────────────────────────────────────────────────────────────

/**
 * A logged shadow signal captured from TradingView Pine emissions
 * (no TradersPost webhook; recorded by paper-signal-service shadow_mode branch).
 *
 * Schema dependency: these fields correspond to a wave-29-specific
 * `shadow_signals` table extension that A.1 ships with the following
 * additional columns (carried forward from A.1 contract):
 *   signal_ts         TIMESTAMPTZ  — when the signal fired
 *   direction         TEXT         — "long" | "short"
 *   entry_price       NUMERIC      — intended entry price
 *   intended_size     INTEGER      — intended contract count
 *   killzone          TEXT         — active killzone name (optional)
 *   regime            TEXT         — institutional_regime at signal time (optional)
 *   confluence_score  NUMERIC      — 11-factor weighted score (optional)
 *   lifecycle_state   TEXT         — "SHADOW" at time of capture
 *   strategy_id       UUID         — parent strategy
 *
 * NOTE: the existing `shadow_signals` table (pre-A.1) has a different schema
 * (expectedEntry/expectedExit model). The loader adapts the mapping.
 * A.4 architect reconciles the schema after A.1 lands.
 */
export interface ShadowSignal {
  /** Unix epoch seconds when the signal fired. */
  signal_ts: number;
  /** Direction: "long" | "short". */
  direction: string;
  /** Intended entry price. */
  entry_price: number;
  /** Intended position size in contracts. */
  intended_size: number;
  /** Active killzone at signal time (optional, informational). */
  killzone?: string | null;
  /** Institutional regime at signal time (optional, informational). */
  regime?: string | null;
  /** Weighted confluence score (optional, informational). */
  confluence_score?: number | null;
}

/**
 * A signal the backtest EXPECTED the strategy to emit for a given bar.
 * Sourced from backtests.expected_signals JSONB or computed from
 * the backtester output for the overlapping period.
 *
 * Schema dependency: backtests.expected_signals JSONB column (may not yet
 * exist for pre-Wave-29 backtests — loader returns empty array in that case,
 * triggering the insufficient_samples guard).
 */
export interface ExpectedSignal {
  /** Unix epoch seconds — expected entry timestamp. */
  signal_ts: number;
  /** Expected direction: "long" | "short". */
  direction: string;
  /** Expected entry price (from backtester). */
  entry_price: number;
  /** Expected position size in contracts. */
  intended_size: number;
}

/**
 * Per-signal violation detail for audit payloads and downstream debugging.
 */
export interface PerSignalViolation {
  /** Index into the shadow array (0-based). */
  shadow_idx: number;
  /** Index into the matched backtest expected signal (-1 if no match found). */
  backtest_idx: number;
  /** Which comparison rule triggered the violation. */
  divergence_type: "direction" | "size" | "timing" | "unmatched";
  /** Quantified magnitude: pct difference for size, bar count for timing, 1 for direction/unmatched. */
  magnitude: number;
}

/**
 * Result of compareShadowToBacktest.
 *
 * ok: true  → PROMOTE (divergence_pct < 0.05, sample_size ≥ 20)
 * ok: false → BLOCK  (divergence_pct ≥ 0.05, sample_size < 20, or insufficient_samples)
 */
export interface DivergenceResult {
  /** Whether SHADOW → PAPER promotion is cleared. */
  ok: boolean;
  /** Fraction of signals that diverge (0.0 – 1.0). */
  divergence_pct: number;
  /** Number of shadow signals evaluated. */
  sample_size: number;
  /** Per-signal violations for audit trail and debugging. */
  per_signal_violations: PerSignalViolation[];
  /** Human-readable reason string; present when ok=false. */
  reason?: string;
}

// ──────────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────────

/** Minimum shadow signals required before the gate evaluates (inclusive). */
export const MIN_SAMPLE_SIZE = 20;

/** Gate threshold: divergence_pct ≥ this value → BLOCK. Boundary inclusive. */
export const DIVERGENCE_THRESHOLD = 0.05;

/** Default bar period in seconds used for timing tolerance (5-min bars = 300s). */
export const DEFAULT_BAR_SECONDS = 300;

/** Size tolerance: shadow size must be within this fraction of backtest expected size. */
export const SIZE_TOLERANCE_PCT = 0.10;

// ──────────────────────────────────────────────────────────────────────────────
// Core pure function
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Compare shadow signals against backtest expected signals.
 *
 * PURE FUNCTION — no I/O, no Date.now(), no randomness.
 * Identical inputs always produce identical outputs.
 *
 * Comparison rules per signal:
 *   Timing:    ±1 exec-bar tolerance — divergence if shadow timestamp deviates
 *              from any backtest expected signal in the same trading session
 *              by > 1 bar (caller provides barSeconds; default 300s for 5-min).
 *   Direction: exact match required (long ≠ short = divergence).
 *   Size:      shadow intended_size within 10% of backtest expected size
 *              (divergence if |shadow - expected| / expected > 0.10).
 *
 * Matching algorithm:
 *   For each shadow signal, find the nearest backtest expected signal (by |Δts|).
 *   If Δts ≤ barSeconds → timing match candidate.
 *   Then check direction and size on that candidate.
 *   If no backtest signal is within barSeconds → timing divergence (unmatched).
 *
 * Aggregate: divergence_pct = count_of_diverging_signals / total_sample_size.
 *
 * @param shadowSignals       Logged shadow signals (from loader).
 * @param backtestExpected    Expected signals from backtest output.
 * @param barSeconds          One bar in seconds for timing tolerance (default 300).
 * @returns DivergenceResult
 */
export function compareShadowToBacktest(
  shadowSignals: ShadowSignal[],
  backtestExpected: ExpectedSignal[],
  barSeconds = DEFAULT_BAR_SECONDS,
): DivergenceResult {
  const sampleSize = shadowSignals.length;

  // ── Sample-size gate ───────────────────────────────────────────────────────
  if (sampleSize < MIN_SAMPLE_SIZE) {
    return {
      ok: false,
      divergence_pct: 0,
      sample_size: sampleSize,
      per_signal_violations: [],
      reason: "insufficient_samples",
    };
  }

  // ── Baseline-availability gate (2026-06-29 deep-scan #4) ─────────────────────
  // An empty backtest baseline (0-trade backtest, or a pre-Wave-29 backtest with
  // no expected_signals) cannot validate divergence. BLOCK fail-closed with an
  // HONEST reason instead of the misleading 100% "divergence" the comparator would
  // otherwise report — every shadow signal would be marked unmatched against the
  // empty baseline, surfacing as `divergence_exceeds_threshold: 100.0%` and hiding
  // the real cause (no baseline). Same gate outcome (ok=false → block); clearer audit.
  if (backtestExpected.length === 0) {
    return {
      ok: false,
      divergence_pct: 0,
      sample_size: sampleSize,
      per_signal_violations: [],
      reason: "backtest_baseline_unavailable",
    };
  }

  const violations: PerSignalViolation[] = [];

  for (let si = 0; si < shadowSignals.length; si++) {
    const shadow = shadowSignals[si];

    // Find the nearest backtest expected signal by absolute timestamp delta.
    let nearestBtIdx = -1;
    let nearestDtSec = Infinity;

    for (let bi = 0; bi < backtestExpected.length; bi++) {
      const dtSec = Math.abs(shadow.signal_ts - backtestExpected[bi].signal_ts);
      if (dtSec < nearestDtSec) {
        nearestDtSec = dtSec;
        nearestBtIdx = bi;
      }
    }

    // ── No backtest signal within ±1 bar → unmatched timing divergence ───────
    if (nearestBtIdx === -1 || nearestDtSec > barSeconds) {
      violations.push({
        shadow_idx: si,
        backtest_idx: nearestBtIdx,
        divergence_type: "unmatched",
        magnitude: nearestBtIdx === -1 ? Infinity : nearestDtSec / barSeconds,
      });
      continue;
    }

    const bt = backtestExpected[nearestBtIdx];

    // ── Direction: exact match required ──────────────────────────────────────
    if (shadow.direction !== bt.direction) {
      violations.push({
        shadow_idx: si,
        backtest_idx: nearestBtIdx,
        divergence_type: "direction",
        magnitude: 1,
      });
    }

    // ── Size: within 10% tolerance — evaluated independently of direction ────
    // FIX 9: Remove !diverged guard so compound faults (bad direction AND bad size)
    // are both counted. Cap at 2 violations per signal: direction + size.
    // Timing divergence routes to continue above, so max = 2 per signal.
    {
      const expectedSize = bt.intended_size;
      if (expectedSize !== 0) {
        const sizeDiffPct = Math.abs(shadow.intended_size - expectedSize) / expectedSize;
        if (sizeDiffPct > SIZE_TOLERANCE_PCT) {
          violations.push({
            shadow_idx: si,
            backtest_idx: nearestBtIdx,
            divergence_type: "size",
            magnitude: sizeDiffPct,
          });
        }
      }
    }

    // ── Timing: already confirmed within ±1 bar — no extra violation ────────
    // (timing within barSeconds is a MATCH; we only record it if it was the
    //  sole failure, which is captured by the unmatched branch above.)
  }

  // deep-scan Paper F-1: divergence_pct is the FRACTION OF SIGNALS that diverge (documented [0,1]).
  // A single signal can push 2 violations (direction + size), so violations.length overcounts and
  // can exceed sampleSize (→ divergence_pct > 1.0, breaking the bound + overstating the gate). Count
  // DISTINCT diverging signals by shadow_idx; per_signal_violations still carries the full detail.
  const divergingCount = new Set(violations.map((v) => v.shadow_idx)).size;
  const divergencePct = divergingCount / sampleSize;

  // ── Threshold gate: ≥ 5% divergence (boundary inclusive) → BLOCK ─────────
  if (divergencePct >= DIVERGENCE_THRESHOLD) {
    return {
      ok: false,
      divergence_pct: divergencePct,
      sample_size: sampleSize,
      per_signal_violations: violations,
      reason: `divergence_exceeds_threshold: ${(divergencePct * 100).toFixed(1)}% >= ${(DIVERGENCE_THRESHOLD * 100).toFixed(0)}%`,
    };
  }

  return {
    ok: true,
    divergence_pct: divergencePct,
    sample_size: sampleSize,
    per_signal_violations: violations,
  };
}
