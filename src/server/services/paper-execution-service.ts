import { db } from "../db/index.js";
import { paperSessions, paperPositions, paperTrades, strategies } from "../db/schema.js";
import { eq, and, isNull, desc, sql } from "drizzle-orm";
import { broadcastSSE } from "../routes/sse.js";
import { logger } from "../index.js";
import { onPaperTradeClose } from "../scheduler.js";
import { getFirmAccount, CONTRACT_SPECS } from "../../shared/firm-config.js";
import { toEasternDateString } from "./paper-risk-gate.js";
export { CONTRACT_SPECS };

export interface ExecutionResult {
  positionId: string;
  entryPrice: number;
  contracts: number;
  slippage: number;
  expectedPrice: number;
  actualPrice: number;
  arrivalPrice: number;
  implementationShortfall: number;
  fillRatio: number;
  filled: boolean;
}

// ─── Slippage Calculation ────────────────────────────────────

function calculateSlippage(symbol: string, baseSlippageTicks: number = 1): number {
  const spec = CONTRACT_SPECS[symbol];
  if (!spec) return 0;
  const randomExtra = Math.random() * spec.tickSize;
  return baseSlippageTicks * spec.tickSize + randomExtra;
}

// ─── Gap 7: Latency Simulation ───────────────────────────────

function applyLatency(signalPrice: number, symbol: string, latencyMs: number, atr?: number): number {
  if (latencyMs <= 0 || !atr || atr <= 0) return signalPrice;
  // Random walk estimate: price drifts by ATR * latency_factor during latency window
  const latencyFactor = (latencyMs / 1000) * 0.1; // 10% of ATR per second of delay
  const drift = (Math.random() * 2 - 1) * atr * latencyFactor;
  return signalPrice + drift;
}

// ─── Gap 6: Fill Probability Model ───────────────────────────

interface FillProbabilityParams {
  orderType: "market" | "limit" | "stop_limit";
  rsi?: number;
  atr?: number;
  symbol: string;
}

function computeFillProbability(params: FillProbabilityParams): number {
  if (params.orderType === "market") return 1.0;

  // RSI-based fill probability for limit orders
  // At extreme RSI (oversold/overbought), fill probability is lower
  // because price may reverse before filling
  let baseProbability = 0.75; // default
  if (params.rsi !== undefined && !isNaN(params.rsi)) {
    if (params.rsi < 20) baseProbability = 0.50;       // extreme oversold — hard to fill long limit
    else if (params.rsi < 30) baseProbability = 0.60;
    else if (params.rsi < 40) baseProbability = 0.70;
    else if (params.rsi > 80) baseProbability = 0.50;   // extreme overbought — hard to fill short limit
    else if (params.rsi > 70) baseProbability = 0.60;
    else baseProbability = 0.85;                         // normal range — likely to fill
  }

  // ATR adjustment: higher volatility = slightly better fills (more price movement)
  if (params.atr && params.atr > 0) {
    const spec = CONTRACT_SPECS[params.symbol];
    if (spec) {
      const atrTicks = params.atr / spec.tickSize;
      if (atrTicks > 40) baseProbability = Math.min(baseProbability + 0.10, 0.95);
    }
  }

  // Stop-limit: multiply by 0.85 (gap risk)
  if (params.orderType === "stop_limit") {
    baseProbability *= 0.85;
  }

  return Math.max(0.30, Math.min(0.95, baseProbability));
}

// ─── Open Position ───────────────────────────────────────────

