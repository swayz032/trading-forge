import { db } from "../db/index.js";
import { paperSessions, paperPositions, strategies, paperSignalLogs, skipDecisions } from "../db/schema.js";
import { openPosition, closePosition } from "./paper-execution-service.js";
import { checkRiskGate } from "./paper-risk-gate.js";
import { evaluateContextGate } from "./context-gate-service.js";
import { broadcastSSE } from "../routes/sse.js";
import { logger } from "../index.js";
import { eq, and, isNull, gte, lte, desc } from "drizzle-orm";
import { tracer } from "../lib/tracing.js";
const FAIL_CLOSED_EXECUTION = process.env.TF_FAIL_CLOSED_EXECUTION !== "0";

// ─── Types ──────────────────────────────────────────────────

export interface Bar {
  symbol: string;
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface StrategyConfig {
  entry_rules: string[];       // e.g. ["close > sma_20", "rsi_14 < 30"]
  exit_rules: string[];        // e.g. ["close < sma_20", "rsi_14 > 70"]
  side: "long" | "short";
  contracts: number;
  stop_loss?: StopLossConfig;
  trail_stop?: TrailStopConfig;    // 2.3: trailing stop (ATR-based)
  max_hold_bars?: number;          // 2.4: force-close after N bars
  preferred_sessions?: string[];   // ["NY_RTH", "London", "Asia"]
  cooldown_bars?: number;          // bars to wait after closing before re-entry
  indicators?: Record<string, unknown>; // optional indicator overrides
}

interface StopLossConfig {
  type: "atr" | "fixed";
  multiplier?: number;   // for ATR stop
  amount?: number;        // for fixed stop
  atr_period?: number;    // default 14
}

interface TrailStopConfig {
  atr_multiple: number;   // e.g. 2.0 → trail distance = 2 × ATR
  atr_period?: number;    // ATR period, default 14
}

interface CachedSession {
  config: StrategyConfig;
  strategyId: string;
  symbol: string;
  timeframe: string;             // e.g. "1m", "5m", "15m", "1h"
  cooldownRemaining: number;     // bars remaining in cooldown
}

interface SignalLogEntry {
  sessionId: string;
  symbol: string;
  timestamp: string;
  entrySignal: boolean;
  exitSignal: boolean;
  stopHit: boolean;
  sessionFiltered: boolean;
  cooldownActive: boolean;
  riskGatePassed: boolean | null;
  action: "none" | "open" | "close_signal" | "close_stop" | "close_trail" | "close_time";
  indicators: Record<string, number>;
  barClose: number;
  strategySide: "long" | "short";   // actual strategy side for correct signal logging
  fillMiss?: boolean;               // true when fill probability model rejected the order
}

// ─── Session Config Cache ───────────────────────────────────

const sessionCache = new Map<string, CachedSession>();

async function getSessionConfig(sessionId: string): Promise<CachedSession | null> {
  const cached = sessionCache.get(sessionId);
  if (cached) return cached;

  const [session] = await db
    .select()
    .from(paperSessions)
    .where(eq(paperSessions.id, sessionId));
  if (!session || !session.strategyId) return null;

  const [strategy] = await db
    .select()
    .from(strategies)
    .where(eq(strategies.id, session.strategyId));
  if (!strategy) return null;

  const config = strategy.config as StrategyConfig;

  // Warn if no exit mechanism exists — positions will be trapped open forever
  if ((!config.exit_rules || config.exit_rules.length === 0) && !config.stop_loss) {
    logger.warn(
      { sessionId, strategyId: strategy.id, name: strategy.name },
      "Strategy has no exit rules AND no stop loss — positions can only be closed manually",
    );
  }

  const entry: CachedSession = {
    config,
    strategyId: strategy.id,
    symbol: strategy.symbol,
    timeframe: strategy.timeframe ?? "1m",
    cooldownRemaining: 0,
  };

  sessionCache.set(sessionId, entry);
  return entry;
}

export function invalidateSessionCache(sessionId: string): void {
  sessionCache.delete(sessionId);
}

export function clearSessionCache(): void {
  sessionCache.clear();
}

/**
 * Clean up all in-memory state for a session (call on stop/kill).
 * Prevents memory leaks from indicator cache and session config cache.
 */
export function cleanupSession(sessionId: string, symbols: string[]): void {
  sessionCache.delete(sessionId);
  for (const symbol of symbols) {
    previousIndicators.delete(`${sessionId}:${symbol}`);
  }
  // Trail stop HWM and bars-held are keyed by position UUID — we can't filter
  // by sessionId without an extra DB lookup.  Accept the small leak; positions
  // should all be closed before session stop, so in practice the maps are empty.
  // ICT indicator cache: prune entries for this session
  for (const key of ictIndicatorCache.keys()) {
    if (key.startsWith(`${sessionId}:`)) {
      ictIndicatorCache.delete(key);
    }
  }
}

// ─── Indicator Functions (exported for testing) ─────────────

export function SMA(closes: number[], period: number): number {
  if (closes.length < period) return NaN;
  const slice = closes.slice(-period);
  return slice.reduce((sum, v) => sum + v, 0) / period;
}

export function EMA(closes: number[], period: number): number {
  if (closes.length < period) return NaN;
  const k = 2 / (period + 1);
  // Seed with SMA of first `period` values
  let ema = closes.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
  }
  return ema;
}

export function RSI(closes: number[], period: number): number {
  if (closes.length < period + 1) return NaN;
  let avgGain = 0;
  let avgLoss = 0;

  // Initial average over first `period` changes
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) avgGain += change;
    else avgLoss += Math.abs(change);
  }
  avgGain /= period;
  avgLoss /= period;

  // Smoothed (Wilder's) for remaining bars
  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) {
      avgGain = (avgGain * (period - 1) + change) / period;
      avgLoss = (avgLoss * (period - 1)) / period;
    } else {
      avgGain = (avgGain * (period - 1)) / period;
      avgLoss = (avgLoss * (period - 1) + Math.abs(change)) / period;
    }
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export function ATR(bars: Bar[], period: number): number {
  if (bars.length < period + 1) return NaN;
  const trueRanges: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const high = bars[i].high;
    const low = bars[i].low;
    const prevClose = bars[i - 1].close;
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    trueRanges.push(tr);
  }

  if (trueRanges.length < period) return NaN;

  // Wilder's smoothed ATR
  let atr = trueRanges.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < trueRanges.length; i++) {
    atr = (atr * (period - 1) + trueRanges[i]) / period;
  }
  return atr;
}

