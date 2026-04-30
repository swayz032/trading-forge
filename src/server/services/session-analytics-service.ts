import { db } from "../db/index.js";
import { paperSessions, paperTrades, subsystemMetrics } from "../db/schema.js";
import { sql, gte } from "drizzle-orm";
import { logger } from "../lib/logger.js";

export async function computeSessionAnalytics(period: "daily" | "weekly" | "monthly" = "daily") {
  const periodMs = period === "daily" ? 24 * 60 * 60 * 1000
    : period === "weekly" ? 7 * 24 * 60 * 60 * 1000
    : 30 * 24 * 60 * 60 * 1000;
  const since = new Date(Date.now() - periodMs);

  // Aggregate paper trades
  const [tradeStats] = await db.select({
    totalTrades: sql<number>`count(*)::int`,
    totalPnl: sql<number>`coalesce(sum(pnl::numeric), 0)::numeric`,
    avgPnl: sql<number>`coalesce(avg(pnl::numeric), 0)::numeric`,
    winCount: sql<number>`count(*) filter (where pnl::numeric > 0)::int`,
    lossCount: sql<number>`count(*) filter (where pnl::numeric <= 0)::int`,
  }).from(paperTrades).where(gte(paperTrades.createdAt, since));

  // Session stats
  const [sessionStats] = await db.select({
    totalSessions: sql<number>`count(*)::int`,
    completedSessions: sql<number>`count(*) filter (where status = 'stopped' or status = 'completed')::int`,
  }).from(paperSessions).where(gte(paperSessions.createdAt, since));

  const totalTrades = tradeStats?.totalTrades ?? 0;
  const winCount = tradeStats?.winCount ?? 0;

  return {
    period,
    since: since.toISOString(),
    trades: {
      total: totalTrades,
      wins: winCount,
      losses: tradeStats?.lossCount ?? 0,
      winRate: totalTrades > 0 ? Math.round((winCount / totalTrades) * 10000) / 100 : 0,
      totalPnl: Math.round(Number(tradeStats?.totalPnl ?? 0) * 100) / 100,
      avgPnl: Math.round(Number(tradeStats?.avgPnl ?? 0) * 100) / 100,
    },
    sessions: {
      total: sessionStats?.totalSessions ?? 0,
      completed: sessionStats?.completedSessions ?? 0,
    },
  };
}

/** Store nightly rollup in subsystem_metrics */
export async function recordSessionAnalyticsRollup(): Promise<void> {
  const daily = await computeSessionAnalytics("daily");
  const now = new Date();

  const metrics = [
    { subsystem: "paper_analytics", metricName: "daily_trades", metricValue: String(daily.trades.total), tags: null, measuredAt: now },
    { subsystem: "paper_analytics", metricName: "daily_pnl", metricValue: String(daily.trades.totalPnl), tags: null, measuredAt: now },
    { subsystem: "paper_analytics", metricName: "daily_win_rate", metricValue: String(daily.trades.winRate), tags: null, measuredAt: now },
    { subsystem: "paper_analytics", metricName: "daily_sessions", metricValue: String(daily.sessions.total), tags: null, measuredAt: now },
  ];

  await db.insert(subsystemMetrics).values(metrics);
  logger.info({ daily: daily.trades }, "Session analytics rollup recorded");
}
