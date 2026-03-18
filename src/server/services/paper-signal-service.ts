import { db } from "../db/index.js";
import { paperSessions, paperPositions, strategies } from "../db/schema.js";
import { openPosition, closePosition } from "./paper-execution-service.js";
import { checkRiskGate } from "./paper-risk-gate.js"; // will exist
import { broadcastSSE } from "../routes/sse.js";
import { logger } from "../index.js";
import { eq, and, isNull } from "drizzle-orm";

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

interface CachedSession {
  config: StrategyConfig;
  strategyId: string;
  symbol: string;
  cooldownRemaining: number;   // bars remaining in cooldown
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
  action: "none" | "open" | "close_signal" | "close_stop";
  indicators: Record<string, number>;
  barClose: number;
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
  const entry: CachedSession = {
    config,
    strategyId: strategy.id,
    symbol: strategy.symbol,
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
  const variance = slice.reduce((sum, v) => sum + (v - middle) ** 2, 0) / period;
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

const SESSION_WINDOWS: Record<string, SessionWindow> = {
  NY_RTH: { startHour: 13, startMinute: 30, endHour: 20, endMinute: 0, crossesMidnight: false },
  London: { startHour: 8, startMinute: 0, endHour: 16, endMinute: 30, crossesMidnight: false },
  Asia: { startHour: 23, startMinute: 0, endHour: 6, endMinute: 0, crossesMidnight: true },
};

function isWithinSession(timestamp: string, preferredSessions?: string[]): boolean {
  const sessions = preferredSessions?.length ? preferredSessions : ["NY_RTH"];
  const date = new Date(timestamp);
  const utcHour = date.getUTCHours();
  const utcMinute = date.getUTCMinutes();
  const timeVal = utcHour * 60 + utcMinute;

  for (const sessionName of sessions) {
    const window = SESSION_WINDOWS[sessionName];
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

// ─── Stop-Loss Check ────────────────────────────────────────

function checkStopLoss(
  position: { side: string; entryPrice: string },
  bar: Bar,
  stopConfig: StopLossConfig | undefined,
  indicators: IndicatorValues
): boolean {
  if (!stopConfig) return false;

  const entryPrice = Number(position.entryPrice);
  let stopDistance: number;

  if (stopConfig.type === "atr") {
    const atrPeriod = stopConfig.atr_period ?? 14;
    const atrVal = indicators[`atr_${atrPeriod}`];
    if (isNaN(atrVal)) return false;
    stopDistance = atrVal * (stopConfig.multiplier ?? 2);
  } else {
    stopDistance = stopConfig.amount ?? 0;
    if (stopDistance === 0) return false;
  }

  if (position.side === "long") {
    const stopLevel = entryPrice - stopDistance;
    return bar.low <= stopLevel;
  } else {
    const stopLevel = entryPrice + stopDistance;
    return bar.high >= stopLevel;
  }
}

// ─── Previous Indicator Cache (for crossover detection) ─────

const previousIndicators = new Map<string, IndicatorValues>();

// ─── Signal Log (in-memory buffer, flushed periodically) ────
// In production you'd batch-insert these; for now we log + broadcast.

async function logSignal(entry: SignalLogEntry): Promise<void> {
  // TODO: insert into signal_log table when it exists in schema
  // For now, log structured data and broadcast via SSE
  logger.debug({ signalLog: entry }, "Signal evaluated");
  broadcastSSE("paper:signal", entry);
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
  const sessionConfig = await getSessionConfig(sessionId);
  if (!sessionConfig) {
    logger.warn({ sessionId }, "No strategy config found for paper session");
    return;
  }

  const config = sessionConfig.config;
  const indicators = computeIndicators(barBuffer);
  const prevKey = `${sessionId}:${symbol}`;
  const prevIndicators = previousIndicators.get(prevKey) ?? null;

  // Evaluate entry and exit rules
  const entrySignal = evaluateRules(config.entry_rules ?? [], indicators, prevIndicators);
  const exitSignal = evaluateRules(config.exit_rules ?? [], indicators, prevIndicators);

  // Session time filter
  const sessionFiltered = !isWithinSession(bar.timestamp, config.preferred_sessions);

  // Cooldown check
  const cooldownActive = sessionConfig.cooldownRemaining > 0;
  if (cooldownActive) {
    sessionConfig.cooldownRemaining--;
  }

  // Check for open position
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

  let action: SignalLogEntry["action"] = "none";
  let riskGatePassed: boolean | null = null;
  let stopHit = false;

  if (openPos) {
    // ─── Position open: check for exit signal or stop-loss ──
    stopHit = checkStopLoss(openPos, bar, config.stop_loss, indicators);

    if (stopHit) {
      action = "close_stop";
      await closePosition(openPos.id, bar.close);
      sessionConfig.cooldownRemaining = config.cooldown_bars ?? 4;
      logger.info(
        { sessionId, symbol, reason: "stop_loss" },
        "Paper position closed — stop-loss hit"
      );
    } else if (exitSignal) {
      action = "close_signal";
      await closePosition(openPos.id, bar.close);
      sessionConfig.cooldownRemaining = config.cooldown_bars ?? 4;
      logger.info(
        { sessionId, symbol, reason: "exit_signal" },
        "Paper position closed — exit signal"
      );
    }
  } else if (entrySignal && !sessionFiltered && !cooldownActive) {
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
      action = "open";
      await openPosition(sessionId, {
        symbol,
        side: config.side,
        signalPrice: bar.close,
        contracts: config.contracts,
      });
      logger.info(
        { sessionId, symbol, side: config.side, price: bar.close },
        "Paper position opened — entry signal"
      );
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
  });
}