export function VWAP(bars: Bar[]): number {
  if (bars.length === 0) return NaN;
  let cumulativeTPV = 0;
  let cumulativeVolume = 0;
  for (const bar of bars) {
    const tp = (bar.high + bar.low + bar.close) / 3;
    cumulativeTPV += tp * bar.volume;
    cumulativeVolume += bar.volume;
  }
  if (cumulativeVolume === 0) return NaN;
  return cumulativeTPV / cumulativeVolume;
}

export function BollingerBands(
  closes: number[],
  period: number,
  stddev: number = 2
): { upper: number; middle: number; lower: number } {
  const middle = SMA(closes, period);
  if (isNaN(middle)) return { upper: NaN, middle: NaN, lower: NaN };

  const slice = closes.slice(-period);
  const variance = period > 1
    ? slice.reduce((sum, v) => sum + (v - middle) ** 2, 0) / (period - 1)
    : 0;
  const sd = Math.sqrt(variance);
  return {
    upper: middle + stddev * sd,
    middle,
    lower: middle - stddev * sd,
  };
}

// ─── Compute All Indicators from Bar Buffer ─────────────────

interface IndicatorValues {
  [key: string]: number;
}

interface ICTBridgeResult {
  values: IndicatorValues;
  bridgeHealthy: boolean;
  error?: string;
}

function computeIndicators(barBuffer: Bar[]): IndicatorValues {
  const closes = barBuffer.map((b) => b.close);
  const vals: IndicatorValues = {};

  // SMA at common periods
  for (const p of [5, 10, 20, 50, 100, 200]) {
    vals[`sma_${p}`] = SMA(closes, p);
  }

  // EMA at common periods
  for (const p of [5, 9, 12, 20, 26, 50]) {
    vals[`ema_${p}`] = EMA(closes, p);
  }

  // RSI
  for (const p of [7, 14, 21]) {
    vals[`rsi_${p}`] = RSI(closes, p);
  }

  // ATR
  for (const p of [7, 14, 21]) {
    vals[`atr_${p}`] = ATR(barBuffer, p);
  }

  // VWAP (full buffer = intraday assumption; caller resets buffer daily)
  vals["vwap"] = VWAP(barBuffer);

  // Bollinger Bands at common periods
  for (const p of [20]) {
    for (const sd of [2]) {
      const bb = BollingerBands(closes, p, sd);
      vals[`bbands_${p}_upper`] = bb.upper;
      vals[`bbands_${p}_middle`] = bb.middle;
      vals[`bbands_${p}_lower`] = bb.lower;
    }
  }

  // Current bar values for expression evaluation
  const currentBar = barBuffer[barBuffer.length - 1];
  if (currentBar) {
    vals["open"] = currentBar.open;
    vals["high"] = currentBar.high;
    vals["low"] = currentBar.low;
    vals["close"] = currentBar.close;
    vals["volume"] = currentBar.volume;
  }

  return vals;
}

// ─── Signal Expression Evaluation ───────────────────────────

/**
 * Evaluate a signal expression against computed indicator values.
 * Supports:
 *   - "close > sma_20"
 *   - "rsi_14 < 30"
 *   - "cross_above(sma_10, sma_20)"
 *   - "cross_below(ema_12, ema_26)"
 *   - Operators: >, <, >=, <=
 */
export function evaluateExpression(
  expr: string,
  current: IndicatorValues,
  previous: IndicatorValues | null
): boolean {
  const trimmed = expr.trim();

  // Handle cross_above(a, b) and cross_below(a, b)
  const crossMatch = trimmed.match(/^(cross_above|cross_below)\(\s*(\w+)\s*,\s*(\w+)\s*\)$/);
  if (crossMatch) {
    if (!previous) return false; // Need previous bar for crossover
    const [, crossType, leftKey, rightKey] = crossMatch;
    const curLeft = current[leftKey];
    const curRight = current[rightKey];
    const prevLeft = previous[leftKey];
    const prevRight = previous[rightKey];
    if ([curLeft, curRight, prevLeft, prevRight].some((v) => v === undefined || isNaN(v))) {
      return false;
    }
    if (crossType === "cross_above") {
      return prevLeft <= prevRight && curLeft > curRight;
    } else {
      return prevLeft >= prevRight && curLeft < curRight;
    }
  }

  // Handle comparison operators: >=, <=, >, <
  const compMatch = trimmed.match(/^(\w+)\s*(>=|<=|>|<)\s*(.+)$/);
  if (!compMatch) {
    logger.warn({ expr }, "Unable to parse signal expression");
    return false;
  }

  const [, leftToken, operator, rightToken] = compMatch;
  const leftVal = resolveToken(leftToken.trim(), current);
  const rightVal = resolveToken(rightToken.trim(), current);

  if (isNaN(leftVal) || isNaN(rightVal)) return false;

  switch (operator) {
    case ">":
      return leftVal > rightVal;
    case "<":
      return leftVal < rightVal;
    case ">=":
      return leftVal >= rightVal;
    case "<=":
      return leftVal <= rightVal;
    default:
      return false;
  }
}

function resolveToken(token: string, indicators: IndicatorValues): number {
  // Try as indicator key
  if (token in indicators) return indicators[token];
  // Try as numeric literal
  const num = parseFloat(token);
  if (!isNaN(num)) return num;
  return NaN;
}

function evaluateRules(
  rules: string[],
  current: IndicatorValues,
  previous: IndicatorValues | null
): boolean {
  if (rules.length === 0) return false;
  // All rules must pass (AND logic)
  return rules.every((rule) => evaluateExpression(rule, current, previous));
}

// ─── Session Time Filters ───────────────────────────────────

interface SessionWindow {
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
  crossesMidnight: boolean;
}

/** Check if US is currently observing DST (second Sunday Mar — first Sunday Nov). */
function isUsDst(date: Date): boolean {
  const year = date.getUTCFullYear();
  // Second Sunday of March (UTC)
  const mar1 = new Date(Date.UTC(year, 2, 1));
  const marSun2 = 8 + ((7 - mar1.getUTCDay()) % 7); // first Sunday >= 8
  const dstStart = Date.UTC(year, 2, marSun2, 7); // 2am ET = 7am UTC
  // First Sunday of November (UTC)
  const nov1 = new Date(Date.UTC(year, 10, 1));
  const novSun1 = 1 + ((7 - nov1.getUTCDay()) % 7);
  const dstEnd = Date.UTC(year, 10, novSun1, 6); // 2am ET = 6am UTC (still EDT)
  const ts = date.getTime();
  return ts >= dstStart && ts < dstEnd;
}

