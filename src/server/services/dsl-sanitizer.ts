/**
 * DSL Sanitizer — strips disallowed entry_params and clamps out-of-range
 * numeric values from LLM-generated strategy DSLs before they reach the
 * Python compiler.
 *
 * The Python compiler (src/engine/compiler/pattern_library.py) enforces
 * strict per-indicator param allowlists with numeric ranges. When the
 * `transcript_extractor` GPT-5-mini role generates a DSL during graduation
 * drain, it tends to hallucinate generic technical-analysis params
 * (e.g. adding rsi_period to vwap_reversion, or confirmation_bars to
 * donchian_breakout) that aren't in the per-indicator allowlist. The
 * compiler then rejects the entire DSL.
 *
 * This sanitizer mirrors ENTRY_PATTERNS in TypeScript so the Node side can
 * pre-clean the LLM output. Any disallowed key is dropped (with a logged
 * warning); any out-of-range numeric value is clamped to the nearest
 * boundary. Required params that are missing get a sane default at the
 * midpoint of the allowed range.
 *
 * Pass 19 Track D (added 2026-05-11) — closes the LLM↔compiler param
 * mismatch that was blocking every cross-validated strategy from landing.
 */

import { logger } from "../index.js";

interface PatternSpec {
  required: string[];
  optional: string[];
  ranges: Record<string, [number, number]>;
}

// Mirrors src/engine/compiler/pattern_library.py ENTRY_PATTERNS.
// Keep these in sync — see scripts/sync-pattern-library.mjs (future) or
// add a build-time check that diffs the two.
export const ENTRY_PATTERN_ALLOWLIST: Record<string, PatternSpec> = {
  sma_crossover:        { required: ["fast_period", "slow_period"], optional: ["confirmation_bars"], ranges: { fast_period: [5, 50], slow_period: [20, 200], confirmation_bars: [1, 5] } },
  ema_crossover:        { required: ["fast_period", "slow_period"], optional: ["confirmation_bars"], ranges: { fast_period: [5, 50], slow_period: [20, 200], confirmation_bars: [1, 5] } },
  rsi_reversal:         { required: ["period", "oversold", "overbought"], optional: [], ranges: { period: [7, 21], oversold: [20, 40], overbought: [60, 80] } },
  bollinger_breakout:   { required: ["period", "std_dev"], optional: ["confirmation_bars"], ranges: { period: [10, 30], std_dev: [1.5, 3.0], confirmation_bars: [1, 3] } },
  atr_breakout:         { required: ["period", "multiplier"], optional: [], ranges: { period: [10, 30], multiplier: [1.0, 3.0] } },
  vwap_reversion:       { required: ["deviation_threshold"], optional: ["confirmation_bars"], ranges: { deviation_threshold: [0.5, 3.0], confirmation_bars: [1, 5] } },
  donchian_breakout:    { required: ["period"], optional: [], ranges: { period: [10, 55] } },
  keltner_squeeze:      { required: ["bb_period", "kc_period", "kc_multiplier"], optional: [], ranges: { bb_period: [15, 25], kc_period: [15, 25], kc_multiplier: [1.0, 2.0] } },
  session_open_breakout:{ required: ["range_minutes"], optional: ["buffer_ticks"], ranges: { range_minutes: [5, 60], buffer_ticks: [1, 10] } },
  macd_crossover:       { required: ["fast_period", "slow_period", "signal_period"], optional: [], ranges: { fast_period: [8, 16], slow_period: [20, 30], signal_period: [7, 12] } },
  vwap_fade:            { required: ["atr_extension_threshold"], optional: ["confirmation_bars", "vwap_touch_exit"], ranges: { atr_extension_threshold: [1.0, 3.0], confirmation_bars: [1, 5], vwap_touch_exit: [0, 1] } },
  event_driven_fade:    { required: ["atr_move_threshold", "event_window_minutes"], optional: ["confirmation_bars"], ranges: { atr_move_threshold: [1.5, 4.0], event_window_minutes: [5, 30], confirmation_bars: [1, 3] } },
  overnight_drift:      { required: ["drift_atr_threshold", "asia_lookback_bars"], optional: ["min_drift_bars"], ranges: { drift_atr_threshold: [0.5, 2.0], asia_lookback_bars: [4, 24], min_drift_bars: [2, 12] } },
};

export interface SanitizeResult {
  sanitizedParams: Record<string, number>;
  warnings: string[];
}

function clampToRange(value: number, [lo, hi]: [number, number]): number {
  if (Number.isNaN(value)) return (lo + hi) / 2;
  if (value < lo) return lo;
  if (value > hi) return hi;
  return value;
}

/**
 * Sanitize entry_params for a specific entry_indicator. Returns the cleaned
 * params object plus warnings array. The compiler will accept the result.
 *
 * Behaviors:
 *  - Unknown indicators: pass through unchanged with a warning (let compiler
 *    reject with its own error message).
 *  - Disallowed params: dropped silently from output, recorded in warnings.
 *  - Out-of-range numeric params: clamped to nearest boundary.
 *  - Required params missing: filled with range midpoint.
 *  - Non-numeric values for numeric params: replaced with range midpoint.
 */
