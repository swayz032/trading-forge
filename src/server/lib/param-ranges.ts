/**
 * Canonical parameter ranges for strategy entry indicators.
 *
 * SINGLE SOURCE OF TRUTH for numeric parameter bounds.
 *
 * Both direct-bucket-graduator.ts (PARAM_RANGES validation) and
 * dsl-sanitizer.ts (ENTRY_PATTERN_ALLOWLIST ranges) MUST derive from
 * this module. Adding a range here is the only place a range lives —
 * never duplicate these values inline in either consumer.
 *
 * Keep in lockstep with src/engine/compiler/pattern_library.py ENTRY_PATTERNS.
 *
 * F-2 fix (2026-05-20): extracted from graduator + sanitizer to eliminate
 * the atr_breakout floor mismatch (graduator had [5,30], sanitizer had [10,30]).
 * Floor is now [5,30] everywhere — period=5 and period=7 are legitimate scalping
 * / short-term breakout choices that pandas-ta atr() accepts.
 *
 * F-3 fix (2026-05-20): connors_rsi2 added as a distinct family so
 * period=2 / oversold=5 / overbought=95 are in-range by definition.
 */

export type RangeMap = Record<string, [number, number]>;

export const CANONICAL_PARAM_RANGES: Record<string, RangeMap> = {
  sma_crossover:         { fast_period: [5, 50],   slow_period: [20, 200], confirmation_bars: [1, 5] },
  ema_crossover:         { fast_period: [5, 50],   slow_period: [20, 200], confirmation_bars: [1, 5] },
  rsi_reversal:          { period: [7, 21],         oversold: [20, 40],     overbought: [60, 80] },
  // connors_rsi2 is a distinct family: Connors RSI-2 uses period=2, tight bands.
  // Period range [2,5] covers RSI-2 and the occasional RSI-3/4 variant.
  connors_rsi2:          { period: [2, 5],          oversold: [3, 10],      overbought: [90, 97] },
  bollinger_breakout:    { period: [10, 30],        std_dev: [1.5, 3.0],    confirmation_bars: [1, 3] },
  // atr_breakout floor is 5 (not 10). Period=5 and period=7 are legitimate
  // scalping/short-term breakout choices; pandas-ta atr() accepts any positive int.
  // W23H.1-postmortem (2026-05-20): expanded from [10,30] → [5,30].
  atr_breakout:          { period: [5, 30],         multiplier: [1.0, 3.0] },
  vwap_reversion:        { deviation_threshold: [0.5, 3.0], confirmation_bars: [1, 5] },
  donchian_breakout:     { period: [10, 55] },
  keltner_squeeze:       { bb_period: [15, 25],     kc_period: [15, 25],    kc_multiplier: [1.0, 2.0] },
  session_open_breakout: { range_minutes: [5, 60],  buffer_ticks: [1, 10] },
  macd_crossover:        { fast_period: [8, 16],    slow_period: [20, 30],  signal_period: [7, 12] },
  vwap_fade:             { atr_extension_threshold: [1.0, 3.0], confirmation_bars: [1, 5], vwap_touch_exit: [0, 1] },
  // deep-scan cross-system F-2 (2026-07-06): mirror pattern_library.py's vwap_band_reject + anchored_vwap_retest
  // (Wave 25 Pass 5 archetypes). They were in the Python ENTRY_PATTERNS validator but NOT in the TS sanitizer, so
  // an LLM-hallucinated extra param passed through unsanitized and Python hard-rejected the whole DSL.
  vwap_band_reject:      { band_sigma: [1.5, 2.5], confirmation_bars: [1, 3], require_close_inside: [0, 1] },
  anchored_vwap_retest:  { anchor_lookback_bars: [1, 100], confirmation_bars: [1, 3], tolerance_ticks: [1, 10] },
  event_driven_fade:     { atr_move_threshold: [1.5, 4.0], event_window_minutes: [5, 30], confirmation_bars: [1, 3] },
  overnight_drift:       { drift_atr_threshold: [0.5, 2.0], asia_lookback_bars: [4, 24],  min_drift_bars: [2, 12] },
  // bounce_off_level — MA-as-S/R archetype (price bounces off single MA).
  // Distinct from ema_crossover (MA vs MA cross). Fixed routing 2026-05-26.
  // ma_type is a string enum ("sma"|"ema") — not validated numerically here.
  bounce_off_level:      { ma_period: [10, 250], proximity_atr_mult: [0.5, 3.0], swing_lookback: [3, 20], atr_period: [7, 21] },
  // MED fix (critic-replay-lifecycle-misc, 2026-07-17): ict_bias_aligned_continuation
  // was documented (CLAUDE.md §2b Wave 26 Pass G B1 v10 update: "awareness of new
  // archetypes (bounce_off_level, ict_bias_aligned_continuation)") and shipped
  // (src/engine/strategies/ict_bias_aligned_continuation.py, indicator-catalog.md
  // §"ict_bias_aligned_continuation") alongside bounce_off_level, but only
  // bounce_off_level ever made it into this table — ict_bias_aligned_continuation
  // was missing entirely, so critic-optimizer-service.ts's H-5 warn fired
  // unconditionally ("no canonical param ranges — bounds will be unclamped") for
  // every strategy running this archetype, and the H-8 pre-replay bounds gate could
  // never clamp any of its 6 real numeric knobs. Bounds mirror the Python defaults
  // (htf_swing_lookback=20, bos_lookback=5, bos_window=15, fvg_lookback=8,
  // atr_period=14, max_bars_held=30) with the same ±proportional-window convention
  // used for the other archetype entries above.
  ict_bias_aligned_continuation: {
    htf_swing_lookback: [10, 60],
    bos_lookback:       [2, 20],
    bos_window:         [5, 40],
    fvg_lookback:       [2, 30],
    atr_period:         [7, 21],
    max_bars_held:      [10, 78],
  },
} as const;

/**
 * Resolves CANONICAL_PARAM_RANGES for a strategy's `entry_indicator`, stripping
 * an optional "archetype:" prefix first.
 *
 * MED fix (critic-replay-lifecycle-misc, 2026-07-17): archetype strategies persist
 * `entry_indicator` WITH the "archetype:" prefix (direct-bucket-graduator.ts:2253 —
 * `entry_indicator: isArchetype && archetypeName ? \`archetype:${archetypeName}\` :
 * entryIndicator`), matching the convention used throughout the codebase
 * (archetype-registry-keys.ts, playbook-registration-backfill.ts, dsl-compiler.ts,
 * fade-the-losers-service.ts all strip this same prefix before lookup). But this
 * table's own keys — including the pre-existing `bounce_off_level` entry — are
 * registered BARE (no prefix). Every prior direct `CANONICAL_PARAM_RANGES[key]`
 * lookup against a live archetype-prefixed entry_indicator therefore silently
 * missed, for EVERY archetype, regardless of whether that archetype had a bare
 * entry registered here. Callers should use this helper instead of indexing the
 * map directly whenever entry_indicator may be archetype-prefixed.
 */
export function resolveCanonicalRangesForEntryIndicator(
  entryIndicator: string | null | undefined,
): RangeMap | null {
  if (typeof entryIndicator !== "string") return null;
  const trimmed = entryIndicator.trim();
  if (trimmed.length === 0) return null;
  const key = trimmed.startsWith("archetype:") ? trimmed.slice("archetype:".length).trim() : trimmed;
  return CANONICAL_PARAM_RANGES[key] ?? null;
}