function getSessionWindows(date: Date): Record<string, SessionWindow> {
  const dst = isUsDst(date);
  // NY RTH: 9:30-16:00 ET → EDT=UTC-4, EST=UTC-5
  const nyOffset = dst ? 4 : 5;
  return {
    NY_RTH: { startHour: 9 + nyOffset, startMinute: 30, endHour: 16 + nyOffset, endMinute: 0, crossesMidnight: false },
    London: { startHour: 8, startMinute: 0, endHour: 16, endMinute: 30, crossesMidnight: false },
    Asia: { startHour: 23, startMinute: 0, endHour: 6, endMinute: 0, crossesMidnight: true },
  };
}

function isWithinSession(timestamp: string, preferredSessions?: string[]): boolean {
  const sessions = preferredSessions?.length ? preferredSessions : ["NY_RTH"];
  const date = new Date(timestamp);
  const sessionWindows = getSessionWindows(date);
  const utcHour = date.getUTCHours();
  const utcMinute = date.getUTCMinutes();
  const timeVal = utcHour * 60 + utcMinute;

  for (const sessionName of sessions) {
    const window = sessionWindows[sessionName];
    if (!window) continue;

    const startVal = window.startHour * 60 + window.startMinute;
    const endVal = window.endHour * 60 + window.endMinute;

    if (window.crossesMidnight) {
      // e.g. Asia: 23:00-06:00 — in-session if >= start OR < end
      if (timeVal >= startVal || timeVal < endVal) return true;
    } else {
      if (timeVal >= startVal && timeVal < endVal) return true;
    }
  }

  return false;
}

// ─── 2.7: TS Indicator Name Set ─────────────────────────────
// These are all indicator names that `computeIndicators()` produces.
// Any indicator name referenced in strategy rules that is NOT in this set
// will be delegated to the Python ICT bridge.

const TS_INDICATOR_NAMES: ReadonlySet<string> = new Set([
  // SMA
  "sma_5", "sma_10", "sma_20", "sma_50", "sma_100", "sma_200",
  // EMA
  "ema_5", "ema_9", "ema_12", "ema_20", "ema_26", "ema_50",
  // RSI
  "rsi_7", "rsi_14", "rsi_21",
  // ATR
  "atr_7", "atr_14", "atr_21",
  // VWAP
  "vwap",
  // Bollinger Bands
  "bbands_20_upper", "bbands_20_middle", "bbands_20_lower",
  // Current bar OHLCV
  "open", "high", "low", "close", "volume",
]);

/**
 * Extract all indicator token names referenced in a set of rule expressions.
 * Returns only tokens that are not numeric literals.
 */
function extractIndicatorNames(rules: string[]): Set<string> {
  const names = new Set<string>();
  for (const rule of rules) {
    // Match cross functions: cross_above(a, b), cross_below(a, b)
    const crossMatch = rule.trim().match(/^(?:cross_above|cross_below)\(\s*(\w+)\s*,\s*(\w+)\s*\)$/);
    if (crossMatch) {
      names.add(crossMatch[1]);
      names.add(crossMatch[2]);
      continue;
    }
    // Match comparison: left_token OP right_token_or_literal
    const compMatch = rule.trim().match(/^(\w+)\s*(?:>=|<=|>|<)\s*(.+)$/);
    if (compMatch) {
      const leftToken = compMatch[1].trim();
      const rightToken = compMatch[2].trim();
      if (isNaN(parseFloat(leftToken))) names.add(leftToken);
      if (isNaN(parseFloat(rightToken))) names.add(rightToken);
    }
  }
  return names;
}

/**
 * Check if a strategy config references any ICT indicators not in the TS set.
 * Returns the set of unknown indicator names.
 */
function findUnknownIndicators(config: StrategyConfig): Set<string> {
  const allRules = [...(config.entry_rules ?? []), ...(config.exit_rules ?? [])];
  const referenced = extractIndicatorNames(allRules);
  const unknown = new Set<string>();
  for (const name of referenced) {
    if (!TS_INDICATOR_NAMES.has(name)) {
      unknown.add(name);
    }
  }
  return unknown;
}

/**
 * Fetch ICT indicator values for a bar from the Python engine.
 * Results are cached per (sessionId, symbol, barTimestamp) to avoid redundant subprocess calls.
 *
 * The Python bridge accepts a bar buffer as JSON, computes the requested indicators,
 * and returns a flat dict of { indicator_name: float }.
 *
 * Returns an empty object if the Python call fails — fail-open: strategy evaluation
 * continues with NaN for missing indicators (which causes rules to return false, not crash).
 */
async function fetchICTIndicators(
  sessionId: string,
  symbol: string,
  barTimestamp: string,
  barBuffer: Bar[],
  unknownNames: Set<string>,
): Promise<ICTBridgeResult> {
  const cacheKey = `${sessionId}:${symbol}:${barTimestamp}`;
  const cached = ictIndicatorCache.get(cacheKey);
  if (cached) return { values: cached, bridgeHealthy: true };

  try {
    const { runPythonModule } = await import("../lib/python-runner.js");
    // Pass the last 200 bars (sufficient for all ICT indicators) and the list
    // of requested indicator names.  The Python bridge selects which functions
    // to run based on the name list.
    const barsToSend = barBuffer.slice(-200);
    const result = await runPythonModule<Record<string, number>>({
      module: "src.engine.indicators.paper_bridge",
      config: {
        bars: barsToSend,
        requested: Array.from(unknownNames),
        symbol,
      },
      timeoutMs: 8_000,
      componentName: "ict-indicator-bridge",
    });

    // Validate: only accept numeric values, discard nulls/NaN strings
    const validated: IndicatorValues = {};
    for (const [k, v] of Object.entries(result)) {
      if (typeof v === "number" && isFinite(v)) {
        validated[k] = v;
      }
    }

    // Fix 4.5: Detect bridge-succeeded-but-returned-all-NaN case.
    // If every requested indicator came back non-finite, treat it as a bridge failure:
    // the bridge ran but produced no usable values (e.g. Python returned NaN for all
    // requested names).  Emit alert + log entry so the outage is visible.
    const requestedNames = Array.from(unknownNames);
    const allNaN = requestedNames.length > 0 && requestedNames.every(name => !(name in validated));
    if (allNaN) {
      const nanError = "ICT bridge returned NaN/null for all requested indicators — possible bridge outage";
      logger.error({ sessionId, symbol, barTimestamp, requestedNames }, nanError);
      broadcastSSE("alert:ict_bridge_down", { sessionId, symbol, error: nanError });
      try {
        await db.insert(paperSignalLogs).values({
          sessionId,
          symbol,
          direction: "long",   // placeholder — not a real signal direction
          signalType: "ict_bridge_failure",
          price: "0",
          indicatorSnapshot: { requested: requestedNames.join(","), bridgeResult: "all_nan" } as Record<string, unknown>,
          acted: false,
          reason: nanError,
        });
      } catch (logErr) {
        logger.error({ logErr, sessionId }, "Failed to persist ict_bridge_failure signal log");
      }
      ictIndicatorCache.set(cacheKey, validated);
      return { values: validated, bridgeHealthy: false, error: nanError };
    }

    ictIndicatorCache.set(cacheKey, validated);
    return { values: validated, bridgeHealthy: true };
  } catch (err) {
    // Fix 4.5: Bridge subprocess failed entirely (timeout, crash, spawn error).
    // Emit SSE alert and persist a paper_signal_logs entry so the outage is
    // visible in the dashboard and queryable for post-session diagnosis.
    // Continue with fail-open behaviour (return empty — rules evaluate to false).
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error({ sessionId, symbol, barTimestamp, err }, "ICT indicator bridge failed — unknown indicators will be NaN");
    broadcastSSE("alert:ict_bridge_down", { sessionId, symbol, error: errMsg });
    try {
      await db.insert(paperSignalLogs).values({
        sessionId,
        symbol,
        direction: "long",   // placeholder — not a real signal direction
        signalType: "ict_bridge_failure",
        price: "0",
        indicatorSnapshot: { error: errMsg } as Record<string, unknown>,
        acted: false,
        reason: errMsg,
      });
    } catch (logErr) {
      logger.error({ logErr, sessionId }, "Failed to persist ict_bridge_failure signal log");
    }
    const empty: IndicatorValues = {};
    ictIndicatorCache.set(cacheKey, empty);
    return { values: empty, bridgeHealthy: false, error: errMsg };
  }
}

