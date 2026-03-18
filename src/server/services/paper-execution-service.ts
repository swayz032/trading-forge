import { db } from "../db/index.js";
import { paperSessions, paperPositions, paperTrades, strategies } from "../db/schema.js";
import { eq, and, isNull } from "drizzle-orm";
import { broadcastSSE } from "../routes/sse.js";
import { logger } from "../index.js";
import { onPaperTradeClose } from "../scheduler.js";

// Contract specs (same as risk.ts)
const CONTRACT_SPECS: Record<string, { tickSize: number; tickValue: number; pointValue: number }> = {
  ES:  { tickSize: 0.25, tickValue: 12.50, pointValue: 50.00 },
  NQ:  { tickSize: 0.25, tickValue: 5.00,  pointValue: 20.00 },
  CL:  { tickSize: 0.01, tickValue: 10.00, pointValue: 1000.00 },
  YM:  { tickSize: 1.00, tickValue: 5.00,  pointValue: 5.00 },
  RTY: { tickSize: 0.10, tickValue: 5.00,  pointValue: 50.00 },
  GC:  { tickSize: 0.10, tickValue: 10.00, pointValue: 100.00 },
  MES: { tickSize: 0.25, tickValue: 1.25,  pointValue: 5.00 },
  MNQ: { tickSize: 0.25, tickValue: 0.50,  pointValue: 2.00 },
};

export interface ExecutionResult {
  positionId: string;
  entryPrice: number;
  contracts: number;
  slippage: number;
  expectedPrice: number;
  actualPrice: number;
}

// Calculate realistic slippage based on ATR and session
function calculateSlippage(symbol: string, baseSlippageTicks: number = 1): number {
  const spec = CONTRACT_SPECS[symbol];
  if (!spec) return 0;
  // Base slippage + random component (0-1 extra ticks)
  const randomExtra = Math.random() * spec.tickSize;
  return baseSlippageTicks * spec.tickSize + randomExtra;
}

// Open a paper position
export async function openPosition(sessionId: string, params: {
  symbol: string;
  side: "long" | "short";
  signalPrice: number;
  contracts: number;
}) {
  const slippage = calculateSlippage(params.symbol);
  const actualEntry = params.side === "long"
    ? params.signalPrice + slippage
    : params.signalPrice - slippage;

  const [position] = await db.insert(paperPositions).values({
    sessionId,
    symbol: params.symbol,
    side: params.side,
    entryPrice: String(actualEntry),
    currentPrice: String(actualEntry),
    contracts: params.contracts,
    unrealizedPnl: "0",
  }).returning();

  // Log execution quality
  const executionResult: ExecutionResult = {
    positionId: position.id,
    entryPrice: actualEntry,
    contracts: params.contracts,
    slippage,
    expectedPrice: params.signalPrice,
    actualPrice: actualEntry,
  };

  broadcastSSE("paper:position-opened", {
    sessionId,
    position,
    executionQuality: executionResult,
  });

  logger.info({ sessionId, executionResult }, "Paper position opened");
  return { position, executionResult };
}

// Close a paper position
export async function closePosition(positionId: string, exitSignalPrice: number) {
  const [pos] = await db.select().from(paperPositions).where(eq(paperPositions.id, positionId));
  if (!pos) throw new Error(`Position ${positionId} not found`);

  const slippage = calculateSlippage(pos.symbol);
  const actualExit = pos.side === "long"
    ? exitSignalPrice - slippage
    : exitSignalPrice + slippage;

  const spec = CONTRACT_SPECS[pos.symbol];
  const entryPrice = Number(pos.entryPrice);
  const direction = pos.side === "long" ? 1 : -1;
  const pnl = direction * (actualExit - entryPrice) * (spec?.pointValue ?? 1) * pos.contracts;

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

  // Mark position as closed
  await db.update(paperPositions).set({
    closedAt: new Date(),
    currentPrice: String(actualExit),
    unrealizedPnl: String(pnl),
  }).where(eq(paperPositions.id, positionId));

  // Update session equity
  const [session] = await db.select().from(paperSessions).where(eq(paperSessions.id, pos.sessionId));
  if (session) {
    const newEquity = Number(session.currentEquity) + pnl;
    await db.update(paperSessions).set({
      currentEquity: String(newEquity),
    }).where(eq(paperSessions.id, pos.sessionId));
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

// Update current prices for all open positions in a session
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

  // Broadcast P&L update
  broadcastSSE("paper:pnl", { sessionId, unrealizedPnl: totalUnrealizedPnl });
  return { sessionId, unrealizedPnl: totalUnrealizedPnl, positionsUpdated: openPositions.length };
}

// Get execution quality stats for a session
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