export async function openPosition(sessionId: string, params: {
  symbol: string;
  side: "long" | "short";
  signalPrice: number;
  contracts: number;
  orderType?: "market" | "limit" | "stop_limit";
  rsi?: number;
  atr?: number;
}) {
  // Get session config for latency/fill model settings
  const [session] = await db.select().from(paperSessions).where(eq(paperSessions.id, sessionId));
  if (!session) throw new Error(`Session ${sessionId} not found`);
  if (session.status !== "active") throw new Error(`Cannot open position on ${session.status} session`);
  const sessionConfig = (session.config ?? {}) as Record<string, unknown>;
  const fillModelEnabled = sessionConfig.fillModelEnabled !== false; // default: true
  const latencyMs = (sessionConfig.latencyMs as number) ?? 150;     // default: 150ms

  const arrivalPrice = params.signalPrice; // price when signal was generated

  // Gap 6: Fill probability check
  if (fillModelEnabled && params.orderType && params.orderType !== "market") {
    const fillProb = computeFillProbability({
      orderType: params.orderType,
      rsi: params.rsi,
      atr: params.atr,
      symbol: params.symbol,
    });
    if (Math.random() > fillProb) {
      logger.info({ sessionId, symbol: params.symbol, fillProb, orderType: params.orderType }, "Fill probability miss — order not filled");
      broadcastSSE("paper:fill-miss", { sessionId, symbol: params.symbol, fillProb, orderType: params.orderType });
      return {
        position: null,
        executionResult: {
          positionId: "",
          entryPrice: 0,
          contracts: params.contracts,
          slippage: 0,
          expectedPrice: arrivalPrice,
          actualPrice: 0,
          arrivalPrice,
          implementationShortfall: 0,
          fillRatio: 0,
          filled: false,
        } satisfies ExecutionResult,
      };
    }
  }

  // Gap 7: Apply latency to price
  const priceAfterLatency = applyLatency(params.signalPrice, params.symbol, latencyMs, params.atr);

  // Apply slippage on top of latency-adjusted price
  const slippage = calculateSlippage(params.symbol);
  const actualEntry = params.side === "long"
    ? priceAfterLatency + slippage
    : priceAfterLatency - slippage;

  // Gap 8: TCA — implementation shortfall
  const spec = CONTRACT_SPECS[params.symbol];
  const implementationShortfall = Math.abs(actualEntry - arrivalPrice) * (spec?.pointValue ?? 1) * params.contracts;

  const [position] = await db.insert(paperPositions).values({
    sessionId,
    symbol: params.symbol,
    side: params.side,
    entryPrice: String(actualEntry),
    currentPrice: String(actualEntry),
    contracts: params.contracts,
    unrealizedPnl: "0",
    arrivalPrice: String(arrivalPrice),
    implementationShortfall: String(implementationShortfall),
    fillRatio: "1.0",
  }).returning();

  const executionResult: ExecutionResult = {
    positionId: position.id,
    entryPrice: actualEntry,
    contracts: params.contracts,
    slippage,
    expectedPrice: params.signalPrice,
    actualPrice: actualEntry,
    arrivalPrice,
    implementationShortfall,
    fillRatio: 1.0,
    filled: true,
  };

  broadcastSSE("paper:position-opened", {
    sessionId,
    position,
    executionQuality: executionResult,
  });

  logger.info({ sessionId, executionResult }, "Paper position opened");
  return { position, executionResult };
}

// ─── Close Position ──────────────────────────────────────────

export async function closePosition(positionId: string, exitSignalPrice: number) {
  const [pos] = await db.select().from(paperPositions).where(eq(paperPositions.id, positionId));
  if (!pos) throw new Error(`Position ${positionId} not found`);

  const slippage = calculateSlippage(pos.symbol);
  const actualExit = pos.side === "long"
    ? exitSignalPrice - slippage
    : exitSignalPrice + slippage;

  const spec = CONTRACT_SPECS[pos.symbol];
  if (!spec) throw new Error(`Unknown contract symbol: ${pos.symbol} — not in CONTRACT_SPECS`);
  const entryPrice = Number(pos.entryPrice);
  const direction = pos.side === "long" ? 1 : -1;
  const pnl = direction * (actualExit - entryPrice) * spec.pointValue * pos.contracts;

  // Insert closed trade
  const [trade] = await db.insert(paperTrades).values({
    sessionId: pos.sessionId,
    symbol: pos.symbol,
    side: pos.side,
    entryPrice: pos.entryPrice,
    exitPrice: String(actualExit),
    pnl: String(pnl),
    contracts: pos.contracts,
    entryTime: pos.entryTime,
    exitTime: new Date(),
    slippage: String(slippage),
  }).returning();

  // Mark position as closed — unrealizedPnl resets to 0 (realized P&L lives in paperTrades)
  await db.update(paperPositions).set({
    closedAt: new Date(),
    currentPrice: String(actualExit),
    unrealizedPnl: "0",
  }).where(eq(paperPositions.id, positionId));

  // Update session equity atomically — prevents read-modify-write race on concurrent closes
  // Also update peak equity (high-water mark) for trailing drawdown calculation
  await db.update(paperSessions).set({
    currentEquity: sql`${paperSessions.currentEquity}::numeric + ${pnl}`,
    peakEquity: sql`GREATEST(${paperSessions.peakEquity}::numeric, ${paperSessions.currentEquity}::numeric + ${pnl})`,
  }).where(eq(paperSessions.id, pos.sessionId));

  // Re-read session after atomic update for downstream logic
  const [session] = await db.select().from(paperSessions).where(eq(paperSessions.id, pos.sessionId));
  if (session) {
    // Gap 4: Consistency rule check + daily P&L tracking
    await checkConsistencyRule(session, pnl);

    // Gap 5: Rolling Sharpe + decay detection
    await updateRollingMetrics(pos.sessionId, session.strategyId);
  }

  broadcastSSE("paper:trade", { trade, pnl });
  logger.info({ positionId, pnl, slippage }, "Paper position closed");

  // Trigger drift detection after each trade close
  if (session?.strategyId) {
    onPaperTradeClose(pos.sessionId, session.strategyId).catch((err) => {
      logger.error({ sessionId: pos.sessionId, err }, "onPaperTradeClose drift check failed");
    });
  }

  return { trade, pnl, slippage };
}