// ─── Stop-Loss Check ────────────────────────────────────────

function checkStopLoss(
  position: { side: string; entryPrice: string },
  bar: Bar,
  stopConfig: StopLossConfig | undefined,
  indicators: IndicatorValues
): { hit: boolean; stopPrice: number } {
  if (!stopConfig) return { hit: false, stopPrice: 0 };

  const entryPrice = Number(position.entryPrice);
  let stopDistance: number;

  if (stopConfig.type === "atr") {
    const atrPeriod = stopConfig.atr_period ?? 14;
    // Try exact period first, then nearest precomputed period
    let atrVal = indicators[`atr_${atrPeriod}`];
    if (atrVal === undefined || isNaN(atrVal)) {
      // Fallback to nearest precomputed ATR period (7, 14, 21)
      const available = [7, 14, 21];
      const nearest = available.reduce((a, b) => Math.abs(b - atrPeriod) < Math.abs(a - atrPeriod) ? b : a);
      atrVal = indicators[`atr_${nearest}`];
      if (atrVal === undefined || isNaN(atrVal)) return { hit: false, stopPrice: 0 };
    }
    stopDistance = atrVal * (stopConfig.multiplier ?? 2);
  } else {
    stopDistance = stopConfig.amount ?? 0;
    if (stopDistance === 0) return { hit: false, stopPrice: 0 };
  }

  if (position.side === "long") {
    const stopLevel = entryPrice - stopDistance;
    return { hit: bar.low <= stopLevel, stopPrice: stopLevel };
  } else {
    const stopLevel = entryPrice + stopDistance;
    return { hit: bar.high >= stopLevel, stopPrice: stopLevel };
  }
}

// ─── 2.3: Trail Stop Check ──────────────────────────────────

/**
 * Check trailing stop for an open position.
 * Updates the high-water mark map and returns hit status + trail stop price.
 *
 * For longs:  HWM = max(high) seen since open.  Trail level = HWM - (atr_mult × ATR).
 *             Hit when bar.low <= trail level.
 * For shorts: HWM = min(low)  seen since open.  Trail level = HWM + (atr_mult × ATR).
 *             Hit when bar.high >= trail level.
 */
function checkTrailStop(
  position: { id: string; side: string },
  bar: Bar,
  trailConfig: TrailStopConfig,
  indicators: IndicatorValues,
): { hit: boolean; stopPrice: number; newHWM: number | null } {
  const atrPeriod = trailConfig.atr_period ?? 14;
  let atrVal = indicators[`atr_${atrPeriod}`];
  if (atrVal === undefined || isNaN(atrVal)) {
    const available = [7, 14, 21];
    const nearest = available.reduce((a, b) => Math.abs(b - atrPeriod) < Math.abs(a - atrPeriod) ? b : a);
    atrVal = indicators[`atr_${nearest}`];
    if (atrVal === undefined || isNaN(atrVal)) return { hit: false, stopPrice: 0, newHWM: null };
  }

  const mult = trailConfig.atr_multiple;
  const posId = position.id;

  if (position.side === "long") {
    // Update HWM: track highest high seen
    const prevHWM = trailStopHWM.get(posId);
    const newHWM = prevHWM === undefined ? bar.high : Math.max(prevHWM, bar.high);
    trailStopHWM.set(posId, newHWM);
    const trailLevel = newHWM - mult * atrVal;
    return { hit: bar.low <= trailLevel, stopPrice: trailLevel, newHWM };
  } else {
    // For shorts: track lowest low seen
    const prevHWM = trailStopHWM.get(posId);
    const newHWM = prevHWM === undefined ? bar.low : Math.min(prevHWM, bar.low);
    trailStopHWM.set(posId, newHWM);
    const trailLevel = newHWM + mult * atrVal;
    return { hit: bar.high >= trailLevel, stopPrice: trailLevel, newHWM };
  }
}

// ─── Previous Indicator Cache (for crossover detection) ─────

const previousIndicators = new Map<string, IndicatorValues>();

// ─── 2.3: Trail Stop High-Water Mark ────────────────────────
// Keyed by position ID.  Tracks the most favourable price seen since open.
// For longs: HWM = max(high) since entry.  For shorts: HWM = min(low) since entry.
// Cleaned up on position close.

const trailStopHWM = new Map<string, number>();

// ─── 2.4: Bars-Held Counter ──────────────────────────────────
// Keyed by position ID.  Incremented on each bar tick while the position is open.
// Cleaned up on position close.

const positionBarsHeld = new Map<string, number>();

/**
 * Restore in-memory position state after a server restart.
 * Called by the scheduler during paper session resume.
 */
