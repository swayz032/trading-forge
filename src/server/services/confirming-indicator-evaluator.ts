/**
 * Wave 23H.D — Confirming Indicator Evaluator
 *
 * Evaluates per-strategy `confirming_indicators[]` at signal time.
 * Pure functions — no DB, no network, no side effects.
 *
 * Supports the same 10 indicator families as dsl-compiler.ts:
 *   ema / ema_filter / sma / sma_filter / rsi / rsi_reversal /
 *   vwap / macd / macd_crossover / bbands / bollinger_breakout /
 *   orb / session_open_breakout / atr / adx / adr
 *
 * Direction semantics:
 *   "agree"    — indicator must point in the SAME direction as the signal
 *   "disagree" — indicator must point in the OPPOSITE direction (contrarian)
 *   "either"   — always satisfied (non-conflicting filter; use for regime gates)
 *
 * Fail-safe: unknown indicator type → satisfied=false, reason='unknown_indicator:<name>'
 * Unknown indicator NEVER throws; never defaults to satisfied=true.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ConfirmingIndicator {
  indicator: string;
  params: Record<string, number>;
  direction: "agree" | "disagree" | "either";
  threshold_gt?: number;
  threshold_lt?: number;
  condition?: string;
}

export interface FactorResult {
  factor: string;
  satisfied: boolean;
  reason: string;
}

/**
 * Bar snapshot passed at evaluation time.
 * Matches the paper-signal-service Bar shape (only OHLCV needed here).
 */