// ─── Gap 4: Consistency Rule Enforcement ─────────────────────

async function checkConsistencyRule(
  session: typeof paperSessions.$inferSelect,
  tradePnl: number,
): Promise<void> {
  if (!session.firmId) return;
  const firmConfig = getFirmAccount(session.firmId);
  if (!firmConfig?.consistencyRule) return;

  // Update daily P&L breakdown atomically — increment today's value in SQL
  // Use Eastern Time date (futures trading day is ET-based)
  const today = toEasternDateString();

  const jsonPath = `{${today}}`;
  await db.update(paperSessions).set({
    dailyPnlBreakdown: sql`jsonb_set(
      COALESCE(${paperSessions.dailyPnlBreakdown}, '{}'::jsonb),
      ${jsonPath}::text[],
      (COALESCE((${paperSessions.dailyPnlBreakdown}->>${today})::numeric, 0) + ${tradePnl})::text::jsonb
    )`,
  }).where(eq(paperSessions.id, session.id));

  // Re-read breakdown for consistency check (reflects atomic update)
  const [updated] = await db.select({ dailyPnlBreakdown: paperSessions.dailyPnlBreakdown })
    .from(paperSessions).where(eq(paperSessions.id, session.id));
  const breakdown = (updated?.dailyPnlBreakdown ?? {}) as Record<string, number>;

  // Check consistency: no single day > X% of total profit
  const breakdownValues = Object.values(breakdown);
  if (breakdownValues.length === 0) return; // no data yet
  const totalPnl = breakdownValues.reduce((sum, v) => sum + v, 0);
  if (totalPnl <= 0) return; // only applies when profitable

  const maxDayPnl = Math.max(...breakdownValues);
  const maxDayRatio = maxDayPnl / totalPnl;

  if (maxDayRatio > firmConfig.consistencyRule) {
    const maxDay = Object.entries(breakdown).find(([, v]) => v === maxDayPnl)?.[0] ?? "unknown";
    const pctStr = (maxDayRatio * 100).toFixed(1);
    const limitPct = (firmConfig.consistencyRule * 100).toFixed(0);
    const warning = `Consistency rule: ${pctStr}% from single day (${maxDay}) exceeds ${limitPct}% limit for ${session.firmId}`;
    logger.warn({ sessionId: session.id, maxDayRatio, limit: firmConfig.consistencyRule }, warning);
    broadcastSSE("paper:consistency-warning", {
      sessionId: session.id,
      firmId: session.firmId,
      maxDayRatio,
      limit: firmConfig.consistencyRule,
      maxDay,
      message: warning,
    });
  }
}

// ─── Gap 5: Rolling Sharpe + Decay Detection ─────────────────

