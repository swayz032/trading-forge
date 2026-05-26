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
  event_driven_fade:     { atr_move_threshold: [1.5, 4.0], event_window_minutes: [5, 30], confirmation_bars: [1, 3] },
  overnight_drift:       { drift_atr_threshold: [0.5, 2.0], asia_lookback_bars: [4, 24],  min_drift_bars: [2, 12] },
  // bounce_off_level — MA-as-S/R archetype (price bounces off single MA).
  // Distinct from ema_crossover (MA vs MA cross). Fixed routing 2026-05-26.
  // ma_type is a string enum ("sma"|"ema") — not validated numerically here.
  bounce_off_level:      { ma_period: [10, 250], proximity_atr_mult: [0.5, 3.0], swing_lookback: [3, 20], atr_period: [7, 21] },
} as const;