export function restorePositionState(
  positions: { id: string; trailHwm: string | null; barsHeld: number }[],
): void {
  for (const pos of positions) {
    if (pos.trailHwm != null) {
      trailStopHWM.set(pos.id, Number(pos.trailHwm));
    }
    if (pos.barsHeld > 0) {
      positionBarsHeld.set(pos.id, pos.barsHeld);
    }
  }
}

// ─── 2.7: Python ICT Indicator Cache ────────────────────────
// Keyed by "<sessionId>:<symbol>:<barTimestamp>".
// Avoids spawning a new Python subprocess for every bar when the same bar is
// processed by multiple evaluation paths.

const ictIndicatorCache = new Map<string, IndicatorValues>();

// ─── H2: Initialize position state maps from DB ──────────────
// Called at server startup (or when a session resumes) so that trail-stop HWM
// and bars-held counters survive process restarts.  Both maps are the hot path
// (read every bar), but are persisted to DB on every update.
//
// Only open positions (closedAt IS NULL) are loaded — closed positions no longer
// need their counters and are excluded to keep the maps lean.

export async function initializePositionStateMaps(): Promise<void> {
  try {
    const openPositions = await db
      .select({
        id: paperPositions.id,
        trailHwm: paperPositions.trailHwm,
        barsHeld: paperPositions.barsHeld,
      })
      .from(paperPositions)
      .where(isNull(paperPositions.closedAt));

    let loaded = 0;
    for (const pos of openPositions) {
      if (pos.trailHwm !== null && pos.trailHwm !== undefined) {
        trailStopHWM.set(pos.id, Number(pos.trailHwm));
        loaded++;
      }
      if (pos.barsHeld !== null && pos.barsHeld !== undefined) {
        positionBarsHeld.set(pos.id, pos.barsHeld);
      }
    }
    logger.info(
      { openPositions: openPositions.length, hwmLoaded: loaded },
      "Position state maps initialized from DB",
    );
  } catch (err) {
    logger.error({ err }, "Failed to initialize position state maps from DB — in-memory state starts empty");
  }
}

// ─── Signal Log (persisted to DB + broadcast via SSE) ────────

async function logSignal(entry: SignalLogEntry): Promise<void> {
  logger.debug({ signalLog: entry }, "Signal evaluated");
  broadcastSSE("paper:signal", entry);

  // Persist to paper_signal_logs for post-session analysis
  if (entry.entrySignal || entry.exitSignal || entry.stopHit) {
    try {
      const direction = entry.strategySide; // actual strategy side, not hardcoded
      const acted = entry.action !== "none";
      let reason: string | null = null;
      if (!acted) {
        if (entry.fillMiss) reason = "fill_probability_miss";
        else if (entry.cooldownActive) reason = "cooldown";
        else if (entry.sessionFiltered) reason = "session_filter";
        else if (entry.riskGatePassed === false) reason = "risk_gate_rejected";
      }
      if (entry.action === "close_stop") reason = "stop_loss";
      if (entry.action === "close_trail") reason = "trail_stop";
      if (entry.action === "close_time") reason = "max_hold_bars";

      // Map action to signalType enum
      let signalType: string;
      if (entry.action === "close_stop" || entry.action === "close_trail") {
        signalType = "stop_loss";
      } else if (entry.action === "close_signal" || entry.action === "close_time") {
        signalType = "exit";
      } else if (entry.action === "open") {
        signalType = "entry";
      } else {
        signalType = entry.exitSignal ? "exit" : "entry";
      }

      await db.insert(paperSignalLogs).values({
        sessionId: entry.sessionId,
        symbol: entry.symbol,
        direction,
        signalType,
        price: String(entry.barClose),
        indicatorSnapshot: entry.indicators,
        acted,
        reason,
      });
    } catch (err) {
      logger.error({ err, sessionId: entry.sessionId }, "Failed to persist signal log");
    }
  }
}

// ─── Bar Duration Helper ─────────────────────────────────────

function getBarDurationMs(session: CachedSession): number {
  const tf = session.timeframe.toLowerCase();
  const match = tf.match(/^(\d+)(m|h|d)$/);
  if (!match) return 60_000; // default 1 min
  const [, numStr, unit] = match;
  const num = parseInt(numStr, 10);
  switch (unit) {
    case "m": return num * 60_000;
    case "h": return num * 3_600_000;
    case "d": return num * 86_400_000;
    default: return 60_000;
  }
}

// ─── Cooldown Persistence Helper ─────────────────────────────

async function setCooldown(sessionId: string, sessionConfig: CachedSession, cooldownBars: number): Promise<void> {
  sessionConfig.cooldownRemaining = cooldownBars;
  // Estimate bar duration from strategy timeframe (fallback to 1 min if unknown)
  const barDurationMs = getBarDurationMs(sessionConfig);
  const cooldownUntil = new Date(Date.now() + cooldownBars * barDurationMs);
  try {
    await db.update(paperSessions).set({
      lastSignalTime: new Date(),
      cooldownUntil,
    }).where(eq(paperSessions.id, sessionId));
  } catch (err) {
    logger.error({ err, sessionId }, "Failed to persist cooldown");
  }
}

// ─── Main Entry Point ───────────────────────────────────────

/**
 * Called on each new bar for an active paper session.
 * Evaluates strategy signals and auto-executes via paper engine.
 */