async function updateRollingMetrics(sessionId: string, strategyId: string | null): Promise<void> {
  // Get last 30 trades for rolling Sharpe
  const recentTrades = await db.select({ pnl: paperTrades.pnl })
    .from(paperTrades)
    .where(eq(paperTrades.sessionId, sessionId))
    .orderBy(desc(paperTrades.exitTime))
    .limit(30);

  if (recentTrades.length < 5) return; // need minimum trades for meaningful Sharpe

  const pnls = recentTrades.map(t => Number(t.pnl));
  const mean = pnls.reduce((s, v) => s + v, 0) / pnls.length;
  const variance = pnls.length > 1
    ? pnls.reduce((s, v) => s + (v - mean) ** 2, 0) / (pnls.length - 1)
    : 0;
  const stdDev = Math.sqrt(variance);
  // Annualize using trades-per-day estimate: sqrt(252 * avgTradesPerDay)
  // For now, assume ~1 trade/day (conservative); adjusts as more data accumulates
  const rollingSharpe = stdDev > 0 ? (mean / stdDev) * Math.sqrt(252) : 0;

  // Store metrics snapshot
  const metricsSnapshot = {
    rollingSharpe: Math.round(rollingSharpe * 100) / 100,
    tradeCount: recentTrades.length,
    avgPnl: Math.round(mean * 100) / 100,
    stdPnl: Math.round(stdDev * 100) / 100,
    updatedAt: new Date().toISOString(),
  };

  await db.update(paperSessions).set({
    metricsSnapshot,
  }).where(eq(paperSessions.id, sessionId));

  // Compare to backtest Sharpe if we have a linked strategy
  if (strategyId) {
    const [strategy] = await db.select({ rollingSharpe30d: strategies.rollingSharpe30d })
      .from(strategies).where(eq(strategies.id, strategyId));

    if (strategy?.rollingSharpe30d) {
      const backtestSharpe = Number(strategy.rollingSharpe30d);
      const deviation = Math.abs(rollingSharpe - backtestSharpe);
      // Rough std dev of Sharpe estimates ~ 0.5 for small samples
      const sharpeStdErr = 0.5;

      if (deviation > 2 * sharpeStdErr) {
        broadcastSSE("paper:decay-alert", {
          sessionId,
          level: "alert",
          rollingSharpe,
          backtestSharpe,
          deviation: Math.round(deviation * 100) / 100,
          message: `ALERT: Rolling Sharpe (${rollingSharpe.toFixed(2)}) deviates >2σ from backtest (${backtestSharpe.toFixed(2)})`,
        });
        logger.warn({ sessionId, rollingSharpe, backtestSharpe }, "Decay ALERT: >2σ deviation");
      } else if (deviation > 1 * sharpeStdErr) {
        broadcastSSE("paper:decay-warning", {
          sessionId,
          level: "warning",
          rollingSharpe,
          backtestSharpe,
          deviation: Math.round(deviation * 100) / 100,
          message: `Warning: Rolling Sharpe (${rollingSharpe.toFixed(2)}) deviates >1σ from backtest (${backtestSharpe.toFixed(2)})`,
        });
      }
    }
  }
}

// ─── Update Position Prices ──────────────────────────────────

export async function updatePositionPrices(sessionId: string, prices: Record<string, number>) {
  const openPositions = await db.select().from(paperPositions)
    .where(and(eq(paperPositions.sessionId, sessionId), isNull(paperPositions.closedAt)));

  let totalUnrealizedPnl = 0;

  for (const pos of openPositions) {
    const currentPrice = prices[pos.symbol];
    if (currentPrice === undefined) continue;

    const spec = CONTRACT_SPECS[pos.symbol];
    const entryPrice = Number(pos.entryPrice);
    const direction = pos.side === "long" ? 1 : -1;
    const unrealizedPnl = direction * (currentPrice - entryPrice) * (spec?.pointValue ?? 1) * pos.contracts;

    await db.update(paperPositions).set({
      currentPrice: String(currentPrice),
      unrealizedPnl: String(unrealizedPnl),
    }).where(eq(paperPositions.id, pos.id));

    totalUnrealizedPnl += unrealizedPnl;
  }

  // Update session equity to reflect unrealized P&L (needed for realtime trailing drawdown)
  if (openPositions.length > 0) {
    const [session] = await db.select({
      startingCapital: paperSessions.startingCapital,
      peakEquity: paperSessions.peakEquity,
    }).from(paperSessions).where(eq(paperSessions.id, sessionId));

    if (session) {
      // Get total realized P&L from closed trades
      const closedTrades = await db.select({ pnl: paperTrades.pnl })
        .from(paperTrades)
        .where(eq(paperTrades.sessionId, sessionId));
      const realizedPnl = closedTrades.reduce((sum, t) => sum + Number(t.pnl), 0);

      // Current equity = starting capital + realized P&L + unrealized P&L
      const newEquity = Number(session.startingCapital) + realizedPnl + totalUnrealizedPnl;
      const newPeak = Math.max(Number(session.peakEquity), newEquity);

      await db.update(paperSessions).set({
        currentEquity: String(newEquity),
        peakEquity: String(newPeak),
      }).where(eq(paperSessions.id, sessionId));
    }
  }

  broadcastSSE("paper:pnl", { sessionId, unrealizedPnl: totalUnrealizedPnl });
  return { sessionId, unrealizedPnl: totalUnrealizedPnl, positionsUpdated: openPositions.length };
}