export interface EvalBar {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * Flat indicator map at evaluation time.
 * Keys mirror computeIndicators() output in paper-signal-service:
 *   sma_N, ema_N, rsi_N, atr_N, vwap, bbands_20_upper/middle/lower,
 *   macd_line, macd_signal, macd_hist, adx_N, orh_Nm, orl_Nm, etc.
 */
export type IndicatorMap = Record<string, number | undefined>;

// ─── Internal helpers ─────────────────────────────────────────────────────────

function num(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v as string) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Apply direction inversion for "disagree" semantics.
 * "agree"    → return longSatisfied for long signals, shortSatisfied for short
 * "disagree" → swap: long signal requires short indicator condition
 * "either"   → always satisfied (pass regardless of direction)
 */
function applyDirection(
  direction: "agree" | "disagree" | "either",
  signalDirection: "long" | "short",
  longCondition: boolean,
  shortCondition: boolean,
): boolean {
  if (direction === "either") return true;
  if (direction === "agree") return signalDirection === "long" ? longCondition : shortCondition;
  // disagree: contrarian — long signal passes if SHORT indicator condition holds
  return signalDirection === "long" ? shortCondition : longCondition;
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Evaluate a single confirming indicator against current bar + indicator snapshot.
 *
 * @param confirming  - The confirming indicator spec from strategies.config.entry_quality.confirming_indicators[]
 * @param bar         - Current OHLCV bar
 * @param indicators  - Pre-computed indicator map (from computeIndicators() output)
 * @param signalDirection - "long" | "short" (the primary signal direction being evaluated)
 * @returns FactorResult with satisfied flag + human-readable reason
 */
export function evaluateConfirmingIndicator(
  confirming: ConfirmingIndicator,
  bar: EvalBar,
  indicators: IndicatorMap,
  signalDirection: "long" | "short",
): FactorResult {
  const ind = confirming.indicator;
  const p = confirming.params ?? {};
  const dir = confirming.direction ?? "agree";

  // ── "either" shortcut — always satisfied regardless of indicator ──────────
  if (dir === "either") {
    return { factor: ind, satisfied: true, reason: "direction_either_always_satisfied" };
  }

  // ── EMA position (price above/below EMA) ─────────────────────────────────
  if (ind === "ema" || ind === "ema_filter") {
    const period = num(p.period, 50);
    const emaVal = indicators[`ema_${period}`];
    if (emaVal === undefined || !Number.isFinite(emaVal)) {
      return { factor: ind, satisfied: false, reason: `ema_${period}_unavailable` };
    }
    const longCond = bar.close > emaVal;   // long: price above EMA = bullish
    const shortCond = bar.close < emaVal;  // short: price below EMA = bearish
    const satisfied = applyDirection(dir, signalDirection, longCond, shortCond);
    const verb = signalDirection === "long"
      ? (dir === "agree" ? (longCond ? "above" : "below") : (shortCond ? "below" : "above"))
      : (dir === "agree" ? (shortCond ? "below" : "above") : (longCond ? "above" : "below"));
    return {
      factor: ind,
      satisfied,
      reason: satisfied
        ? `ema_${period}_${verb}_price_${bar.close.toFixed(2)}_vs_${emaVal.toFixed(2)}`
        : `ema_${period}_not_${verb}_price_${bar.close.toFixed(2)}_vs_${emaVal.toFixed(2)}`,
    };
  }

  // ── SMA position (price above/below SMA) ─────────────────────────────────
  if (ind === "sma" || ind === "sma_filter") {
    const period = num(p.period, 200);
    const smaVal = indicators[`sma_${period}`];
    if (smaVal === undefined || !Number.isFinite(smaVal)) {
      return { factor: ind, satisfied: false, reason: `sma_${period}_unavailable` };
    }
    const longCond = bar.close > smaVal;
    const shortCond = bar.close < smaVal;
    const satisfied = applyDirection(dir, signalDirection, longCond, shortCond);
    return {
      factor: ind,
      satisfied,
      reason: satisfied
        ? `sma_${period}_ok_close_${bar.close.toFixed(2)}_sma_${smaVal.toFixed(2)}`
        : `sma_${period}_fail_close_${bar.close.toFixed(2)}_sma_${smaVal.toFixed(2)}`,
    };
  }

  // ── RSI threshold ─────────────────────────────────────────────────────────
  if (ind === "rsi" || ind === "rsi_reversal") {
    const period = num(p.period, 14);
    const rsiVal = indicators[`rsi_${period}`];
    if (rsiVal === undefined || !Number.isFinite(rsiVal)) {
      return { factor: ind, satisfied: false, reason: `rsi_${period}_unavailable` };
    }

    // Explicit threshold_gt or threshold_lt overrides agree/disagree semantics
    if (confirming.threshold_gt !== undefined) {
      const threshold = confirming.threshold_gt;
      const rawCond = rsiVal > threshold;
      // threshold_gt with agree: long signal satisfied if RSI > threshold (bullish momentum)
      // threshold_gt with disagree: long signal satisfied if RSI < threshold (contrarian)
      const satisfied = dir === "agree"
        ? (signalDirection === "long" ? rawCond : !rawCond)
        : (signalDirection === "long" ? !rawCond : rawCond);
      return {
        factor: ind,
        satisfied,
        reason: satisfied
          ? `rsi_${period}_${rsiVal.toFixed(1)}_threshold_gt_${threshold}_ok`
          : `rsi_${period}_${rsiVal.toFixed(1)}_threshold_gt_${threshold}_fail`,
      };
    }
    if (confirming.threshold_lt !== undefined) {
      const threshold = confirming.threshold_lt;
      const rawCond = rsiVal < threshold;
      const satisfied = dir === "agree"
        ? (signalDirection === "long" ? rawCond : !rawCond)
        : (signalDirection === "long" ? !rawCond : rawCond);
      return {
        factor: ind,
        satisfied,
        reason: satisfied
          ? `rsi_${period}_${rsiVal.toFixed(1)}_threshold_lt_${threshold}_ok`
          : `rsi_${period}_${rsiVal.toFixed(1)}_threshold_lt_${threshold}_fail`,
      };
    }

    // Default: agree direction = RSI > 50 for longs, RSI < 50 for shorts
    const longCond = rsiVal > 50;
    const shortCond = rsiVal < 50;
    const satisfied = applyDirection(dir, signalDirection, longCond, shortCond);
    return {
      factor: ind,
      satisfied,
      reason: satisfied
        ? `rsi_${period}_${rsiVal.toFixed(1)}_directional_ok`
        : `rsi_${period}_${rsiVal.toFixed(1)}_directional_fail`,
    };
  }

  // ── VWAP position ─────────────────────────────────────────────────────────
  if (ind === "vwap") {
    const vwapVal = indicators["vwap"];
    if (vwapVal === undefined || !Number.isFinite(vwapVal)) {
      return { factor: ind, satisfied: false, reason: "vwap_unavailable" };
    }

    // condition string overrides direction semantics for the raw condition
    const condition = confirming.condition ?? p.condition?.toString() ?? "price_above";

    let longCond: boolean;
    let shortCond: boolean;

    if (condition === "price_above" || condition === "above_vwap") {
      longCond = bar.close > vwapVal;
      shortCond = bar.close < vwapVal;
    } else if (condition === "price_below" || condition === "below_vwap") {
      longCond = bar.close < vwapVal;
      shortCond = bar.close > vwapVal;
    } else {
      // Unknown condition string — treat as price_above (most common)
      longCond = bar.close > vwapVal;
      shortCond = bar.close < vwapVal;
    }

    const satisfied = applyDirection(dir, signalDirection, longCond, shortCond);
    return {
      factor: ind,
      satisfied,
      reason: satisfied
        ? `vwap_${condition}_ok_close_${bar.close.toFixed(2)}_vwap_${vwapVal.toFixed(2)}`
        : `vwap_${condition}_fail_close_${bar.close.toFixed(2)}_vwap_${vwapVal.toFixed(2)}`,
    };
  }

  // ── MACD crossover / position ─────────────────────────────────────────────
  if (ind === "macd" || ind === "macd_crossover") {
    const macdLine = indicators["macd_line"];
    const macdSignal = indicators["macd_signal"];
    if (
      macdLine === undefined || !Number.isFinite(macdLine) ||
      macdSignal === undefined || !Number.isFinite(macdSignal)
    ) {
      return { factor: ind, satisfied: false, reason: "macd_unavailable" };
    }
    const longCond = macdLine > macdSignal;   // bullish: MACD above signal
    const shortCond = macdLine < macdSignal;  // bearish: MACD below signal
    const satisfied = applyDirection(dir, signalDirection, longCond, shortCond);
    return {
      factor: ind,
      satisfied,
      reason: satisfied
        ? `macd_line_${macdLine.toFixed(4)}_${longCond ? "above" : "below"}_signal_${macdSignal.toFixed(4)}_ok`
        : `macd_direction_fail`,
    };
  }

  // ── Bollinger Bands position ──────────────────────────────────────────────
  if (ind === "bbands" || ind === "bollinger_breakout") {
    const period = num(p.period, 20);
    const upperKey = `bbands_${period}_upper`;
    const lowerKey = `bbands_${period}_lower`;
    const upper = indicators[upperKey];
    const lower = indicators[lowerKey];
    if (upper === undefined || !Number.isFinite(upper) || lower === undefined || !Number.isFinite(lower)) {
      return { factor: ind, satisfied: false, reason: `bbands_${period}_unavailable` };
    }
    const longCond = bar.close > upper;   // bullish breakout: above upper band
    const shortCond = bar.close < lower;  // bearish breakout: below lower band
    const satisfied = applyDirection(dir, signalDirection, longCond, shortCond);
    return {
      factor: ind,
      satisfied,
      reason: satisfied
        ? `bbands_${period}_breakout_ok_close_${bar.close.toFixed(2)}`
        : `bbands_${period}_no_breakout_close_${bar.close.toFixed(2)}_upper_${upper.toFixed(2)}_lower_${lower.toFixed(2)}`,
    };
  }

  // ── ATR — threshold check (absolute value floor/ceiling) ─────────────────
  // No agree/disagree semantics for ATR: threshold_gt/lt are the only meaningful checks.
  // direction is ignored for ATR (volatility is not directional).
  if (ind === "atr") {
    const period = num(p.period, 14);
    const atrVal = indicators[`atr_${period}`];
    if (atrVal === undefined || !Number.isFinite(atrVal)) {
      return { factor: ind, satisfied: false, reason: `atr_${period}_unavailable` };
    }
    if (confirming.threshold_gt !== undefined) {
      const satisfied = atrVal > confirming.threshold_gt;
      return {
        factor: ind,
        satisfied,
        reason: satisfied
          ? `atr_${period}_${atrVal.toFixed(4)}_gt_${confirming.threshold_gt}_ok`
          : `atr_${period}_${atrVal.toFixed(4)}_not_gt_${confirming.threshold_gt}`,
      };
    }
    if (confirming.threshold_lt !== undefined) {
      const satisfied = atrVal < confirming.threshold_lt;
      return {
        factor: ind,
        satisfied,
        reason: satisfied
          ? `atr_${period}_${atrVal.toFixed(4)}_lt_${confirming.threshold_lt}_ok`
          : `atr_${period}_${atrVal.toFixed(4)}_not_lt_${confirming.threshold_lt}`,
      };
    }
    // No threshold specified — ATR present = satisfied (existence check)
    return { factor: ind, satisfied: true, reason: `atr_${period}_present_${atrVal.toFixed(4)}` };
  }

  // ── ADX — trend strength threshold ───────────────────────────────────────
  if (ind === "adx") {
    const period = num(p.period, 14);
    const adxVal = indicators[`adx_${period}`];
    if (adxVal === undefined || !Number.isFinite(adxVal)) {
      return { factor: ind, satisfied: false, reason: `adx_${period}_unavailable` };
    }
    const threshold = confirming.threshold_gt ?? num(p.threshold, 20);
    const satisfied = adxVal > threshold;
    return {
      factor: ind,
      satisfied,
      reason: satisfied
        ? `adx_${period}_${adxVal.toFixed(1)}_gt_${threshold}_ok`
        : `adx_${period}_${adxVal.toFixed(1)}_not_gt_${threshold}`,
    };
  }

  // ── ADR (average daily range) — threshold check ───────────────────────────
  if (ind === "adr") {
    const adrVal = indicators["adr"] ?? indicators["adr_14"];
    if (adrVal === undefined || !Number.isFinite(adrVal)) {
      return { factor: ind, satisfied: false, reason: "adr_unavailable" };
    }
    if (confirming.threshold_gt !== undefined) {
      const satisfied = adrVal > confirming.threshold_gt;
      return {
        factor: ind,
        satisfied,
        reason: satisfied
          ? `adr_${adrVal.toFixed(2)}_gt_${confirming.threshold_gt}_ok`
          : `adr_${adrVal.toFixed(2)}_not_gt_${confirming.threshold_gt}`,
      };
    }
    return { factor: ind, satisfied: true, reason: `adr_present_${adrVal.toFixed(2)}` };
  }

  // ── ORB / session_open_breakout ──────────────────────────────────────────
  if (ind === "orb" || ind === "session_open_breakout" || ind === "opening_range_breakout") {
    const rangeMin = num(p.range_minutes, 15);
    const orhKey = `orh_${rangeMin}m`;
    const orlKey = `orl_${rangeMin}m`;
    const orh = indicators[orhKey];
    const orl = indicators[orlKey];
    if (orh === undefined || !Number.isFinite(orh) || orl === undefined || !Number.isFinite(orl)) {
      // ORB data may not be available in paper mode — fail-CLOSED (not fail-open)
      // because if the strategy requires ORB confirmation and ORB is absent, we can't confirm.
      return { factor: ind, satisfied: false, reason: `orb_${rangeMin}m_unavailable` };
    }
    const longCond = bar.close > orh;    // bullish: price above OR high
    const shortCond = bar.close < orl;   // bearish: price below OR low
    const satisfied = applyDirection(dir, signalDirection, longCond, shortCond);
    return {
      factor: ind,
      satisfied,
      reason: satisfied
        ? `orb_${rangeMin}m_ok_close_${bar.close.toFixed(2)}_orh_${orh.toFixed(2)}_orl_${orl.toFixed(2)}`
        : `orb_${rangeMin}m_fail_close_${bar.close.toFixed(2)}_orh_${orh.toFixed(2)}_orl_${orl.toFixed(2)}`,
    };
  }

  // ── Unknown indicator — fail-CLOSED (never throw, never default satisfied) ─
  return {
    factor: ind,
    satisfied: false,
    reason: `unknown_indicator:${ind}`,
  };
}

/**
 * Evaluate an entire confirming_indicators[] array.
 *
 * Returns individual FactorResult[] so callers can:
 *  - count satisfied vs min_factors_satisfied
 *  - audit each factor individually
 *
 * Pure: no DB, no network, no side effects.
 */
export function evaluateConfirmingIndicators(
  confirmingIndicators: ConfirmingIndicator[],
  bar: EvalBar,
  indicators: IndicatorMap,
  signalDirection: "long" | "short",
): FactorResult[] {
  return confirmingIndicators.map((ci) =>
    evaluateConfirmingIndicator(ci, bar, indicators, signalDirection),
  );
}
