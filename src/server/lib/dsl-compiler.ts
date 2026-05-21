/**
 * Wave 15 (2026-05-18) — DSL compiler: pattern → primitive indicators + parseable grammar.
 *
 * THE BUG (caught by parallel agent + verified): Trading Forge stored "pattern"
 * entry_indicator types (`ema_crossover`, `rsi_reversal`, `bollinger_breakout`)
 * directly in strategies.config.indicators[0].type. But the Python engine's
 * `compute_indicators(df, configs)` (src/engine/indicators/core.py) only handles
 * PRIMITIVE indicator types — sma, ema, rsi, atr, macd, bbands, vwap, adx, adr.
 * It silently does nothing for "ema_crossover" since there's no match in the
 * dispatcher. Result: NO indicator columns computed → signals.py tries to
 * evaluate prose entry_long ("After 9 EMA crosses above 21 EMA...") → parser
 * throws "Cannot parse expression". No graduated strategy has ever backtested.
 *
 * THE FIX: at graduation time, translate the pattern + params into:
 *   1. An indicators[] array of primitive (ema/sma/rsi/bbands/atr/etc) configs
 *      that compute_indicators understands
 *   2. entry_long / entry_short strings in the parseable grammar
 *      ("ema_9 crosses_above ema_21", "rsi_14 < 30", "close > bb_upper_20", etc.)
 *
 * Indicator column naming convention (must mirror src/engine/indicators/core.py):
 *   ema_<period>, sma_<period>, rsi_<period>, atr_<period>, adx_<period>
 *   bb_upper_<period>, bb_middle_<period>, bb_lower_<period>
 *   vwap, macd_line, macd_signal, macd_hist
 *
 * Grammar ops (from src/engine/signals.py):
 *   crosses_above, crosses_below, >, <, >=, <=, ==
 *   Combinators: AND, OR, NOT
 *
 * W23G.11 (2026-05-19) — Multi-indicator (confluence) + multi-timeframe (MTF) DSL.
 *
 * CONFLUENCE:
 *   confirming_indicators[] lets a strategy require multiple indicator conditions
 *   to ALL agree (or N-of-M) before triggering. The compiler AND-chains them
 *   into the entry_long/entry_short grammar strings. The engine's signals.py
 *   already evaluates `A AND B AND C` — no engine changes needed.
 *
 * MULTI-TIMEFRAME:
 *   bias_timeframe + bias_condition let a strategy gate entries against a
 *   higher-TF condition (e.g. "4H EMA50 > EMA200 = bullish bias → only enter
 *   longs on 15m signals"). HOWEVER, compute_indicators (core.py) does NOT
 *   currently support per-TF resampling or TF-suffixed columns (ema_50_4h).
 *   Per the W23G.11 spec: if MTF is not supported, FAIL-CLOSED — refuse to
 *   emit MTF grammar, log audit event dsl_compiler.mtf_unsupported, return
 *   the single-TF portion only.
 *
 *   MTF support will require a future engine pass (compute_indicators resampler +
 *   column naming "ema_50_4h"). Until then, MTF strategies compile with the
 *   bias_timeframe field preserved on config (for future use) but WITHOUT the
 *   HTF AND-gate in the entry grammar.
 */

import { logger } from "./logger.js";

export interface PrimitiveIndicator {
  type: "sma" | "ema" | "rsi" | "atr" | "macd" | "bbands" | "vwap" | "adx" | "adr" | "opening_range_breakout" | "donchian";
  period?: number;
  fast?: number;
  slow?: number;
  signal?: number;
  std_dev?: number;
  // ORB-specific (opening_range_breakout)
  range_minutes?: number;
  session_start_et?: string;
}

/** One confirming indicator in a confluence strategy. All fields required. */
export interface ConfirmingIndicator {
  indicator: string;
  params: Record<string, number>;
  direction: "agree" | "disagree" | "either";
  weight?: number; // 0.0–1.0, defaults to 1.0
}

export interface CompiledStrategy {
  indicators: PrimitiveIndicator[];
  entry_long: string;
  entry_short: string;
  /** Why this pattern was compiled this way — for audit/debug visibility */
  compileNotes: string[];
  /** Set to true when a bias_timeframe was present but could not be compiled (MTF unsupported) */
  mtfUnsupported?: boolean;
}