export async function evaluateSignals(
  sessionId: string,
  symbol: string,
  bar: Bar,
  barBuffer: Bar[]
): Promise<void> {
  const span = tracer.startSpan("paper.signal_evaluation");
  span.setAttribute("symbol", symbol);
  span.setAttribute("session_id", sessionId);

  try {
  // Single DB query for pause + cooldown + mode check
  const [sessionRow] = await db.select({
    status: paperSessions.status,
    cooldownUntil: paperSessions.cooldownUntil,
    mode: paperSessions.mode,
  }).from(paperSessions).where(eq(paperSessions.id, sessionId));

  // Skip if session doesn't exist or is paused/stopped
  if (!sessionRow || sessionRow.status !== "active") return;

  const sessionConfig = await getSessionConfig(sessionId);
  if (!sessionConfig) {
    logger.warn({ sessionId }, "No strategy config found for paper session");
    return;
  }

  let skipBlocked = false;   // SKIP/SIT_OUT blocks new entries
  let skipReduce = false;    // REDUCE halves position size

  // ─── Skip Engine Gate: respect pre-market skip decisions ───
  // If today's skip decision is SKIP or SIT_OUT, block all new entries.
  // Existing positions can still be managed (stop-loss, exit signals).
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const [skipDecision] = await db
      .select({ decision: skipDecisions.decision, override: skipDecisions.override, reason: skipDecisions.reason })
      .from(skipDecisions)
      .where(
        and(
          eq(skipDecisions.strategyId, sessionConfig.strategyId),
          gte(skipDecisions.decisionDate, today),
          lte(skipDecisions.decisionDate, tomorrow),
        ),
      )
      .orderBy(desc(skipDecisions.createdAt))
      .limit(1);

    // Also check portfolio-wide skip decisions (strategyId is null)
    const [portfolioSkip] = await db
      .select({ decision: skipDecisions.decision, override: skipDecisions.override, reason: skipDecisions.reason })
      .from(skipDecisions)
      .where(
        and(
          isNull(skipDecisions.strategyId),
          gte(skipDecisions.decisionDate, today),
          lte(skipDecisions.decisionDate, tomorrow),
        ),
      )
      .orderBy(desc(skipDecisions.createdAt))
      .limit(1);

    const effectiveSkip = skipDecision ?? portfolioSkip;
    if (effectiveSkip && !effectiveSkip.override) {
      if (effectiveSkip.decision === "SKIP" || effectiveSkip.decision === "SIT_OUT") {
        skipBlocked = true;
        span.setAttribute("skip_decision", effectiveSkip.decision);
        logger.info(
          { sessionId, symbol, decision: effectiveSkip.decision },
          "Skip engine: blocking new entries — existing positions still managed",
        );
        // Persist skip engine block unconditionally — regardless of whether an entry
        // signal also fired on this bar.  Without this, a blocked session looks
        // identical to an idle session in the signal log and the block is invisible
        // in post-session analysis.  Use .catch() so a DB failure never stops evaluation.
        db.insert(paperSignalLogs).values({
          sessionId,
          symbol,
          direction: sessionConfig.config.side,
          signalType: "skip_engine_blocked",
          price: String(bar.close),
          indicatorSnapshot: {
            _skip_decision: effectiveSkip.decision,
            _skip_reason: effectiveSkip.reason ?? null,
          },
          acted: false,
          reason: `skip_engine_blocked: ${effectiveSkip.decision}${effectiveSkip.reason ? ` — ${effectiveSkip.reason}` : ""}`,
        }).catch((err: unknown) => logger.error({ err, sessionId }, "Failed to persist skip engine block log"));
      } else if (effectiveSkip.decision === "REDUCE") {
        skipReduce = true;
        span.setAttribute("skip_decision", "REDUCE");
      }
    }
  } catch (err) {
    // Skip check is non-blocking — proceed if DB query fails
    logger.debug({ err, sessionId }, "Skip decision check failed — proceeding");
  }

  const config = sessionConfig.config;
  const indicators = computeIndicators(barBuffer);
  const prevKey = `${sessionId}:${symbol}`;
  const prevIndicators = previousIndicators.get(prevKey) ?? null;

  // ─── 2.7: ICT Indicator Bridge ──────────────────────────────
  // If strategy references indicators not in the TS set, fetch them from Python
  // before evaluating rules.  Merged into the indicator map so expressions resolve.
  const unknownInds = findUnknownIndicators(config);
  let ictBridgeBlocked = false;
  if (unknownInds.size > 0) {
    const ictBridge = await fetchICTIndicators(sessionId, symbol, bar.timestamp, barBuffer, unknownInds);
    Object.assign(indicators, ictBridge.values);
    if (!ictBridge.bridgeHealthy && FAIL_CLOSED_EXECUTION) {
      ictBridgeBlocked = true;
      skipBlocked = true;
      logger.error(
        { sessionId, symbol, unknownIndicators: Array.from(unknownInds), error: ictBridge.error },
        "ICT bridge unavailable — fail-closed blocks new entries",
      );
    }
    span.setAttribute("ict_bridge_indicators", Array.from(unknownInds).join(","));
    span.setAttribute("ict_bridge_blocked", ictBridgeBlocked);
  }

  // Evaluate entry and exit rules
  const entrySignal = evaluateRules(config.entry_rules ?? [], indicators, prevIndicators);
  const exitSignal = evaluateRules(config.exit_rules ?? [], indicators, prevIndicators);

  // Session time filter
  const sessionFiltered = !isWithinSession(bar.timestamp, config.preferred_sessions);

  // ─── 2.5: Calendar filter ────────────────────────────────────
  // Check holidays AND FOMC/CPI/NFP ±30min blackout.
  // Pass full ISO timestamp so Python can do minute-precision window check.
  let calendarBlocked = false;
  let calendarBlockReason = "";
  try {
    const { runPythonModule } = await import("../lib/python-runner.js");
    const calResult = await runPythonModule<{
      is_holiday: boolean;
      is_triple_witching: boolean;
      holiday_proximity: number;
      is_economic_event: boolean;
      economic_event_name: string;
      event_window_minutes: number;
    }>({
      module: "src.engine.skip_engine.calendar_filter",
      config: {
        date: bar.timestamp.split("T")[0],
        datetime: bar.timestamp,   // full ISO for minute-precision window check
      },
      timeoutMs: 5_000,
      componentName: "calendar-filter",
    });

    if (calResult.is_holiday === true) {
      calendarBlocked = true;
      calendarBlockReason = "holiday";
      logger.info({ sessionId, symbol, date: bar.timestamp }, "Calendar filter: holiday — skipping signals");
    } else if (calResult.is_economic_event === true) {
      calendarBlocked = true;
      calendarBlockReason = calResult.economic_event_name;
      logger.info(
        {
          sessionId, symbol, event: calResult.economic_event_name,
          windowMinutes: calResult.event_window_minutes, timestamp: bar.timestamp,
        },
        `Calendar filter: ${calResult.economic_event_name} ±${calResult.event_window_minutes}min blackout — skipping signals`,
      );
      span.setAttribute("calendar_block_event", calResult.economic_event_name);
    }
  } catch (calErr) {
    // Calendar check is non-blocking — trading continues (fail-open).
    // BUT the failure must be VISIBLE: a silent swallow hides a broken risk guard.
    // Log at error level so the operator can see the guard is down.
    logger.error(
      { sessionId, symbol, err: calErr },
      "Calendar guard DOWN — Python calendar_filter failed; trading continues unblocked",
    );
    // Broadcast SSE so the dashboard can surface a warning banner immediately.
    broadcastSSE("alert:calendar_guard_down", {
      sessionId,
      symbol,
      error: calErr instanceof Error ? calErr.message : String(calErr),
      timestamp: bar.timestamp,
    });
    span.setAttribute("calendar_guard_down", true);
  }

  if (calendarBlocked) {
    // M5: Log calendar block to DB so it leaves a traceable record for post-session
    // analysis.  Without this, a blocked session looks identical to an idle session
    // in the signal logs — no way to distinguish "no signals fired" from "signals were
    // blocked by calendar".  Use .catch() so a DB failure never stops the early return.
    db.insert(paperSignalLogs).values({
      sessionId,
      symbol,
      direction: sessionConfig.config.side,
      signalType: "calendar_blocked",
      price: String(bar.close),
      indicatorSnapshot: {},
      acted: false,
      reason: `Calendar blocked: ${calendarBlockReason}`,
    }).catch((err: unknown) => logger.warn({ err }, "Failed to log calendar block to DB"));

    // ICT cache cleanup for this timestamp (no longer needed)
    ictIndicatorCache.delete(`${sessionId}:${symbol}:${bar.timestamp}`);
    span.setAttribute("calendar_blocked", true);
    span.setAttribute("calendar_block_reason", calendarBlockReason);
    span.end();
    return;
  }

  // Check for open position FIRST — needed for cooldown logic
  const [openPos] = await db
    .select()
    .from(paperPositions)
    .where(
      and(
        eq(paperPositions.sessionId, sessionId),
        eq(paperPositions.symbol, symbol),
        isNull(paperPositions.closedAt)
      )
    );

  // Cooldown check — DB-backed with in-memory fast path
  // Only decrement when no position is open (cooldown gates RE-ENTRY, not holding)
  const now = new Date();
  let cooldownActive = sessionConfig.cooldownRemaining > 0;
  if (cooldownActive && !openPos) {
    sessionConfig.cooldownRemaining--;
  } else if (!cooldownActive && sessionRow?.cooldownUntil && sessionRow.cooldownUntil > now) {
    // DB cooldown survives server restart (using already-fetched data, not extra query)
    cooldownActive = true;
  }

  let action: SignalLogEntry["action"] = "none";
  let riskGatePassed: boolean | null = null;
  let stopHit = false;
  let fillMiss = false;

  // Convenience: current ATR for passing to closePosition (2.6 exit slippage)
  const currentAtr = indicators["atr_14"];

  // Shadow mode: log signals only, never execute trades
  const isShadow = sessionRow.mode === "shadow";

  if (openPos && !isShadow) {
    // ─── Position open: check for exit signal or stop-loss ──

    // ─── 2.4: Time-based exit — max hold bars ───────────────
    // Increment bars-held counter.  Force-close when limit reached.
    // H2: persist the new value to DB so restarts don't reset the counter.
    let timeExit = false;
    if (config.max_hold_bars !== undefined && config.max_hold_bars > 0) {
      const prevBarsHeld = positionBarsHeld.get(openPos.id) ?? 0;
      const newBarsHeld = prevBarsHeld + 1;
      positionBarsHeld.set(openPos.id, newBarsHeld);
      // Persist to DB (non-blocking — a missed write just means the counter
      // reverts to the last persisted value after a restart, not a hard failure)
      db.update(paperPositions)
        .set({ barsHeld: newBarsHeld })
        .where(eq(paperPositions.id, openPos.id))
        .catch((err: unknown) => logger.warn({ err, positionId: openPos.id }, "Failed to persist barsHeld to DB"));
      if (newBarsHeld >= config.max_hold_bars) {
        timeExit = true;
        span.setAttribute("time_exit_bars", newBarsHeld);
      }
    }

    // ─── 2.3: Trail stop check ───────────────────────────────
    let trailResult: { hit: boolean; stopPrice: number; newHWM: number | null } = { hit: false, stopPrice: 0, newHWM: null };
    if (config.trail_stop) {
      trailResult = checkTrailStop(openPos, bar, config.trail_stop, indicators);
      // H2: persist HWM to DB so restarts don't reset the trailing stop level.
      // Fire-and-forget — a missed write reverts to the last persisted HWM after
      // a restart (slightly less aggressive stop), not a hard failure.
      if (trailResult.newHWM !== null) {
        db.update(paperPositions)
          .set({ trailHwm: String(trailResult.newHWM) })
          .where(eq(paperPositions.id, openPos.id))
          .catch((err: unknown) => logger.warn({ err, positionId: openPos.id }, "Failed to persist trailHwm to DB"));
      }
    }

    // Fixed stop-loss check
    const stopResult = checkStopLoss(openPos, bar, config.stop_loss, indicators);
    stopHit = stopResult.hit;

    // Priority order: fixed stop > trail stop > time exit > exit signal
    // Fixed stop is checked first because it is the firm risk limit.
    if (stopHit) {
      action = "close_stop";
      positionBarsHeld.delete(openPos.id);
      trailStopHWM.delete(openPos.id);
      await closePosition(openPos.id, stopResult.stopPrice, currentAtr);
      await setCooldown(sessionId, sessionConfig, config.cooldown_bars ?? 4);
      logger.info(
        { sessionId, symbol, reason: "stop_loss", stopPrice: stopResult.stopPrice },
        "Paper position closed — stop-loss hit",
      );
    } else if (trailResult.hit) {
      action = "close_trail";
      positionBarsHeld.delete(openPos.id);
      trailStopHWM.delete(openPos.id);
      await closePosition(openPos.id, trailResult.stopPrice, currentAtr);
      await setCooldown(sessionId, sessionConfig, config.cooldown_bars ?? 4);
      logger.info(
        { sessionId, symbol, reason: "trail_stop", stopPrice: trailResult.stopPrice },
        "Paper position closed — trailing stop hit",
      );
    } else if (timeExit) {
      action = "close_time";
      positionBarsHeld.delete(openPos.id);
      trailStopHWM.delete(openPos.id);
      await closePosition(openPos.id, bar.close, currentAtr);
      await setCooldown(sessionId, sessionConfig, config.cooldown_bars ?? 4);
      logger.info(
        { sessionId, symbol, reason: "max_hold_bars", barsHeld: config.max_hold_bars },
        "Paper position closed — max hold duration reached",
      );
    } else if (exitSignal) {
      action = "close_signal";
      positionBarsHeld.delete(openPos.id);
      trailStopHWM.delete(openPos.id);
      await closePosition(openPos.id, bar.close, currentAtr);
      await setCooldown(sessionId, sessionConfig, config.cooldown_bars ?? 4);
      logger.info(
        { sessionId, symbol, reason: "exit_signal" },
        "Paper position closed — exit signal",
      );
    }
    // Position still open: bars-held counter updated above; HWM updated inside checkTrailStop.
  } else if (entrySignal && !sessionFiltered && !cooldownActive && !isShadow && !skipBlocked && !ictBridgeBlocked) {
    // ─── No position: check for entry ───────────────────────
    try {
      const gateResult = await checkRiskGate(sessionId, symbol, config.contracts);
      riskGatePassed = gateResult.allowed;
      if (!riskGatePassed) {
        logger.info({ sessionId, symbol, reason: gateResult.reason }, "Risk gate rejected entry");
      }
    } catch (err) {
      logger.error({ err, sessionId }, "Risk gate check failed — skipping entry");
      riskGatePassed = false;
    }

    if (riskGatePassed) {
      // ─── Context Gate: TAKE/REDUCE/SKIP ───────────────────
      let contextContracts = skipReduce
        ? Math.max(1, Math.round(config.contracts / 2))
        : config.contracts;
      try {
        const ctxGate = await evaluateContextGate(
          symbol, config.side, bar.close,
          sessionConfig.strategyId, barBuffer, indicators,
        );
        if (ctxGate.action === "SKIP") {
          riskGatePassed = false;
          logger.info(
            { sessionId, symbol, action: "SKIP", reasons: ctxGate.reasoning },
            "Context gate SKIP — signal rejected",
          );
          // Persist SKIP decision to paper_signal_logs so it is auditable and
          // visible in post-session analysis.  The logSignal() path only fires
          // for entrySignal/exitSignal/stopHit; context gate SKIP bypasses that
          // condition and would otherwise leave no DB trace.
          try {
            const skipReason = `context_gate_skip: ${ctxGate.reasoning ?? "no reason"}`;
            await db.insert(paperSignalLogs).values({
              sessionId,
              symbol,
              direction: config.side,
              signalType: "context_gate_skip",
              price: String(bar.close),
              indicatorSnapshot: indicators,
              acted: false,
              reason: skipReason,
            });
          } catch (skipLogErr) {
            logger.error({ skipLogErr, sessionId }, "Failed to persist context gate SKIP log");
          }
        } else if (ctxGate.action === "REDUCE") {
          contextContracts = Math.max(1, Math.round(config.contracts * ctxGate.positionSizeAdjustment));
          logger.info(
            { sessionId, symbol, action: "REDUCE", from: config.contracts, to: contextContracts },
            "Context gate REDUCE — position size halved",
          );
          // Persist REDUCE decision to paper_signal_logs for auditable post-session
          // analysis.  Without this, a REDUCE is invisible — the trade fires at the
          // reduced size but the journal never explains why.
          try {
            const reduceReason = `context_gate_reduce: ${(ctxGate.reasoning ?? []).join("; ") || "no reason"}`;
            await db.insert(paperSignalLogs).values({
              sessionId,
              symbol,
              direction: config.side,
              signalType: "context_gate_reduce",
              price: String(bar.close),
              indicatorSnapshot: {
                ...indicators,
                _contracts_original: config.contracts,
                _contracts_adjusted: contextContracts,
                _context_gate_confidence: ctxGate.confidence,
                _position_size_adjustment: ctxGate.positionSizeAdjustment,
              },
              acted: true,
              reason: reduceReason,
            });
          } catch (reduceLogErr) {
            logger.error({ reduceLogErr, sessionId }, "Failed to persist context gate REDUCE log");
          }
        }
        // TAKE → proceed with full size
      } catch (err) {
        if (FAIL_CLOSED_EXECUTION) {
          riskGatePassed = false;
          logger.error({ err, sessionId }, "Context gate error — fail-closed blocks entry");
        } else {
          // Explicit fail-open mode: context gate error does NOT block the trade
          logger.debug({ err, sessionId }, "Context gate error — proceeding with TAKE");
        }
      }

      if (riskGatePassed) {
        action = "open";
        // BUG 2 fix: pass RSI/ATR so fill probability model actually fires
        const result = await openPosition(sessionId, {
          symbol,
          side: config.side,
          signalPrice: bar.close,
          contracts: contextContracts,
          orderType: "market",   // signal-driven entries are market orders
          rsi: indicators["rsi_14"],
          atr: indicators["atr_14"],
        });
        if (!result.position) {
          // Fill probability miss — set short cooldown to prevent hammering every bar
          action = "none";
          fillMiss = true;
          // M5: Log fill miss to DB so it leaves a traceable record.
          // Without this a fill miss looks like no signal fired — invisible in analytics.
          // The fill probability value comes from the executionResult returned by openPosition.
          db.insert(paperSignalLogs).values({
            sessionId,
            symbol,
            direction: config.side,
            signalType: "fill_miss",
            price: String(bar.close),
            indicatorSnapshot: indicators,
            acted: false,
            reason: `Fill probability check failed (orderType: market, fillRatio: ${result.executionResult.fillRatio ?? 0})`,
          }).catch((err: unknown) => logger.warn({ err }, "Failed to log fill miss to DB"));
          await setCooldown(sessionId, sessionConfig, Math.max(1, Math.floor((config.cooldown_bars ?? 4) / 2)));
        } else {
          // Initialise bars-held counter for the new position (2.4)
          positionBarsHeld.set(result.position.id, 0);
          logger.info(
            { sessionId, symbol, side: config.side, price: bar.close, contracts: contextContracts },
            "Paper position opened — entry signal",
          );
        }
      }
    }
  }

  // Store current indicators for next bar's crossover detection
  previousIndicators.set(prevKey, indicators);

  // Log the signal evaluation
  await logSignal({
    sessionId,
    symbol,
    timestamp: bar.timestamp,
    entrySignal,
    exitSignal,
    stopHit,
    sessionFiltered,
    cooldownActive,
    riskGatePassed,
    action,
    indicators,
    barClose: bar.close,
    strategySide: config.side,  // BUG 1 fix: pass actual strategy side
    fillMiss,
  });
  } finally {
    span.end();
  }
}

/**
 * Backfill state for a bar without executing trades or logging signals.
 * Used to repair indicator state after a connection drop.
 */
export async function updateStateOnly(
  sessionId: string,
  symbol: string,
  bar: Bar,
  barBuffer: Bar[]
): Promise<void> {
  const sessionConfig = await getSessionConfig(sessionId);
  if (!sessionConfig) return;

  const indicators = computeIndicators(barBuffer);
  const prevKey = `${sessionId}:${symbol}`;
  
  // Just update the previous indicators so the NEXT real-time bar has correct context
  previousIndicators.set(prevKey, indicators);
}