// ─── Execution Quality Stats ─────────────────────────────────

export async function getExecutionQuality(sessionId: string) {
  const trades = await db.select().from(paperTrades)
    .where(eq(paperTrades.sessionId, sessionId));

  if (trades.length === 0) return { totalTrades: 0, avgSlippage: 0, totalSlippageCost: 0 };

  const slippages = trades.map(t => Number(t.slippage ?? 0));
  const avgSlippage = slippages.reduce((a, b) => a + b, 0) / slippages.length;
  const totalSlippageCost = slippages.reduce((sum, s, i) => {
    const spec = CONTRACT_SPECS[trades[i].symbol];
    return sum + s * (spec?.pointValue ?? 1) * trades[i].contracts;
  }, 0);

  return {
    totalTrades: trades.length,
    avgSlippage: Math.round(avgSlippage * 1000) / 1000,
    totalSlippageCost: Math.round(totalSlippageCost * 100) / 100,
  };
}

// ─── Gap 8: TCA Report ──────────────────────────────────────

export async function getTcaReport(sessionId: string) {
  const positions = await db.select().from(paperPositions)
    .where(eq(paperPositions.sessionId, sessionId));

  if (positions.length === 0) {
    return { totalPositions: 0, avgShortfall: 0, totalExecutionCost: 0, avgFillRatio: 1.0, worstFills: [] };
  }

  const closedPositions = positions.filter(p => p.closedAt);
  const shortfalls = closedPositions
    .map(p => Number(p.implementationShortfall ?? 0))
    .filter(v => v > 0);
  const fillRatios = closedPositions.map(p => Number(p.fillRatio ?? 1));

  const avgShortfall = shortfalls.length > 0
    ? shortfalls.reduce((s, v) => s + v, 0) / shortfalls.length
    : 0;
  const totalExecutionCost = shortfalls.reduce((s, v) => s + v, 0);
  const avgFillRatio = fillRatios.length > 0
    ? fillRatios.reduce((s, v) => s + v, 0) / fillRatios.length
    : 1.0;

  // Worst fills: top 5 by implementation shortfall
  const worstFills = closedPositions
    .filter(p => Number(p.implementationShortfall ?? 0) > 0)
    .sort((a, b) => Number(b.implementationShortfall ?? 0) - Number(a.implementationShortfall ?? 0))
    .slice(0, 5)
    .map(p => ({
      positionId: p.id,
      symbol: p.symbol,
      arrivalPrice: Number(p.arrivalPrice ?? 0),
      entryPrice: Number(p.entryPrice),
      shortfall: Number(p.implementationShortfall ?? 0),
      fillRatio: Number(p.fillRatio ?? 1),
    }));

  return {
    totalPositions: closedPositions.length,
    avgShortfall: Math.round(avgShortfall * 100) / 100,
    totalExecutionCost: Math.round(totalExecutionCost * 100) / 100,
    avgFillRatio: Math.round(avgFillRatio * 1000) / 1000,
    worstFills,
  };
}

// ─── Rolling Metrics (public getter for route) ───────────────

export async function getRollingMetrics(sessionId: string) {
  const [session] = await db.select({
    metricsSnapshot: paperSessions.metricsSnapshot,
    dailyPnlBreakdown: paperSessions.dailyPnlBreakdown,
    firmId: paperSessions.firmId,
  }).from(paperSessions).where(eq(paperSessions.id, sessionId));

  if (!session) return null;
  return {
    metrics: session.metricsSnapshot,
    dailyPnl: session.dailyPnlBreakdown,
    firmId: session.firmId,
  };
}