export interface DslCompileInput {
  entry_indicator: string;
  entry_params: Record<string, unknown>;
  direction: "long" | "short" | "both";
  /** W23G.11: Optional confluence confirming indicators */
  confirming_indicators?: ConfirmingIndicator[];
  /** W23G.11: How many factors (primary + confirming) must be satisfied. Default = all */
  min_factors_satisfied?: number;
  /** W23G.11: Higher-timeframe bias condition (e.g. "4h"). FAIL-CLOSED if present (unsupported). */
  bias_timeframe?: string | null;
  /** W23G.11: HTF bias condition string (e.g. "ema_50_4h > ema_200_4h"). Reserved for future use. */
  bias_condition?: string | null;
}

const TIMEFRAME_TO_BARS: Record<string, number> = { "1m": 1, "5m": 5, "15m": 15, "30m": 30, "1h": 60, "4h": 240, "1d": 1440 };

function num(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

/**
 * W23G.11 — Translate a single confirming indicator to a grammar clause pair.
 *
 * Returns { longClause, shortClause, indicators } or null if the indicator
 * is not supported (caller should log + skip that confirming indicator).
 *
 * The `direction` param controls which side is "agree":
 *   - agree: confirming condition fires in same direction as primary
 *   - disagree: confirming fires in OPPOSITE direction (rare; used for divergence)
 *   - either: confirming must be true regardless of direction (used for filters)
 *
 * Max 5 params per indicator (CLAUDE.md §13).
 */
function compileConfirmingIndicator(
  ci: ConfirmingIndicator,
): { longClause: string; shortClause: string; indicators: PrimitiveIndicator[] } | null {
  const ind = ci.indicator;
  const p = ci.params ?? {};
  const dir = ci.direction ?? "agree";

  const makeClause = (longExpr: string, shortExpr: string) => {
    if (dir === "agree") return { longClause: longExpr, shortClause: shortExpr };
    if (dir === "disagree") return { longClause: shortExpr, shortClause: longExpr };
    // "either" — both directions use the same (non-directional) condition
    return { longClause: longExpr, shortClause: longExpr };
  };

  // ema / sma crossover confirming
  if (ind === "ema_crossover" || ind === "sma_crossover") {
    const primitive = ind === "sma_crossover" ? "sma" : "ema";
    const fast = num(p.fast_period, 9);
    const slow = num(p.slow_period, 21);
    const { longClause, shortClause } = makeClause(
      `${primitive}_${fast} crosses_above ${primitive}_${slow}`,
      `${primitive}_${fast} crosses_below ${primitive}_${slow}`,
    );
    return { longClause, shortClause, indicators: [{ type: primitive, period: fast }, { type: primitive, period: slow }] };
  }

  // rsi threshold confirming
  if (ind === "rsi" || ind === "rsi_reversal") {
    const period = num(p.period, 14);
    const overBought = num(p.overbought ?? p.threshold_lt, 70);
    const overSold = num(p.oversold ?? p.threshold_gt, 30);
    const { longClause, shortClause } = makeClause(
      `rsi_${period} < ${overBought}`,  // long: rsi below overbought (not extended)
      `rsi_${period} > ${overSold}`,   // short: rsi above oversold (not oversold)
    );
    // For "agree" direction: long entry only when rsi is below overbought (confirming bullish momentum)
    // For specific threshold: use explicit threshold_gt/threshold_lt if provided
    const longExpr = p.threshold_gt !== undefined ? `rsi_${period} > ${num(p.threshold_gt, 50)}` :
                     p.threshold_lt !== undefined ? `rsi_${period} < ${num(p.threshold_lt, 50)}` :
                     `rsi_${period} < ${overBought}`;
    const shortExpr = p.threshold_gt !== undefined ? `rsi_${period} < ${num(p.threshold_gt, 50)}` :
                      p.threshold_lt !== undefined ? `rsi_${period} > ${num(p.threshold_lt, 50)}` :
                      `rsi_${period} > ${overSold}`;
    const finalClauses = makeClause(longExpr, shortExpr);
    return { longClause: finalClauses.longClause, shortClause: finalClauses.shortClause, indicators: [{ type: "rsi", period }] };
  }

  // vwap above/below confirming ("price_above" condition)
  if (ind === "vwap") {
    const condition = String(p.condition ?? "price_above");
    const { longClause, shortClause } = makeClause(
      condition === "price_above" ? "close > vwap" : "close < vwap",
      condition === "price_above" ? "close < vwap" : "close > vwap",
    );
    return { longClause, shortClause, indicators: [{ type: "vwap" }] };
  }

  // ema position confirming (price above/below ema)
  if (ind === "ema" || ind === "ema_filter") {
    const period = num(p.period, 50);
    const { longClause, shortClause } = makeClause(
      `close > ema_${period}`,
      `close < ema_${period}`,
    );
    return { longClause, shortClause, indicators: [{ type: "ema", period }] };
  }

  // sma position confirming
  if (ind === "sma" || ind === "sma_filter") {
    const period = num(p.period, 200);
    const { longClause, shortClause } = makeClause(
      `close > sma_${period}`,
      `close < sma_${period}`,
    );
    return { longClause, shortClause, indicators: [{ type: "sma", period }] };
  }

  // macd confirming
  if (ind === "macd" || ind === "macd_crossover") {
    const fast = num(p.fast_period, 12);
    const slow = num(p.slow_period, 26);
    const signal = num(p.signal_period, 9);
    const { longClause, shortClause } = makeClause(
      "macd_line crosses_above macd_signal",
      "macd_line crosses_below macd_signal",
    );
    return { longClause, shortClause, indicators: [{ type: "macd", fast, slow, signal }] };
  }

  // bollinger band position confirming
  if (ind === "bbands" || ind === "bollinger_breakout") {
    const period = num(p.period, 20);
    const stdDev = num(p.std_dev, 2.0);
    const { longClause, shortClause } = makeClause(
      `close > bb_upper_${period}`,
      `close < bb_lower_${period}`,
    );
    return { longClause, shortClause, indicators: [{ type: "bbands", period, std_dev: stdDev }] };
  }

  // ORB confirming (must be above/below ORH/ORL)
  if (ind === "session_open_breakout" || ind === "orb") {
    const rangeMin = num(p.range_minutes, 15);
    const sessionStart = typeof p.session_start_et === "string" ? p.session_start_et : "09:30";
    const { longClause, shortClause } = makeClause(
      `close > orh_${rangeMin}m`,
      `close < orl_${rangeMin}m`,
    );
    return {
      longClause, shortClause,
      indicators: [{ type: "opening_range_breakout" as any, period: rangeMin, range_minutes: rangeMin, session_start_et: sessionStart }],
    };
  }

  // Not supported
  return null;
}

/**
 * Compile a pattern-typed entry into engine-runnable indicators + grammar.
 * Returns null if the pattern is not supported (caller should keep prose
 * entry_long as a structural-archetype hint and let archetype detectors handle it).
 */
export function compileDslToEngine(input: DslCompileInput): CompiledStrategy | null {
  const ind = input.entry_indicator;
  const p = input.entry_params ?? {};
  const dir = input.direction;
  const notes: string[] = [];

  // ── ema_crossover / sma_crossover / dema_crossover ──────────────────────
  if (ind === "ema_crossover" || ind === "sma_crossover" || ind === "dema_crossover") {
    const primitive = ind === "sma_crossover" ? "sma" : "ema";  // dema not in compute_indicators; alias to ema
    const fast = num(p.fast_period, 9);
    const slow = num(p.slow_period, 21);
    notes.push(`${ind}{fast=${fast},slow=${slow}} → ${primitive}_${fast} crosses_above ${primitive}_${slow}`);
    return {
      indicators: [{ type: primitive, period: fast }, { type: primitive, period: slow }],
      entry_long:  dir === "short" ? "high < low" : `${primitive}_${fast} crosses_above ${primitive}_${slow}`,
      entry_short: dir === "long"  ? "high < low" : `${primitive}_${fast} crosses_below ${primitive}_${slow}`,
      compileNotes: notes,
    };
  }

  // ── rsi_reversal / connors_rsi2 ─────────────────────────────────────────
  // F-3 (2026-05-20): connors_rsi2 compiles identically to rsi_reversal at the
  // engine primitive level (both use the RSI indicator with period + thresholds).
  // The distinction is only in the TS param-validation layer where connors_rsi2
  // allows period=[2,5] / oversold=[3,10] / overbought=[90,97]. At compile time
  // both become { type:"rsi", period } → rsi_<period> < oversold / > overbought.
  if (ind === "rsi_reversal" || ind === "rsi_divergence" || ind === "connors_rsi2") {
    // connors_rsi2 canonical defaults: period=2, oversold=5, overbought=95
    const defaultPeriod = ind === "connors_rsi2" ? 2 : 14;
    const defaultOversold = ind === "connors_rsi2" ? 5 : 30;
    const defaultOverbought = ind === "connors_rsi2" ? 95 : 70;
    const period = num(p.period, defaultPeriod);
    const oversold = num(p.oversold, defaultOversold);
    const overbought = num(p.overbought, defaultOverbought);
    notes.push(`${ind}{period=${period},over=${oversold}/${overbought}} → rsi_${period} thresholds`);
    return {
      indicators: [{ type: "rsi", period }],
      entry_long:  dir === "short" ? "high < low" : `rsi_${period} < ${oversold}`,
      entry_short: dir === "long"  ? "high < low" : `rsi_${period} > ${overbought}`,
      compileNotes: notes,
    };
  }

  // ── bollinger_breakout ──────────────────────────────────────────────────
  if (ind === "bollinger_breakout") {
    const period = num(p.period, 20);
    const stdDev = num(p.std_dev, 2.0);
    notes.push(`bollinger_breakout{period=${period},std=${stdDev}} → close vs bb_upper/lower_${period}`);
    return {
      indicators: [{ type: "bbands", period, std_dev: stdDev }],
      entry_long:  dir === "short" ? "high < low" : `close > bb_upper_${period}`,
      entry_short: dir === "long"  ? "high < low" : `close < bb_lower_${period}`,
      compileNotes: notes,
    };
  }

  // ── macd_crossover ──────────────────────────────────────────────────────
  if (ind === "macd_crossover") {
    const fast = num(p.fast_period, 12);
    const slow = num(p.slow_period, 26);
    const signal = num(p.signal_period, 9);
    notes.push(`macd_crossover{${fast}/${slow}/${signal}} → macd_line crosses_above macd_signal`);
    return {
      indicators: [{ type: "macd", fast, slow, signal }],
      entry_long:  dir === "short" ? "high < low" : `macd_line crosses_above macd_signal`,
      entry_short: dir === "long"  ? "high < low" : `macd_line crosses_below macd_signal`,
      compileNotes: notes,
    };
  }

  // ── atr_breakout ────────────────────────────────────────────────────────
  // F-6 fix (2026-05-20): atr_breakout is UNSUPPORTED -- emit null.
  // True formula: close > prev_close + mult*ATR requires shift(1) on close,
  // which signals.py does not support. Previous code silently substituted
  // close > vwap -- a DIFFERENT strategy. Never silently wrong.
  if (ind === "atr_breakout" || ind === "atr_trailing_stop") {
    const period = num(p.period ?? p.atr_period, 14);
    const mult = num(p.multiplier, 1.5);
    logger.warn(
      { indicator: ind, period, multiplier: mult },
      "dsl-compiler F-6: atr_breakout unsupported -- shift() not in signals.py. Returning null.",
    );
    return null;
  }

  // ── donchian_breakout ───────────────────────────────────────────────────
  // F-7 fix (2026-05-20): donchian_breakout now compiles honestly.
  // compute_donchian() added to core.py: rolling_max/min with shift(1) no-lookahead.
  // Previous code substituted close > sma_N -- wrong (mean filter != channel breakout).
  if (ind === "donchian_breakout") {
    const period = num(p.period, 20);
    notes.push(
      `donchian_breakout{period=${period}} -> donchian_upper_${period}/donchian_lower_${period}. ` +
      "F-7 fix: compute_donchian() in core.py (rolling_max/min shift(1), no lookahead).",
    );
    return {
      indicators: [{ type: "atr" as any, period: 14 }, { type: "donchian" as any, period }],
      entry_long:  dir === "short" ? "high < low" : `close > donchian_upper_${period}`,
      entry_short: dir === "long"  ? "high < low" : `close < donchian_lower_${period}`,
      compileNotes: notes,
    };
  }

  // ── session_open_breakout (ORB) ─────────────────────────────────────────
  // Wave 13 A.2: opening_range_breakout indicator now landed in
  // src/engine/indicators/core.py — emits orh_{N}m / orl_{N}m / or_range_{N}m.
  // Entry grammar: close > orh_{N}m (breakout above OR high).
  // Structural stop sits at orl_{N}m (engine reads this via exit_params.stop_ref).
  if (ind === "session_open_breakout") {
    const rangeMinutes = num(p.range_minutes, 15);
    const sessionStartEt = typeof p.session_start_et === "string" ? p.session_start_et : "09:30";
    notes.push(`session_open_breakout{range_minutes=${rangeMinutes}} → opening_range_breakout indicator → close > orh_${rangeMinutes}m`);
    return {
      indicators: [
        { type: "opening_range_breakout" as any, period: rangeMinutes, range_minutes: rangeMinutes, session_start_et: sessionStartEt },
        { type: "atr", period: 14 },
      ],
      entry_long:  dir === "short" ? "high < low" : `close > orh_${rangeMinutes}m`,
      entry_short: dir === "long"  ? "high < low" : `close < orl_${rangeMinutes}m`,
      compileNotes: [...notes, `ORB indicator landed Wave 13 A.2 — no-lookahead, ET-aware, resets daily`],
    };
  }

  // ── vwap_fade / vwap_reversion ──────────────────────────────────────────
  if (ind === "vwap_fade" || ind === "vwap_reversion") {
    notes.push(`${ind} → close vs vwap (fade = close > vwap → short; close < vwap → long)`);
    return {
      indicators: [{ type: "vwap" }, { type: "atr", period: 14 }],
      // Fade: when price extends above VWAP, expect mean-reversion → enter short
      // When price extends below VWAP, expect mean-reversion → enter long
      entry_long:  dir === "short" ? "high < low" : `close < vwap`,
      entry_short: dir === "long"  ? "high < low" : `close > vwap`,
      compileNotes: notes,
    };
  }

  // ── archetype: passed through as-is, engine archetype-strategy class handles it ──
  if (ind.startsWith("archetype:")) {
    notes.push(`${ind} — structural archetype; engine class-based handler will read indicators[0].type`);
    return {
      indicators: [{ type: "atr", period: 14 }],  // ATR required for sizing regardless of strategy
      entry_long: "high < low",   // never-true sentinel; archetype handler generates signals from market structure
      entry_short: "high < low",
      compileNotes: [...notes, "Archetype strategies use engine class-based handler; entry_long is structural-detector-driven, not parsed by signals.py"],
    };
  }

  // ── Unsupported pattern → return null, caller logs + skips ─────────────
  logger.warn({ indicator: ind, params: p }, "dsl-compiler: unsupported pattern indicator — graduator will skip this DSL");
  return null;
}

/**
 * W23G.11 — Extend a compiled single-indicator result with confluence conditions.
 *
 * Takes a base CompiledStrategy (from compileDslToEngine) and AND-chains any
 * confirming_indicators into entry_long / entry_short.
 *
 * - If min_factors_satisfied == total count → AND-chain all conditions (strict)
 * - If min_factors_satisfied < total count → emit OR-within-AND structure using
 *   engine's native OR combinator. Grammar:
 *     `<primary> AND (<c1> OR <c2>)` when min=2 of 3 total
 *   NOTE: signals.py evaluates OR before AND (lower precedence), so the
 *   OR group must be fully evaluated as a group. Because signals.py splits on
 *   whitespace-padded AND/OR, we can safely build "A AND B OR C" expressions
 *   where A=primary, B OR C = confirming. However for min_factors_satisfied < total,
 *   true counting semantics require application-level logic not supported in the
 *   current grammar. Fallback: when min < total, emit ALL confirming as AND
 *   (conservative — avoids broken grammar). Log a compile note.
 *
 * Returns a new CompiledStrategy with combined grammar.
 * Returns base unchanged if no confirming_indicators are provided and no MTF gate.
 *
 * MTF (bias_timeframe): W23H.1 — ACTIVE gate (replaces W23G.11 fail-CLOSED).
 *   - If bias_timeframe + bias_condition are present, AND-gate the bias_condition
 *     into the entry_long/entry_short grammar for BOTH sides.
 *   - The bias_condition already uses suffixed column names (e.g. 'ema_50_4h > ema_200_4h')
 *     as emitted by the transcript extractor. No column-name translation needed here.
 *   - The engine's signals.py evaluate_expression() accepts arbitrary column names;
 *     compute_htf_indicators() in core.py produces the suffixed columns at backtest time.
 *   - A direction-aware gate: for LONG entries, bias_condition is AND-gated directly.
 *     For SHORT entries, bias_condition is AND-gated directly (the condition itself
 *     encodes directionality, e.g. 'ema_50_4h < ema_200_4h' for bearish bias).
 *     If bias_condition has no directional implication (e.g. 'rsi_14_4h > 50'),
 *     it gates both sides equally — this is intentional (filters noise both ways).
 */
export function applyConfluenceToCompiled(
  base: CompiledStrategy,
  input: Pick<DslCompileInput, "confirming_indicators" | "min_factors_satisfied" | "bias_timeframe" | "bias_condition">,
): CompiledStrategy {
  const confirmings = input.confirming_indicators ?? [];
  const biasTimeframe = input.bias_timeframe ?? null;
  const biasCondition = (input.bias_condition ?? "").trim();
  const notes = [...base.compileNotes];

  // ── MTF: AND-gate bias_condition into grammar (W23H.1) ────────────────────
  // When bias_timeframe + bias_condition are both present, AND-gate the condition
  // into the entry grammar. The bias_condition uses pre-suffixed column names
  // (e.g. 'ema_50_4h > ema_200_4h') that the engine's forward_fill_htf_to_exec()
  // will make available as columns in the exec_df before signal evaluation.
  let baseLongWithBias = base.entry_long;
  let baseShortWithBias = base.entry_short;

  if (biasTimeframe && biasCondition) {
    logger.info(
      { bias_timeframe: biasTimeframe, bias_condition: biasCondition },
      "dsl-compiler W23H.1: MTF bias gate active — AND-gating bias_condition into entry grammar",
    );

    const longIssentinel = base.entry_long === "high < low";
    const shortIssentinel = base.entry_short === "high < low";

    if (!longIssentinel) {
      baseLongWithBias = `(${base.entry_long}) AND (${biasCondition})`;
      notes.push(
        `mtf.bias_gate: bias_timeframe='${biasTimeframe}' → entry_long AND-gated with '${biasCondition}'`,
      );
    }
    if (!shortIssentinel) {
      baseShortWithBias = `(${base.entry_short}) AND (${biasCondition})`;
      notes.push(
        `mtf.bias_gate: bias_timeframe='${biasTimeframe}' → entry_short AND-gated with '${biasCondition}'`,
      );
    }
  } else if (biasTimeframe && !biasCondition) {
    // bias_timeframe set but no condition — log advisory only, no grammar change.
    // This can happen if the extractor set bias_timeframe but left bias_condition empty.
    notes.push(
      `mtf.bias_timeframe_no_condition: bias_timeframe='${biasTimeframe}' present but bias_condition is empty — no HTF gate applied`,
    );
    logger.warn(
      { bias_timeframe: biasTimeframe },
      "dsl-compiler W23H.1: bias_timeframe set but bias_condition is empty — HTF gate cannot be applied",
    );
  }

  // Build a synthetic base with bias-gated grammar for downstream confluence processing
  const biasedBase: CompiledStrategy = {
    ...base,
    entry_long: baseLongWithBias,
    entry_short: baseShortWithBias,
    compileNotes: notes,
  };

  // ── No confirming indicators — return bias-gated base ─────────────────────
  if (confirmings.length === 0) {
    return biasedBase;
  }

  // ── Compile each confirming indicator ─────────────────────────────────────
  // Direction-sentinel awareness: if the base entry_long/entry_short is the
  // never-true sentinel "high < low" (set when direction is one-sided), we must
  // NOT add confirming clauses to that side. Doing so would replace the sentinel
  // with a real condition and accidentally fire the disabled direction.
  // NOTE: use biasedBase here (which already has MTF gate applied if present).
  const baseLongIssentinel = biasedBase.entry_long === "high < low";
  const baseShortIssentinel = biasedBase.entry_short === "high < low";

  const longClauses: string[] = baseLongIssentinel ? [] : [biasedBase.entry_long];
  const shortClauses: string[] = baseShortIssentinel ? [] : [biasedBase.entry_short];
  const extraIndicators: PrimitiveIndicator[] = [];
  const skippedIndicators: string[] = [];

  for (const ci of confirmings) {
    const compiled = compileConfirmingIndicator(ci);
    if (!compiled) {
      skippedIndicators.push(ci.indicator);
      notes.push(`confluence: confirming indicator '${ci.indicator}' not supported — skipped from grammar`);
      continue;
    }
    // Direction-sentinel gating: if the base direction is disabled (never-true sentinel),
    // do NOT add confirming clauses to that side — that would re-enable a disabled direction.
    // Only add non-sentinel clauses (skip "high < low" — never-true sentinels from single-dir base)
    if (!baseLongIssentinel && compiled.longClause !== "high < low") {
      longClauses.push(compiled.longClause);
    }
    if (!baseShortIssentinel && compiled.shortClause !== "high < low") {
      shortClauses.push(compiled.shortClause);
    }
    extraIndicators.push(...compiled.indicators);
    notes.push(`confluence: +${ci.indicator} (dir=${ci.direction}) → long=${compiled.longClause}, short=${compiled.shortClause}`);
  }

  if (skippedIndicators.length > 0) {
    logger.warn(
      { skippedIndicators },
      "dsl-compiler: some confirming indicators are unsupported and were skipped from confluence grammar",
    );
  }

  // ── min_factors_satisfied resolution ──────────────────────────────────────
  const totalFactors = 1 + confirmings.length; // primary + all confirmings
  const satisfiedTarget = input.min_factors_satisfied ?? totalFactors;

  if (satisfiedTarget < totalFactors) {
    // Partial-satisfaction (N-of-M) is not natively expressible in the grammar
    // without counting semantics. Fall back to AND-chain (conservative; requires all).
    notes.push(
      `confluence.min_factors_satisfied=${satisfiedTarget}/${totalFactors}: OR-counting not supported in grammar — AND-chaining all conditions (conservative fallback; requires all factors)`,
    );
  }

  // Deduplicate indicators by type+period (avoids duplicate ema_9, ema_21 in array)
  // Use biasedBase.indicators (same as base.indicators — MTF gate doesn't add new LTF indicators)
  const allIndicators = dedupeIndicators([...biasedBase.indicators, ...extraIndicators]);

  // Build AND-chained entry grammar from collected clauses
  // Guard: only chain valid (non-sentinel) clauses for each direction
  const validLongClauses = longClauses.filter(c => c && c !== "high < low");
  const validShortClauses = shortClauses.filter(c => c && c !== "high < low");

  // If the base was a direction-sentinel, preserve it even if no clauses collected
  const finalEntryLong = baseLongIssentinel && validLongClauses.length === 0
    ? "high < low"
    : validLongClauses.length > 0
      ? validLongClauses.join(" AND ")
      : "high < low";
  const finalEntryShort = baseShortIssentinel && validShortClauses.length === 0
    ? "high < low"
    : validShortClauses.length > 0
      ? validShortClauses.join(" AND ")
      : "high < low";

  notes.push(
    `confluence.result: entry_long='${finalEntryLong}', entry_short='${finalEntryShort}' (${validLongClauses.length} long conditions, ${validShortClauses.length} short conditions)`,
  );

  return {
    indicators: allIndicators,
    entry_long: finalEntryLong,
    entry_short: finalEntryShort,
    compileNotes: notes,
    // mtfUnsupported removed (W23H.1): MTF is now supported via AND-gate.
    // The field is still in CompiledStrategy type for backward compat with callers
    // that may read it. When bias_timeframe is set and bias_condition is non-empty,
    // the gate IS compiled into grammar; mtfUnsupported is false (default/undefined).
  };
}

/** Deduplicate primitive indicators by type + period (same type+period = same column). */
function dedupeIndicators(indicators: PrimitiveIndicator[]): PrimitiveIndicator[] {
  const seen = new Set<string>();
  const result: PrimitiveIndicator[] = [];
  for (const ind of indicators) {
    const key = `${ind.type}:${ind.period ?? ""}:${ind.fast ?? ""}:${ind.slow ?? ""}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(ind);
    }
  }
  return result;
}

/**
 * W23G.11 — Full compile: base indicator → primitive grammar → confluence extension.
 *
 * This is the preferred entry point for W23G.11+ callers. It compiles the primary
 * indicator via compileDslToEngine() then applies confluence + MTF handling via
 * applyConfluenceToCompiled().
 *
 * Returns null if the primary indicator is not supported (same contract as
 * compileDslToEngine). Returns CompiledStrategy with mtfUnsupported=true if
 * bias_timeframe was set (MTF not supported — fail-CLOSED, no bias in grammar).
 */
export function compileDslWithConfluence(input: DslCompileInput): CompiledStrategy | null {
  const base = compileDslToEngine(input);
  if (!base) return null;

  return applyConfluenceToCompiled(base, {
    confirming_indicators: input.confirming_indicators,
    min_factors_satisfied: input.min_factors_satisfied,
    bias_timeframe: input.bias_timeframe,
    bias_condition: input.bias_condition,
  });
}
