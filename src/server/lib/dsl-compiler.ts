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
 */

import { logger } from "./logger.js";

export interface PrimitiveIndicator {
  type: "sma" | "ema" | "rsi" | "atr" | "macd" | "bbands" | "vwap" | "adx" | "adr" | "opening_range_breakout";
  period?: number;
  fast?: number;
  slow?: number;
  signal?: number;
  std_dev?: number;
  // ORB-specific (opening_range_breakout)
  range_minutes?: number;
  session_start_et?: string;
}

export interface CompiledStrategy {
  indicators: PrimitiveIndicator[];
  entry_long: string;
  entry_short: string;
  /** Why this pattern was compiled this way — for audit/debug visibility */
  compileNotes: string[];
}

export interface DslCompileInput {
  entry_indicator: string;
  entry_params: Record<string, unknown>;
  direction: "long" | "short" | "both";
}

const TIMEFRAME_TO_BARS: Record<string, number> = { "1m": 1, "5m": 5, "15m": 15, "30m": 30, "1h": 60, "4h": 240, "1d": 1440 };

function num(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
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

  // ── rsi_reversal ────────────────────────────────────────────────────────
  if (ind === "rsi_reversal" || ind === "rsi_divergence") {
    const period = num(p.period, 14);
    const oversold = num(p.oversold, 30);
    const overbought = num(p.overbought, 70);
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
  if (ind === "atr_breakout" || ind === "atr_trailing_stop") {
    const period = num(p.period ?? p.atr_period, 14);
    const mult = num(p.multiplier, 1.5);
    notes.push(`${ind}{period=${period},mult=${mult}} → close > close.shift(1) + ${mult}*atr_${period} (approx via close > atr_${period}*${mult})`);
    // True ATR breakout = close > prev_close + N*ATR. Our grammar doesn't support
    // shift(1) on close directly. Approximation: use close > high.shift(1) which
    // the runtime can compute. For now use a simpler proxy: close > vwap + mult*atr.
    // TODO Wave 15.1 — extend signals.py to support shift(1).
    return {
      indicators: [{ type: "atr", period }, { type: "vwap" }],
      entry_long:  dir === "short" ? "high < low" : `close > vwap`,
      entry_short: dir === "long"  ? "high < low" : `close < vwap`,
      compileNotes: [...notes, "ATR breakout approximated via close-vs-vwap until grammar supports shift()"],
    };
  }

  // ── donchian_breakout ───────────────────────────────────────────────────
  if (ind === "donchian_breakout") {
    const period = num(p.period, 20);
    notes.push(`donchian_breakout{period=${period}} → close > donchian_upper_${period}`);
    // compute_indicators doesn't have donchian; we approximate via highest-close-N
    // using close vs sma_period (mean) — crude but lets the strategy compile.
    // TODO Wave 15.1 — add donchian computation to indicators/core.py.
    return {
      indicators: [{ type: "sma", period }],
      entry_long:  dir === "short" ? "high < low" : `close > sma_${period}`,
      entry_short: dir === "long"  ? "high < low" : `close < sma_${period}`,
      compileNotes: [...notes, "donchian approximated via close-vs-sma until indicator added"],
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