export function sanitizeEntryParams(
  indicator: string,
  rawParams: Record<string, unknown> | undefined,
): SanitizeResult {
  const warnings: string[] = [];
  const spec = ENTRY_PATTERN_ALLOWLIST[indicator];

  if (!spec) {
    warnings.push(`sanitizer: unknown indicator '${indicator}' — passing params through unchanged`);
    return {
      sanitizedParams: (rawParams && typeof rawParams === "object" ? rawParams : {}) as Record<string, number>,
      warnings,
    };
  }

  const params = rawParams ?? {};
  const allowed = new Set<string>([...spec.required, ...spec.optional]);
  const sanitized: Record<string, number> = {};

  // Step 1: keep only allowed keys with numeric values, clamp to range
  for (const [key, value] of Object.entries(params)) {
    if (!allowed.has(key)) {
      warnings.push(`sanitizer: dropped disallowed param '${key}' for '${indicator}' (value was ${JSON.stringify(value)})`);
      continue;
    }
    const numericValue = typeof value === "number" ? value : Number(value);
    const range = spec.ranges[key];
    if (!range) {
      // Param is allowed but has no defined range — preserve as-is if numeric
      if (!Number.isNaN(numericValue)) sanitized[key] = numericValue;
      continue;
    }
    const clamped = clampToRange(numericValue, range);
    if (clamped !== numericValue) {
      warnings.push(`sanitizer: clamped '${key}' from ${numericValue} to ${clamped} (allowed range [${range[0]}, ${range[1]}])`);
    }
    sanitized[key] = clamped;
  }

  // Step 2: backfill missing required params with range midpoint
  for (const req of spec.required) {
    if (!(req in sanitized)) {
      const range = spec.ranges[req];
      const midpoint = range ? Math.round(((range[0] + range[1]) / 2) * 10) / 10 : 0;
      sanitized[req] = midpoint;
      warnings.push(`sanitizer: filled missing required param '${req}' with midpoint ${midpoint} for '${indicator}'`);
    }
  }

  if (warnings.length > 0) {
    logger.info(
      { indicator, sanitized, warnings, originalParams: rawParams },
      "dsl-sanitizer: applied cleanup before compile",
    );
  }
  return { sanitizedParams: sanitized, warnings };
}

/**
 * Top-level DSL field allowlist. Anything not in this set is stripped before
 * compile. Closes the pre-existing bug where `runDslQualityCritic` mutated the
 * DSL with `critic_score` and `critic_source` fields that the Python compiler
 * (pydantic with `extra='forbid'`) rejected, breaking every cross-validated
 * strategy graduation.
 *
 * Source of truth: `src/engine/compiler/strategy_schema.py` StrategyDSL model.
 * Keep in sync — add a build-time check in a future hardening pass.
 */
const ALLOWED_DSL_TOP_LEVEL = new Set([
  "name", "description", "symbol", "timeframe", "direction",
  "entry_type", "entry_indicator", "entry_params", "entry_condition",
  "exit_type", "exit_params", "stop_loss_atr_multiple", "take_profit_atr_multiple",
  "preferred_regime", "session_filter", "max_contracts",
  "tags", "source", "schema_version", "chart_construction",
  "profit_scaling_tier", "bypass_news_blackout", "daily_target_dollars",
  "frankenstein_test_mode", "sizing_method",
]);

/**
 * Sanitize a full DSL object: strip non-schema top-level fields AND
 * clean entry_params (via sanitizeEntryParams).
 *
 * Returns the cleaned DSL plus combined warnings array.
 */
export function sanitizeDsl(rawDsl: Record<string, unknown>): { sanitizedDsl: Record<string, unknown>; warnings: string[] } {
  const warnings: string[] = [];
  if (!rawDsl || typeof rawDsl !== "object") {
    return { sanitizedDsl: rawDsl as Record<string, unknown>, warnings };
  }

  const dsl: Record<string, unknown> = { ...rawDsl };
  for (const key of Object.keys(dsl)) {
    if (!ALLOWED_DSL_TOP_LEVEL.has(key)) {
      warnings.push(`sanitizer: stripped non-schema top-level field '${key}' (value was ${JSON.stringify(dsl[key]).slice(0, 60)})`);
      delete dsl[key];
    }
  }

  const indicator = typeof dsl.entry_indicator === "string" ? dsl.entry_indicator : "";
  if (indicator) {
    const { sanitizedParams, warnings: paramWarnings } = sanitizeEntryParams(indicator, dsl.entry_params as Record<string, unknown> | undefined);
    dsl.entry_params = sanitizedParams;
    warnings.push(...paramWarnings);
  }

  if (warnings.length > 0) {
    logger.info({ warnings, dsl_name: dsl.name }, "dsl-sanitizer: full DSL cleanup applied");
  }
  return { sanitizedDsl: dsl, warnings };
}
