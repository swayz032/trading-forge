import { db } from "../db/index.js";
import { backtests, paperTrades } from "../db/schema.js";
import { eq, desc, and } from "drizzle-orm";
import { broadcastSSE } from "../routes/sse.js";
import { logger } from "../index.js";

export interface DriftReport {
  strategyId: string;
  metric: string;
  backtestValue: number;
  liveValue: number;
  deviationStdDevs: number;
  severity: "ok" | "investigate" | "alert";
  message: string;
}

// Calculate standard deviation
function stdDev(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (n - 1);
  return Math.sqrt(variance);
}

// Compare live paper trading metrics against backtest expectations
export async function detectDrift(strategyId: string, sessionId: string): Promise<DriftReport[]> {
  // Get latest completed backtest for this strategy
  const [backtest] = await db.select().from(backtests)
    .where(and(eq(backtests.strategyId, strategyId), eq(backtests.status, "completed")))
    .orderBy(desc(backtests.createdAt))
    .limit(1);

  if (!backtest) return [];

  // Get paper trades for this session (ordered by exit time — critical for drawdown calc)
  const trades = await db.select().from(paperTrades)
    .where(eq(paperTrades.sessionId, sessionId))
    .orderBy(paperTrades.exitTime);

  if (trades.length < 5) return []; // Need enough data to compare

  const reports: DriftReport[] = [];

  // Compare win rate
  const liveWins = trades.filter(t => Number(t.pnl) > 0).length;
  const liveWinRate = liveWins / trades.length;
  const backtestWinRate = Number(backtest.winRate ?? 0);

  if (backtestWinRate > 0) {
    const winRateDiff = Math.abs(liveWinRate - backtestWinRate);
    const expectedStdDev = Math.sqrt(backtestWinRate * (1 - backtestWinRate) / trades.length);
    const deviationStdDevs = expectedStdDev > 0 ? winRateDiff / expectedStdDev : 0;

    reports.push({
      strategyId,
      metric: "winRate",
      backtestValue: backtestWinRate,
      liveValue: liveWinRate,
      deviationStdDevs: Math.round(deviationStdDevs * 100) / 100,
      severity: deviationStdDevs > 2 ? "alert" : deviationStdDevs > 1 ? "investigate" : "ok",
      message: deviationStdDevs > 2
        ? `Win rate drifted ${deviationStdDevs.toFixed(1)}\u03C3 from backtest (${(backtestWinRate * 100).toFixed(0)}% \u2192 ${(liveWinRate * 100).toFixed(0)}%)`
        : `Win rate within expected range`,
    });
  }

  // Compare avg trade P&L
  const livePnls = trades.map(t => Number(t.pnl));
  const liveAvgPnl = livePnls.reduce((a, b) => a + b, 0) / livePnls.length;
  const backtestAvgPnl = Number(backtest.avgTradePnl ?? 0);
  const pnlStdDev = stdDev(livePnls);

  if (pnlStdDev > 0 && backtestAvgPnl !== 0) {
    const pnlDeviation = Math.abs(liveAvgPnl - backtestAvgPnl) / pnlStdDev;

    reports.push({
      strategyId,
      metric: "avgTradePnl",
      backtestValue: backtestAvgPnl,
      liveValue: Math.round(liveAvgPnl * 100) / 100,
      deviationStdDevs: Math.round(pnlDeviation * 100) / 100,
      severity: pnlDeviation > 2 ? "alert" : pnlDeviation > 1 ? "investigate" : "ok",
      message: pnlDeviation > 2
        ? `Avg trade P&L drifted ${pnlDeviation.toFixed(1)}\u03C3 ($${backtestAvgPnl.toFixed(0)} \u2192 $${liveAvgPnl.toFixed(0)})`
        : `Avg trade P&L within expected range`,
    });
  }

  // Compare max drawdown
  let maxDrawdown = 0;
  let peak = 0;
  let cumPnl = 0;
  for (const pnl of livePnls) {
    cumPnl += pnl;
    if (cumPnl > peak) peak = cumPnl;
    const drawdown = peak - cumPnl;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  }

  const backtestMaxDD = Math.abs(Number(backtest.maxDrawdown ?? 0));
  if (backtestMaxDD > 0) {
    const ddRatio = maxDrawdown / backtestMaxDD;
    reports.push({
      strategyId,
      metric: "maxDrawdown",
      backtestValue: backtestMaxDD,
      liveValue: Math.round(maxDrawdown * 100) / 100,
      deviationStdDevs: Math.round(ddRatio * 100) / 100,
      severity: ddRatio > 1.5 ? "alert" : ddRatio > 1.0 ? "investigate" : "ok",
      message: ddRatio > 1.5
        ? `Live drawdown exceeds backtest by ${((ddRatio - 1) * 100).toFixed(0)}%`
        : `Drawdown within expected range`,
    });
  }

  // Broadcast alerts for any high-severity drift
  const alerts = reports.filter(r => r.severity === "alert");
  if (alerts.length > 0) {
    broadcastSSE("drift:alert", { strategyId, sessionId, alerts });
    logger.warn({ strategyId, alerts }, "Drift detected in paper trading");
  }

  return reports;
}

// Rolling 30-day Sharpe calculation for alpha decay monitoring
export function calculateRollingSharpe(dailyPnls: number[]): number {
  if (dailyPnls.length < 5) return 0;
  const recent = dailyPnls.slice(-30);
  const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
  const sd = stdDev(recent);
  if (sd === 0) return 0;
  return (mean / sd) * Math.sqrt(252);
}
