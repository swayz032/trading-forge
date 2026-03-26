import { db } from "../db/index.js";
import { paperTrades } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { broadcastSSE } from "../routes/sse.js";
import { logger } from "../index.js";

export interface CorrelationResult {
  strategy1: string;
  strategy2: string;
  correlation: number;
  status: "uncorrelated" | "moderate" | "high";
  recommendation: string;
}

// Pearson correlation coefficient
function pearsonCorrelation(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 5) return 0;

  const xs = x.slice(0, n);
  const ys = y.slice(0, n);
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;

  let num = 0, denX = 0, denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }

  const den = Math.sqrt(denX * denY);
  return den === 0 ? 0 : num / den;
}

// Calculate correlation between two paper trading sessions' daily returns
export async function calculateCorrelation(sessionId1: string, sessionId2: string): Promise<CorrelationResult> {
  const [trades1, trades2] = await Promise.all([
    db.select().from(paperTrades).where(eq(paperTrades.sessionId, sessionId1)),
    db.select().from(paperTrades).where(eq(paperTrades.sessionId, sessionId2)),
  ]);

  // Aggregate to daily P&L
  function toDailyPnl(trades: typeof trades1): Map<string, number> {
    const daily = new Map<string, number>();
    for (const t of trades) {
      if (!t.exitTime) continue; // skip trades still open (no exit time)
      const exitDate = t.exitTime instanceof Date ? t.exitTime : new Date(t.exitTime);
      const day = exitDate.toISOString().slice(0, 10);
      daily.set(day, (daily.get(day) ?? 0) + Number(t.pnl));
    }
    return daily;
  }

  const daily1 = toDailyPnl(trades1);
  const daily2 = toDailyPnl(trades2);

  // Align dates
  const commonDates = [...daily1.keys()].filter(d => daily2.has(d)).sort();
  const pnl1 = commonDates.map(d => daily1.get(d)!);
  const pnl2 = commonDates.map(d => daily2.get(d)!);

  const correlation = Math.round(pearsonCorrelation(pnl1, pnl2) * 1000) / 1000;
  const absCorr = Math.abs(correlation);

  const result: CorrelationResult = {
    strategy1: sessionId1,
    strategy2: sessionId2,
    correlation,
    status: absCorr > 0.5 ? "high" : absCorr > 0.3 ? "moderate" : "uncorrelated",
    recommendation: absCorr > 0.5
      ? "Treat as one strategy for position sizing \u2014 combined heat exceeds independent risk"
      : absCorr > 0.3
        ? "Moderate correlation \u2014 monitor during volatility events"
        : "Good diversification \u2014 strategies are sufficiently uncorrelated",
  };

  if (absCorr > 0.5) {
    broadcastSSE("correlation:alert", result);
    logger.warn(result, "High correlation detected between strategies");
  }

  return result;
}

// Calculate portfolio-level correlation matrix for all active sessions
export async function portfolioCorrelationMatrix(sessionIds: string[]): Promise<CorrelationResult[]> {
  const results: CorrelationResult[] = [];
  for (let i = 0; i < sessionIds.length; i++) {
    for (let j = i + 1; j < sessionIds.length; j++) {
      const result = await calculateCorrelation(sessionIds[i], sessionIds[j]);
      results.push(result);
    }
  }
  return results;
}
